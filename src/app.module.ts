import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnthropicModule } from './anthropic/anthropic.module.js';
import { validate } from './config/env.validation.js';
import { FeedSnapshot } from './entities/feed-snapshot.entity.js';
import { GeneratedTweet } from './entities/generated-tweet.entity.js';
import { ProfileSummary } from './entities/profile-summary.entity.js';
import { RSSModule } from './rss/rss.module.js';
import { TwitterModule } from './twitter/twitter.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'better-sqlite3' as const,
        database: config.get<string>('DB_PATH', 'db.sqlite'),
        entities: [ProfileSummary, GeneratedTweet, FeedSnapshot],
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
    ScheduleModule.forRoot(),
    AnthropicModule,
    RSSModule,
    TwitterModule,
  ],
})
export class AppModule {}
