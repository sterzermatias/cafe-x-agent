import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContentSnapshot } from '../entities/content-snapshot.entity.js';
import { GeneratedTweet } from '../entities/generated-tweet.entity.js';
import { HealthController } from './health.controller.js';

// Endpoint de monitoreo — expone GET /health para verificar estado del agente en la Pi
@Module({
  imports: [TypeOrmModule.forFeature([GeneratedTweet, ContentSnapshot])],
  controllers: [HealthController],
})
export class HealthModule {}
