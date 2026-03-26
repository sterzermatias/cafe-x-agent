import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
// In = operador SQL "IN (...)"; IsNull = operador SQL "IS NULL"
import { In, IsNull, Repository } from 'typeorm';
import { AnthropicService } from '../anthropic/anthropic.service.js';
import { ContentSnapshot } from '../entities/content-snapshot.entity.js';
import {
  GeneratedTweet,
  type GenerationContext,
  type TweetStatus,
} from '../entities/generated-tweet.entity.js';
import { ProfileSummary } from '../entities/profile-summary.entity.js';
import { TwitterService } from '../twitter/twitter.service.js';

// Interfaz que define la forma del objeto de estadísticas
export interface TweetStats {
  total: number;
  pending: number;
  approved: number;
  published: number;
  rejected: number;
  failed: number;
  todayCount: number;
  lastPublished: {
    content: string;
    published_at: string;
    url: string;
  } | null; // null si nunca se publicó un tweet
  approvalRate: number;
}

// Servicio central del agente — orquesta generación, validación, aprobación y publicación
@Injectable()
export class TweetGeneratorService {
  private readonly logger = new Logger(TweetGeneratorService.name);

  constructor(
    private readonly anthropicService: AnthropicService,
    private readonly twitterService: TwitterService,
    private readonly configService: ConfigService,
    @InjectRepository(GeneratedTweet)
    private readonly tweetRepo: Repository<GeneratedTweet>,
    @InjectRepository(ProfileSummary)
    private readonly profileRepo: Repository<ProfileSummary>,
    @InjectRepository(ContentSnapshot)
    private readonly snapshotRepo: Repository<ContentSnapshot>,
  ) {}

  // Genera un tweet: recopila contexto → llama a Claude → valida contenido → guarda en DB
  async generate(options?: {
    topic?: string;
  }): Promise<{ tweet: string; id: number }> {
    // Busca el perfil más reciente (estilo + intereses del usuario)
    const profile = await this.profileRepo.findOne({
      order: { id: 'DESC' },
      where: {},
    });

    if (!profile) {
      throw new Error('No profile found. Run /aprender first.');
    }

    // Último snapshot de contenido RSS (temas trending)
    const snapshot = await this.snapshotRepo.findOne({
      order: { captured_at: 'DESC' },
      where: {},
    });

    // Few-shot learning: últimos 5 tweets aprobados y rechazados como contexto
    // In() genera: WHERE status IN ('approved', 'published')
    const approvedTweets = await this.tweetRepo.find({
      where: {
        status: In(['approved', 'published']) as unknown as TweetStatus,
      },
      order: { created_at: 'DESC' },
      take: 5, // LIMIT 5
    });

    const rejectedTweets = await this.tweetRepo.find({
      where: { status: 'rejected' as TweetStatus },
      order: { created_at: 'DESC' },
      take: 5,
    });

    // Prioridad de contexto: tema manual > RSS trending > intereses del perfil
    let contentContext: string;

    if (options?.topic) {
      contentContext = `Topic requested by user: ${options.topic}`;
    } else if (snapshot) {
      contentContext = snapshot.topics_summary;
    } else {
      contentContext =
        'No specific content context available. Generate based on profile interests.';
    }

    const feedback = {
      approved: approvedTweets.map((t) => ({ content: t.content })),
      rejected: rejectedTweets.map((t) => ({
        content: t.content,
        rejection_reason: t.rejection_reason ?? undefined,
      })),
    };

    // Loop de generación + validación: hasta 3 intentos
    let tweet: string = '';
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      attempts++;

      // Claude genera el tweet imitando el estilo del usuario
      tweet = await this.anthropicService.generateTweet(
        { style: profile.style, interests: profile.interests },
        contentContext,
        feedback,
      );

      // Verifica largo (Twitter max: 280 chars)
      if (tweet.length > 280) {
        if (attempts === 1) {
          this.logger.warn(
            `Tweet too long (${tweet.length} chars), retrying...`,
          );
          continue;
        }
        // Si sigue largo después de reintentar, trunca
        this.logger.warn(
          `Tweet still too long (${tweet.length} chars), truncating`,
        );
        tweet = tweet.substring(0, 277) + '...';
      }

      // Validación de contenido seguro (otro call a Claude)
      const validation = await this.anthropicService.validateContent(tweet);

      if (validation.safe) {
        break;
      }

      this.logger.warn(
        `Content validation failed (attempt ${attempts}/${maxAttempts}): ${validation.reason}`,
      );

      if (attempts >= maxAttempts) {
        throw new Error(
          `Tweet failed content validation after ${maxAttempts} attempts: ${validation.reason}`,
        );
      }
    }

    // Guarda metadata de generación para trazabilidad (qué modelo, qué fuentes, qué feedback)
    const generationContext: GenerationContext = {
      source_type: options?.topic ? 'manual' : 'scheduled',
      prompt_template_version: '1.0',
      model_used:
        this.configService.get<string>('ANTHROPIC_SONNET_MODEL') ||
        'claude-sonnet-4-20250514',
      rss_sources: snapshot?.source_feeds ?? [],
      recent_approved_ids: approvedTweets.map((t) => t.id),
      recent_rejected_ids: rejectedTweets.map((t) => t.id),
      manual_topic: options?.topic,
    };

    // Crea la entidad con status "pending" — espera aprobación del usuario vía Telegram
    const entity = this.tweetRepo.create({
      content: tweet,
      status: 'pending',
      created_at: new Date().toISOString(),
      generation_context: generationContext,
      profile_summary_id: profile.id,
      content_snapshot_id: snapshot?.id ?? null,
    });

    const saved = await this.tweetRepo.save(entity);
    this.logger.log(`Tweet generated (id: ${saved.id}, ${tweet.length} chars)`);

    return { tweet: saved.content, id: saved.id };
  }

  // Aprueba un tweet y lo publica en Twitter. Incluye protección contra doble publicación.
  async approve(tweetId: number): Promise<{
    success: boolean;
    url: string | null;
    alreadyPublished: boolean;
  }> {
    const tweet = await this.tweetRepo.findOne({ where: { id: tweetId } });

    if (!tweet) {
      throw new Error(`Tweet not found: ${tweetId}`);
    }

    // Idempotencia: si ya está publicado, devuelve la URL sin re-publicar
    if (tweet.status === 'published' && tweet.twitter_id) {
      return {
        success: true,
        url: `https://x.com/i/status/${tweet.twitter_id}`,
        alreadyPublished: true,
      };
    }

    if (tweet.status !== 'pending' && tweet.status !== 'approved') {
      throw new Error(`Cannot approve tweet with status '${tweet.status}'`);
    }

    // Primero marca como "approved", luego intenta publicar
    if (tweet.status === 'pending') {
      tweet.status = 'approved';
      await this.tweetRepo.save(tweet);
    }

    // Hasta 2 intentos de publicación con re-lectura de DB (protección contra race conditions)
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Re-lee de DB antes de cada intento (otro proceso podría haberlo publicado)
      const current = await this.tweetRepo.findOne({
        where: { id: tweetId },
      });

      if (!current) {
        throw new Error(`Tweet not found on re-read: ${tweetId}`);
      }

      if (current.status === 'published' && current.twitter_id) {
        return {
          success: true,
          url: `https://x.com/i/status/${current.twitter_id}`,
          alreadyPublished: true,
        };
      }

      try {
        const result = await this.twitterService.postTweet(current.content);
        current.twitter_id = result.id;
        current.status = 'published';
        current.published_at = new Date().toISOString();
        await this.tweetRepo.save(current);
        this.logger.log(
          `Tweet published (id: ${tweetId}, twitter_id: ${result.id})`,
        );
        return { success: true, url: result.url, alreadyPublished: false };
      } catch (error) {
        this.logger.error(
          `Publish attempt ${attempt}/${maxAttempts} failed for tweet ${tweetId}: ${error}`,
        );
        if (attempt < maxAttempts) {
          await this.sleep(2000);
        }
      }
    }

    // Si fallan todos los intentos, queda como "approved" para reintento posterior
    this.logger.error(
      `All publish attempts failed for tweet ${tweetId}, leaving as approved`,
    );
    return { success: false, url: null, alreadyPublished: false };
  }

  // Rechaza un tweet con una razón (feedback loop para mejorar futuros tweets)
  async reject(tweetId: number, reason: string): Promise<GeneratedTweet> {
    const tweet = await this.tweetRepo.findOne({ where: { id: tweetId } });

    if (!tweet) {
      throw new Error(`Tweet not found: ${tweetId}`);
    }

    if (tweet.status !== 'pending') {
      throw new Error(`Cannot reject tweet with status '${tweet.status}'`);
    }

    tweet.status = 'rejected';
    tweet.rejection_reason = reason;

    const saved = await this.tweetRepo.save(tweet);
    this.logger.log(`Tweet rejected (id: ${tweetId}, reason: ${reason})`);
    return saved;
  }

  // Reintenta publicar tweets aprobados que fallaron — llamado por el SchedulerModule
  async retryApproved(): Promise<{
    succeeded: number;
    failed: number;
    maxRetriesExceeded: number;
  }> {
    // Busca tweets aprobados pero sin twitter_id (no publicados aún)
    // IsNull() genera: WHERE twitter_id IS NULL
    const pendingPublish = await this.tweetRepo.find({
      where: { status: 'approved' as TweetStatus, twitter_id: IsNull() },
    });

    let succeeded = 0;
    let failed = 0;
    let maxRetriesExceeded = 0;

    for (const tweet of pendingPublish) {
      // Re-lee de DB para evitar race conditions
      const current = await this.tweetRepo.findOne({
        where: { id: tweet.id },
      });

      if (!current || current.status !== 'approved') {
        continue;
      }

      // Si superó el máximo de reintentos, marca como "failed" definitivamente
      if (current.publish_retry_count >= current.max_publish_retries) {
        current.status = 'failed';
        await this.tweetRepo.save(current);
        this.logger.warn(
          `Tweet ${current.id} exceeded max retries (${current.max_publish_retries})`,
        );
        maxRetriesExceeded++;
        continue;
      }

      current.publish_retry_count++;
      await this.tweetRepo.save(current);

      try {
        const result = await this.twitterService.postTweet(current.content);
        current.twitter_id = result.id;
        current.status = 'published';
        current.published_at = new Date().toISOString();
        await this.tweetRepo.save(current);
        this.logger.log(
          `Retry succeeded for tweet ${current.id} (twitter_id: ${result.id})`,
        );
        succeeded++;
      } catch (error) {
        this.logger.warn(`Retry failed for tweet ${current.id}: ${error}`);
        failed++;
      }
    }

    return { succeeded, failed, maxRetriesExceeded };
  }

  // Calcula estadísticas de todos los tweets para el comando /status de Telegram
  async getStats(): Promise<TweetStats> {
    const all = await this.tweetRepo.find();

    // Inicializa contadores por status
    const counts: Record<TweetStatus, number> = {
      pending: 0,
      approved: 0,
      published: 0,
      rejected: 0,
      failed: 0,
    };

    const today = new Date().toISOString().split('T')[0]; // "2026-03-25"
    let todayCount = 0;

    for (const tweet of all) {
      counts[tweet.status]++;
      if (tweet.created_at.startsWith(today)) {
        todayCount++;
      }
    }

    const lastPublished = await this.tweetRepo.findOne({
      where: { status: 'published' as TweetStatus },
      order: { published_at: 'DESC' },
    });

    // Tasa de aprobación = publicados / (publicados + rechazados) * 100
    const publishedAndRejected = counts.published + counts.rejected;
    const approvalRate =
      publishedAndRejected > 0
        ? Math.round((counts.published / publishedAndRejected) * 100)
        : 0;

    return {
      total: all.length,
      pending: counts.pending,
      approved: counts.approved,
      published: counts.published,
      rejected: counts.rejected,
      failed: counts.failed,
      todayCount,
      lastPublished: lastPublished
        ? {
            content: lastPublished.content,
            published_at: lastPublished.published_at!,
            url: lastPublished.twitter_id
              ? `https://x.com/i/status/${lastPublished.twitter_id}`
              : '',
          }
        : null,
      approvalRate,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
