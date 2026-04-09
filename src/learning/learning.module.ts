import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnthropicModule } from '../anthropic/anthropic.module.js';
import { ContentSnapshot } from '../entities/content-snapshot.entity.js';
import { ProfileSummary } from '../entities/profile-summary.entity.js';
import { RSSModule } from '../rss/rss.module.js';
import { LearningService } from './learning.service.js';

// Módulo de aprendizaje — analiza tweets exportados y contenido RSS para construir el perfil
@Module({
  imports: [
    RSSModule, // Para capturar contenido de feeds
    AnthropicModule, // Para analizar con Claude
    // forFeature registra repos de entidades específicas para este módulo (scoped)
    TypeOrmModule.forFeature([ProfileSummary, ContentSnapshot]),
  ],
  providers: [LearningService],
  exports: [LearningService],
})
export class LearningModule {}
