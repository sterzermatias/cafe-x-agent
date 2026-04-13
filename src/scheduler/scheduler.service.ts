import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, In, Repository } from 'typeorm';
import { GeneratedTweet } from '../entities/generated-tweet.entity.js';
import { LearningService } from '../learning/learning.service.js';
import { TelegramService } from '../telegram/telegram.service.js';
import { TweetGeneratorService } from '../tweet-generator/tweet-generator.service.js';

// Zona horaria hardcodeada en los decoradores @Cron (no pueden ser dinámicos)
const HARDCODED_TIMEZONE = 'America/Argentina/Buenos_Aires';

// Cron jobs que automatizan la operación diaria del agente
// Captura RSS, genera tweets, reintenta publicaciones y refina el perfil semanalmente
@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    private readonly learningService: LearningService,
    private readonly tweetGeneratorService: TweetGeneratorService,
    private readonly telegramService: TelegramService,
    private readonly configService: ConfigService,
    @InjectRepository(GeneratedTweet)
    private readonly tweetRepo: Repository<GeneratedTweet>,
  ) {}

  // Valida que la timezone configurada en .env matchee con la hardcodeada en los decoradores
  // @Cron no acepta valores dinámicos — si cambiás CRON_TIMEZONE sin actualizar los decoradores,
  // los crons corren en la zona horaria vieja
  onModuleInit() {
    const configuredTz = this.configService.get<string>(
      'CRON_TIMEZONE',
      HARDCODED_TIMEZONE,
    );

    if (configuredTz !== HARDCODED_TIMEZONE) {
      this.logger.warn(
        `CRON_TIMEZONE is set to '${configuredTz}' but decorators use '${HARDCODED_TIMEZONE}'. ` +
          'Update the decorator timeZone values in scheduler.service.ts to match.',
      );
    }

    this.logger.log(`Scheduler initialized (timezone: ${configuredTz})`);
  }

  // Cron 1: Captura contenido RSS 2 veces al día a las 9:00 y 18:00 hora Argentina
  // Alimenta al agente con contenido fresco para generar tweets relevantes
  @Cron('0 9,18 * * *', { timeZone: HARDCODED_TIMEZONE })
  async handleRssCapture(): Promise<void> {
    this.logger.log('Cron: RSS content capture — START');

    try {
      const snapshot = await this.learningService.captureContent();
      this.logger.log(
        `Cron: RSS content capture — DONE (snapshot id: ${snapshot.id})`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Cron: RSS content capture — FAILED: ${message}`);
      await this.safeNotify(`❌ RSS capture failed: ${message}`);
    }
  }

  // Cron 2: Genera 3 tweets al día a las 9:30, 18:30 y 21:30 hora Argentina
  // Cada uno se envía por Telegram para que el usuario lo apruebe/rechace
  @Cron('30 9,18,21 * * *', { timeZone: HARDCODED_TIMEZONE })
  async handleDailyTweetProposal(): Promise<void> {
    this.logger.log('Cron: Daily tweet proposal — START');

    try {
      const result = await this.tweetGeneratorService.generate();
      this.logger.log(`Cron: Daily tweet proposal — DONE (id: ${result.id})`);
      await this.safeNotify(
        `📝 Tweet propuesto:\n\n${result.tweet}\n\nUsá /status o el bot para aprobar/rechazar.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Cron: Daily tweet proposal — FAILED: ${message}`);
      await this.safeNotify(`❌ Tweet generation failed: ${message}`);
    }
  }

  // Cron 3: Reintenta publicar tweets aprobados cada 15 minutos
  // Si el usuario aprobó un tweet pero la publicación en Twitter falló,
  // este cron lo reintenta automáticamente hasta max_publish_retries
  @Cron('*/15 * * * *')
  async handleRetryApproved(): Promise<void> {
    this.logger.log('Cron: Retry approved tweets — START');

    try {
      const result = await this.tweetGeneratorService.retryApproved();
      this.logger.log(
        `Cron: Retry approved tweets — DONE (succeeded: ${result.succeeded}, failed: ${result.failed})`,
      );

      // Solo notifica si hubo algo relevante: publicaciones exitosas o tweets que agotaron reintentos
      if (result.succeeded > 0) {
        await this.safeNotify(
          `✅ ${result.succeeded} tweet(s) publicados en reintento.`,
        );
      }

      if (result.maxRetriesExceeded > 0) {
        await this.safeNotify(
          `⚠️ ${result.maxRetriesExceeded} tweet(s) alcanzaron el máximo de reintentos.`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Cron: Retry approved tweets — FAILED: ${message}`);
      // No notifica al usuario por errores de retry — solo loguea
    }
  }

  // Cron 4: Refinamiento semanal del perfil basado en feedback (Domingos 14:00 hora Argentina)
  // Carga tweets aprobados y rechazados de los últimos 7 días y le pide a Claude
  // que ajuste el perfil del usuario para mejorar futuras generaciones
  @Cron('0 14 * * 0', { timeZone: HARDCODED_TIMEZONE })
  async handleWeeklyProfileRefinement(): Promise<void> {
    this.logger.log('Cron: Weekly profile refinement — START');

    try {
      // Calcula la fecha de hace 7 días para el filtro temporal
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const sinceDate = sevenDaysAgo.toISOString();

      // Carga tweets aprobados/publicados y rechazados de la última semana
      const approved = await this.tweetRepo.find({
        where: {
          status: In(['approved', 'published']),
          created_at: MoreThanOrEqual(sinceDate),
        },
      });

      const rejected = await this.tweetRepo.find({
        where: {
          status: 'rejected' as const,
          created_at: MoreThanOrEqual(sinceDate),
        },
      });

      // Si no hubo actividad, no tiene sentido refinar el perfil
      if (approved.length === 0 && rejected.length === 0) {
        this.logger.log(
          'Cron: Weekly profile refinement — SKIPPED (no feedback in last 7 days)',
        );
        return;
      }

      const profile = await this.learningService.updateProfileFromFeedback(
        approved,
        rejected,
      );

      this.logger.log(
        `Cron: Weekly profile refinement — DONE (profile id: ${profile.id})`,
      );
      await this.safeNotify(
        `🧠 Perfil refinado con feedback semanal.\n` +
          `Aprobados: ${approved.length}, Rechazados: ${rejected.length}\n` +
          `Estilo actualizado: ${profile.style}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Cron: Weekly profile refinement — FAILED: ${message}`);
      await this.safeNotify(`❌ Weekly profile refinement failed: ${message}`);
    }
  }

  // Wrapper para notificaciones que no crashea el cron si Telegram falla
  private async safeNotify(message: string): Promise<void> {
    try {
      await this.telegramService.sendNotification(message);
    } catch (error) {
      this.logger.error(`Failed to send notification: ${error}`);
    }
  }
}
