import { Module } from '@nestjs/common';
import { RSSService } from './rss.service.js';

// Módulo que encapsula la lógica de captura de feeds RSS
@Module({
  providers: [RSSService],
  exports: [RSSService],
})
export class RSSModule {}
