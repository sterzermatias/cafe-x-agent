import { Module } from '@nestjs/common';
import { TwitterService } from './twitter.service.js';

@Module({
  providers: [TwitterService],
  exports: [TwitterService],
})
export class TwitterModule {}
