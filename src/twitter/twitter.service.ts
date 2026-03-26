import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// Bottleneck = rate limiter — controla cuántas llamadas por segundo se hacen a la API
import Bottleneck from 'bottleneck';
import { TwitterApi, type TwitterApiv2 } from 'twitter-api-v2';

// Publish-only: Free tier de X API solo permite postear/borrar tweets y lookup de usuario
@Injectable()
export class TwitterService implements OnModuleInit {
  private readonly logger = new Logger(TwitterService.name);
  private client: TwitterApiv2;
  private limiter: Bottleneck;

  constructor(private readonly config: ConfigService) {}

  // OnModuleInit: NestJS llama a este método después de crear la instancia
  // Ideal para inicializar clientes que necesitan config (no se puede hacer en el constructor)
  onModuleInit() {
    // OAuth 1.0a — autenticación con 4 tokens (app + user)
    const twitterClient = new TwitterApi({
      appKey: this.config.get<string>('TWITTER_APP_KEY')!,
      appSecret: this.config.get<string>('TWITTER_APP_SECRET')!,
      accessToken: this.config.get<string>('TWITTER_ACCESS_TOKEN')!,
      accessSecret: this.config.get<string>('TWITTER_ACCESS_SECRET')!,
    });

    // .v2 usa la API v2 de Twitter (más moderna que v1.1)
    this.client = twitterClient.v2;

    // Rate limiter: máximo 1 request cada 2 segundos, sin concurrencia
    this.limiter = new Bottleneck({
      minTime: 2000,
      maxConcurrent: 1,
    });

    // Si recibe 429 (rate limit), reintenta con backoff progresivo hasta 3 veces
    this.limiter.on('failed', (error: unknown, jobInfo) => {
      const retryCount = jobInfo.retryCount;
      const errorCode = (error as Record<string, unknown>)?.code;
      if (retryCount < 3 && errorCode === 429) {
        const delay = (retryCount + 1) * 5000;
        this.logger.warn(
          `Rate limited (429). Retry ${retryCount + 1}/3 in ${delay}ms`,
        );
        return delay;
      }
    });

    this.logger.log('Twitter client initialized with rate limiter');
  }

  // Publica un tweet y devuelve el ID + URL
  async postTweet(content: string): Promise<{ id: string; url: string }> {
    try {
      const result = await this.schedule(() => this.client.tweet(content));
      const id = result.data.id;
      const url = `https://x.com/i/status/${id}`;
      this.logger.log(`Tweet posted: ${id}`);
      return { id, url };
    } catch (error) {
      this.logger.error(`Failed to post tweet: ${error}`);
      throw error;
    }
  }

  async deleteTweet(tweetId: string): Promise<boolean> {
    try {
      const result = await this.schedule(() =>
        this.client.deleteTweet(tweetId),
      );
      this.logger.log(`Tweet deleted: ${tweetId}`);
      return result.data.deleted;
    } catch (error) {
      this.logger.error(`Failed to delete tweet ${tweetId}: ${error}`);
      throw error;
    }
  }

  async lookupUser(username: string): Promise<{
    id: string;
    name: string;
    username: string;
    description?: string;
    publicMetrics?: Record<string, number>;
  }> {
    try {
      const result = await this.schedule(() =>
        this.client.userByUsername(username, {
          'user.fields': ['description', 'public_metrics'],
        }),
      );
      // Destructuring: extrae propiedades del objeto y renombra "username" a "handle"
      const {
        id,
        name,
        username: handle,
        description,
        public_metrics,
      } = result.data;
      this.logger.log(`User lookup: @${handle} (${id})`);
      return {
        id,
        name,
        username: handle,
        description,
        publicMetrics: public_metrics,
      };
    } catch (error) {
      this.logger.error(`Failed to lookup user @${username}: ${error}`);
      throw error;
    }
  }

  // Wrapper privado: todas las llamadas pasan por el rate limiter
  private schedule<T>(fn: () => Promise<T>): Promise<T> {
    return this.limiter.schedule(fn);
  }
}
