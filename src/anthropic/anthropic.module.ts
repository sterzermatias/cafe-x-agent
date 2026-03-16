import { Module } from '@nestjs/common';
import { AnthropicService } from './anthropic.service.js';

@Module({
  providers: [AnthropicService],
  exports: [AnthropicService],
})
export class AnthropicModule {}
