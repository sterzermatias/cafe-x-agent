import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GeneratedTweet } from '../entities/generated-tweet.entity.js';
import { LearningModule } from '../learning/learning.module.js';
import { TelegramModule } from '../telegram/telegram.module.js';
import { TweetGeneratorModule } from '../tweet-generator/tweet-generator.module.js';
import { SchedulerService } from './scheduler.service.js';

// Automatiza operaciones diarias del agente via cron jobs
// RSS capture 2x/día, propuesta de tweet diaria, retry cada 15min, refinamiento semanal
@Module({
  imports: [
    LearningModule,
    TweetGeneratorModule,
    TelegramModule,
    // Para el cron semanal que consulta tweets aprobados/rechazados de los últimos 7 días
    TypeOrmModule.forFeature([GeneratedTweet]),
  ],
  providers: [SchedulerService],
})
export class SchedulerModule {}
