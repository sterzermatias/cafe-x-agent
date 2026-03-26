import { Module } from '@nestjs/common';
// Alias para evitar colisión de nombres con nuestro ConfigModule
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { validate } from './env.validation.js';

// Wrapper sobre el ConfigModule de NestJS — agrega validación de env vars al arranque
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true, // Disponible en toda la app sin necesidad de re-importar
      validate, // Valida las env vars antes de arrancar
    }),
  ],
})
export class ConfigModule {}
