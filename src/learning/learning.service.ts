// Decoradores de NestJS: Injectable marca la clase como "inyectable" por el sistema de DI
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// InjectRepository conecta una entidad de TypeORM con su repositorio (patrón Repository)
import { InjectRepository } from '@nestjs/typeorm';
// Módulos nativos de Node.js para leer archivos del sistema
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// Repository es el patrón de TypeORM para hacer queries a la base de datos
import { Repository } from 'typeorm';
import {
  AnthropicService,
  type ProfileAnalysisResult,
} from '../anthropic/anthropic.service.js';
import { ContentSnapshot } from '../entities/content-snapshot.entity.js';
import { type GeneratedTweet } from '../entities/generated-tweet.entity.js';
import { ProfileSummary } from '../entities/profile-summary.entity.js';
import { RSSService, type RSSEntry } from '../rss/rss.service.js';

// @Injectable() le dice a NestJS que esta clase puede ser inyectada como dependencia
@Injectable()
export class LearningService {
  // Logger con el nombre de la clase para identificar los mensajes en consola
  private readonly logger = new Logger(LearningService.name);

  // NestJS inyecta automáticamente todas estas dependencias en el constructor (DI)
  constructor(
    private readonly rssService: RSSService,
    private readonly anthropicService: AnthropicService,
    private readonly configService: ConfigService,
    // @InjectRepository() le dice a TypeORM qué entidad manejar con este repo
    @InjectRepository(ProfileSummary)
    private readonly profileRepo: Repository<ProfileSummary>,
    @InjectRepository(ContentSnapshot)
    private readonly snapshotRepo: Repository<ContentSnapshot>,
  ) {}

  // Analiza un archivo JSON con tweets exportados y crea un perfil de estilo
  async analyzeFromExport(exportPath?: string): Promise<ProfileSummary> {
    // Resuelve la ruta del archivo: parámetro > variable de entorno > default
    const resolvedPath = resolve(
      exportPath ??
        this.configService.get<string>('TWEET_EXPORT_PATH') ??
        './data/tweet-export.json',
    );

    if (!existsSync(resolvedPath)) {
      throw new Error(`Tweet export file not found: ${resolvedPath}`);
    }

    // Lee el archivo de forma síncrona y lo parsea como JSON
    let rawData: unknown;
    try {
      const fileContent = readFileSync(resolvedPath, 'utf-8');
      rawData = JSON.parse(fileContent);
    } catch (error) {
      throw new Error(
        `Failed to read or parse tweet export: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Extrae solo el texto de cada tweet, descartando retweets (empiezan con "RT @")
    const tweets = rawData as { full_text?: string; text?: string }[];
    const tweetTexts = tweets
      .map((t) => t.full_text ?? t.text ?? '')
      .filter((text) => text && !text.startsWith('RT @'));

    this.logger.log(
      `Analyzing ${tweetTexts.length} tweets from export (filtered retweets)`,
    );

    // Envía los tweets a Claude para que analice el estilo e intereses del usuario
    const analysis: ProfileAnalysisResult =
      await this.anthropicService.analyzeProfile({ tweets: tweetTexts });

    const now = new Date().toISOString();

    // Patrón upsert manual: busca perfil existente (id: 1) o crea uno nuevo
    let profile = await this.profileRepo.findOne({ where: { id: 1 } });

    if (profile) {
      // Actualiza el perfil existente
      profile.style = analysis.style;
      profile.interests = analysis.interests;
      profile.last_updated = now;
    } else {
      // Crea una nueva instancia (repo.create NO guarda en DB, solo crea el objeto)
      profile = this.profileRepo.create({
        style: analysis.style,
        interests: analysis.interests,
        last_updated: now,
      });
    }

    // repo.save() es el que realmente persiste en la base de datos
    const saved = await this.profileRepo.save(profile);
    this.logger.log(`Profile summary saved (id: ${saved.id})`);
    return saved;
  }

  // Captura contenido de feeds RSS y genera un resumen de temas con IA
  async captureContent(): Promise<ContentSnapshot> {
    let entries: RSSEntry[];

    // Si falla la captura RSS, no rompe todo: degrada gracefully con array vacío
    try {
      entries = await this.rssService.captureFeeds();
    } catch (error) {
      this.logger.warn(
        `RSS capture failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      entries = [];
    }

    // Sin entradas nuevas, devuelve el snapshot más reciente como fallback
    if (entries.length === 0) {
      this.logger.warn(
        'No RSS entries captured, falling back to latest snapshot',
      );
      const latest = await this.snapshotRepo.findOne({
        order: { captured_at: 'DESC' },
        where: {},
      });

      if (!latest) {
        throw new Error(
          'No RSS entries captured and no previous ContentSnapshot available',
        );
      }

      return latest;
    }

    // Claude resume los temas principales de las entradas RSS
    const topicsSummary = await this.anthropicService.summarizeTopics(entries);

    // Set elimina duplicados: extrae nombres únicos de los feeds fuente
    const sourceFeeds = [...new Set(entries.map((e) => e.feedSource))];

    // Crea el snapshot con el resumen, los datos crudos, y los feeds origen
    const snapshot = this.snapshotRepo.create({
      topics_summary: topicsSummary,
      raw_content: entries as unknown as object[],
      source_feeds: sourceFeeds,
      captured_at: new Date().toISOString(),
    });

    const saved = await this.snapshotRepo.save(snapshot);
    this.logger.log(
      `ContentSnapshot saved (id: ${saved.id}, ${entries.length} entries from ${sourceFeeds.length} feeds)`,
    );
    return saved;
  }

  // Refina el perfil usando feedback: tweets aprobados/rechazados enseñan preferencias
  async updateProfileFromFeedback(
    approved: GeneratedTweet[],
    rejected: GeneratedTweet[],
  ): Promise<ProfileSummary> {
    const profile = await this.profileRepo.findOne({ where: { id: 1 } });

    if (!profile) {
      throw new Error('No profile found. Run /aprender first.');
    }

    // Construye un prompt con los tweets aprobados y rechazados como contexto
    const feedbackTweets: string[] = [];

    if (approved.length > 0) {
      feedbackTweets.push(
        'APPROVED tweets (the user liked these, lean into this style):',
      );
      for (const tweet of approved) {
        feedbackTweets.push(`- ${tweet.content}`);
      }
    }

    if (rejected.length > 0) {
      feedbackTweets.push(
        'REJECTED tweets (the user did NOT like these, avoid this style):',
      );
      for (const tweet of rejected) {
        const reason = tweet.rejection_reason
          ? ` [Reason: ${tweet.rejection_reason}]`
          : '';
        feedbackTweets.push(`- ${tweet.content}${reason}`);
      }
    }

    // Arma el prompt completo: perfil actual + feedback → Claude refina el perfil
    const contextPrefix = `Current profile style: ${profile.style}\nCurrent interests: ${profile.interests.join(', ')}\n\nBased on the following feedback from the user, refine the profile. The tweets below represent user preferences:\n`;
    const refinementInput = contextPrefix + feedbackTweets.join('\n');

    const analysis: ProfileAnalysisResult =
      await this.anthropicService.analyzeProfile({
        tweets: [refinementInput],
      });

    // Actualiza el perfil con el análisis refinado
    profile.style = analysis.style;
    profile.interests = analysis.interests;
    profile.last_updated = new Date().toISOString();

    const saved = await this.profileRepo.save(profile);
    this.logger.log('Profile updated from feedback');
    return saved;
  }
}
