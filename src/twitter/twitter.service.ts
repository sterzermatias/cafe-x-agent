import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Bottleneck from 'bottleneck';
import { TwitterApi, type TwitterApiv2 } from 'twitter-api-v2';

@Injectable()
export class TwitterService implements OnModuleInit {
  private readonly logger = new Logger(TwitterService.name);
  private client: TwitterApiv2;
  private limiter: Bottleneck;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const twitterClient = new TwitterApi({
      appKey: this.config.get<string>('TWITTER_APP_KEY')!,
      appSecret: this.config.get<string>('TWITTER_APP_SECRET')!,
      accessToken: this.config.get<string>('TWITTER_ACCESS_TOKEN')!,
      accessSecret: this.config.get<string>('TWITTER_ACCESS_SECRET')!,
    });

    this.client = twitterClient.v2;

    this.limiter = new Bottleneck({
      minTime: 2000,
      maxConcurrent: 1,
    });

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

  private schedule<T>(fn: () => Promise<T>): Promise<T> {
    return this.limiter.schedule(fn);
  }
}
