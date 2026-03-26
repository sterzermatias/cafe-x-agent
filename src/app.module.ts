import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnthropicModule } from './anthropic/anthropic.module.js';
import { validate } from './config/env.validation.js';
import { ContentSnapshot } from './entities/content-snapshot.entity.js';
import { GeneratedTweet } from './entities/generated-tweet.entity.js';
import { ProfileSummary } from './entities/profile-summary.entity.js';
import { LearningModule } from './learning/learning.module.js';
import { RSSModule } from './rss/rss.module.js';
import { TelegramModule } from './telegram/telegram.module.js';
import { TweetGeneratorModule } from './tweet-generator/tweet-generator.module.js';
import { TwitterModule } from './twitter/twitter.module.js';

// Módulo raíz — registra TODOS los módulos de la app y configura servicios globales
@Module({
  imports: [
    // ConfigModule lee las variables de entorno (.env) y las valida con la función validate
    // isGlobal: true hace que ConfigService esté disponible en TODA la app sin re-importar
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
    }),
    // forRootAsync permite configurar TypeORM de forma asíncrona (necesita ConfigService)
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      // useFactory es un patrón de NestJS: función que recibe dependencias y retorna config
      useFactory: (config: ConfigService) => ({
        type: 'better-sqlite3' as const,
        database: config.get<string>('DB_PATH', 'db.sqlite'),
        entities: [ProfileSummary, GeneratedTweet, ContentSnapshot],
        // synchronize: true auto-crea tablas en dev (NUNCA usar en producción)
        synchronize: true,
      }),
      // Factory custom para inicializar SQLite con WAL mode (mejor rendimiento concurrente)
      dataSourceFactory: async (options) => {
        const { DataSource } = await import('typeorm');
        const ds = new DataSource(options!);
        await ds.initialize();
        await ds.query('PRAGMA journal_mode = WAL');
        return ds;
      },
    }),
    // Habilita cron jobs y tareas programadas via @nestjs/schedule
    ScheduleModule.forRoot(),
    // Módulos de la aplicación — cada uno encapsula una responsabilidad
    AnthropicModule,
    RSSModule,
    TwitterModule,
    LearningModule,
    TweetGeneratorModule,
    TelegramModule,
  ],
})
export class AppModule {}
