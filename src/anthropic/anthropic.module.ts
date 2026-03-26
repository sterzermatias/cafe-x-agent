import { Module } from '@nestjs/common';
import { AnthropicService } from './anthropic.service.js';

// Capa de IA — expone AnthropicService para análisis, generación y validación con Claude
@Module({
  providers: [AnthropicService],
  exports: [AnthropicService],
})
export class AnthropicModule {}
