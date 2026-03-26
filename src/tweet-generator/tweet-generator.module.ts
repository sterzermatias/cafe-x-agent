import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnthropicModule } from '../anthropic/anthropic.module.js';
import { ContentSnapshot } from '../entities/content-snapshot.entity.js';
import { GeneratedTweet } from '../entities/generated-tweet.entity.js';
import { ProfileSummary } from '../entities/profile-summary.entity.js';
import { TwitterModule } from '../twitter/twitter.module.js';
import { TweetGeneratorService } from './tweet-generator.service.js';

// Core del agente — genera tweets, maneja aprobaciones/rechazos y publica en Twitter
@Module({
  imports: [
    AnthropicModule, // Para generar y validar tweets con Claude
    TwitterModule, // Para publicar tweets aprobados
    // Necesita 3 entidades: el tweet generado, el perfil del usuario, y el snapshot de contenido
    TypeOrmModule.forFeature([GeneratedTweet, ProfileSummary, ContentSnapshot]),
  ],
  providers: [TweetGeneratorService],
  exports: [TweetGeneratorService],
})
export class TweetGeneratorModule {}
