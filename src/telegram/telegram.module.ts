import { Module } from '@nestjs/common';
import { LearningModule } from '../learning/learning.module.js';
import { TweetGeneratorModule } from '../tweet-generator/tweet-generator.module.js';
import { TelegramService } from './telegram.service.js';

// Interfaz de usuario vía Telegram — comandos, aprobaciones y notificaciones
@Module({
  imports: [LearningModule, TweetGeneratorModule],
  providers: [TelegramService],
  exports: [TelegramService],
})
export class TelegramModule {}
