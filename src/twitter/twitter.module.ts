import { Module } from '@nestjs/common';
import { TwitterService } from './twitter.service.js';

// providers: registra el servicio para que DI lo pueda crear
// exports: lo hace disponible para otros módulos que importen TwitterModule
@Module({
  providers: [TwitterService],
  exports: [TwitterService],
})
export class TwitterModule {}
