import { Injectable } from '@nestjs/common';

// Servicio scaffold de NestJS — se reemplazará por HealthModule eventualmente
@Injectable()
export class AppService {
  getHello(): string {
    return 'Hello World!';
  }
}
