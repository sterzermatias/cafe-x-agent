import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

// @Controller() marca esta clase como un controlador HTTP (maneja requests)
// Sin path → responde en la raíz "/"
@Controller()
export class AppController {
  // NestJS inyecta AppService automáticamente
  constructor(private readonly appService: AppService) {}

  // @Get() mapea peticiones GET a esta función → GET /
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
