import { plainToInstance } from 'class-transformer';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  validateSync,
} from 'class-validator';

export class EnvironmentVariables {
  @IsString()
  @IsNotEmpty()
  TELEGRAM_BOT_TOKEN: string;

  @IsString()
  @IsNotEmpty()
  TELEGRAM_ALLOWED_USER_ID: string;

  @IsString()
  @IsNotEmpty()
  TWITTER_APP_KEY: string;

  @IsString()
  @IsNotEmpty()
  TWITTER_APP_SECRET: string;

  @IsString()
  @IsNotEmpty()
  TWITTER_ACCESS_TOKEN: string;

  @IsString()
  @IsNotEmpty()
  TWITTER_ACCESS_SECRET: string;

  @IsString()
  @IsNotEmpty()
  TWITTER_USERNAME: string;

  @IsString()
  @IsNotEmpty()
  ANTHROPIC_API_KEY: string;

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
  ANTHROPIC_SONNET_MODEL: string = 'claude-sonnet-4-20250514';

  @IsString()
  @IsOptional()
  TWEET_EXPORT_PATH: string = '';
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(errors.toString());
  }
  return validatedConfig;
}
