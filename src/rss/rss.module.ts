import { Module } from '@nestjs/common';
import { RSSService } from './rss.service.js';

@Module({
  providers: [RSSService],
  exports: [RSSService],
})
export class RSSModule {}
