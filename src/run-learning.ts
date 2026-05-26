import { Module, Logger } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { validate } from './config/env.validation.js';
import { ContentSnapshot } from './entities/content-snapshot.entity.js';
import { GeneratedTweet } from './entities/generated-tweet.entity.js';
import { ProfileSummary } from './entities/profile-summary.entity.js';
import { LearningModule } from './learning/learning.module.js';
import { LearningService } from './learning/learning.service.js';

// Lite module: solo lo necesario para LearningService — sin Telegram/Scheduler/Twitter
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'better-sqlite3' as const,
        database: config.get<string>('DB_PATH', 'db.sqlite'),
        entities: [ProfileSummary, GeneratedTweet, ContentSnapshot],
        synchronize: true,
      }),
      dataSourceFactory: async (options) => {
        const { DataSource } = await import('typeorm');
        const ds = new DataSource(options!);
        await ds.initialize();
        await ds.query('PRAGMA journal_mode = WAL');
        return ds;
      },
    }),
    LearningModule,
  ],
})
class LearningRunnerModule {}

async function main() {
  const logger = new Logger('run-learning');
  const app = await NestFactory.createApplicationContext(LearningRunnerModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const learning = app.get(LearningService);
    logger.log('Starting analyzeFromExport() against data/tweet-export.json');
    const profile = await learning.analyzeFromExport();
    logger.log(`Done. ProfileSummary id=${profile.id}`);
    logger.log(`last_updated: ${profile.last_updated}`);
    logger.log(`interests (${profile.interests.length}): ${profile.interests.join(', ')}`);
    logger.log(`style preview: ${profile.style.slice(0, 400)}${profile.style.length > 400 ? '…' : ''}`);
  } finally {
    await app.close();
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
