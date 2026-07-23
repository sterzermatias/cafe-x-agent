// class-transformer convierte objetos planos a instancias de clases
import { plainToInstance } from 'class-transformer';
// class-validator valida propiedades usando decoradores (como @IsString, @IsNotEmpty)
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  validateSync,
} from 'class-validator';

// Define el "contrato" de variables de entorno: qué se espera y qué es opcional
// Los decoradores actúan como reglas de validación sobre cada propiedad
export class EnvironmentVariables {
  // @IsNotEmpty() = obligatorio — la app no arranca sin esto
  @IsString()
  @IsNotEmpty()
  TELEGRAM_BOT_TOKEN: string;

  @IsString()
  @IsNotEmpty()
  TELEGRAM_ALLOWED_USER_ID: string;

  @IsString()
  @IsNotEmpty()
  TWITTER_CONSUMER_KEY: string;

  @IsString()
  @IsNotEmpty()
  TWITTER_CONSUMER_KEY_SECRET: string;

  @IsString()
  @IsNotEmpty()
  TWITTER_ACCESS_TOKEN: string;

  @IsString()
  @IsNotEmpty()
  TWITTER_ACCESS_TOKEN_SECRET: string;

  @IsString()
  @IsOptional()
  TWITTER_BEARER_TOKEN: string = '';

  @IsString()
  @IsNotEmpty()
  TWITTER_USERNAME: string;

  @IsString()
  @IsNotEmpty()
  ANTHROPIC_API_KEY: string;

  // @IsOptional() = tiene valor por defecto, no es obligatorio en .env
  @IsString()
  @IsOptional()
  CRON_TIMEZONE: string = 'America/Argentina/Buenos_Aires';

  @IsString()
  @IsOptional()
  DB_PATH: string = 'db.sqlite';

  @IsString()
  @IsOptional()
  RSS_FEED_URLS: string = '';

  @IsString()
  @IsOptional()
  ANTHROPIC_HAIKU_MODEL: string = 'claude-haiku-4-5-20251001';

  @IsString()
  @IsOptional()
  ANTHROPIC_SONNET_MODEL: string = 'claude-sonnet-5';

  @IsString()
  @IsOptional()
  TWEET_EXPORT_PATH: string = '';
}

// NestJS llama a esta función al arrancar — si falla, la app no levanta
export function validate(config: Record<string, unknown>) {
  // Convierte el objeto plano de env vars a una instancia de EnvironmentVariables
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  // Ejecuta todas las validaciones de los decoradores de forma síncrona
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }
  return validatedConfig;
}
