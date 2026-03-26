import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TwitterService } from './twitter.service';

const mockV2 = {
  tweet: jest.fn(),
  deleteTweet: jest.fn(),
  userByUsername: jest.fn(),
};

jest.mock('twitter-api-v2', () => ({
  TwitterApi: jest.fn().mockImplementation(() => ({
    v2: mockV2,
  })),
}));

jest.mock('bottleneck', () => {
  return jest.fn().mockImplementation(() => ({
    schedule: (fn: () => Promise<unknown>) => fn(),
    on: jest.fn(),
  }));
});

describe('TwitterService', () => {
  let service: TwitterService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TwitterService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config: Record<string, string> = {
                TWITTER_CONSUMER_KEY: 'fake-consumer-key',
                TWITTER_CONSUMER_KEY_SECRET: 'fake-consumer-secret',
                TWITTER_ACCESS_TOKEN: 'fake-access-token',
                TWITTER_ACCESS_TOKEN_SECRET: 'fake-access-secret',
              };
              return config[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<TwitterService>(TwitterService);
    service.onModuleInit();
  });

  describe('onModuleInit', () => {
    it('should initialize Twitter client and Bottleneck limiter', () => {
      const { TwitterApi } = jest.requireMock('twitter-api-v2');
      expect(TwitterApi).toHaveBeenCalledWith({
        appKey: 'fake-consumer-key',
        appSecret: 'fake-consumer-secret',
        accessToken: 'fake-access-token',
        accessSecret: 'fake-access-secret',
      });

      const Bottleneck = jest.requireMock('bottleneck');
      expect(Bottleneck).toHaveBeenCalledWith({
        minTime: 2000,
        maxConcurrent: 1,
      });
    });
  });

  describe('postTweet', () => {
    it('should call twitter API and return id and url', async () => {
      mockV2.tweet.mockResolvedValue({
        data: { id: '12345' },
      });

      const result = await service.postTweet('Hello world');

      expect(mockV2.tweet).toHaveBeenCalledWith('Hello world');
      expect(result).toEqual({
        id: '12345',
        url: 'https://x.com/i/status/12345',
      });
    });

    it('should log error and rethrow on failure', async () => {
      const error = new Error('API error');
      mockV2.tweet.mockRejectedValue(error);

      await expect(service.postTweet('fail')).rejects.toThrow('API error');
    });
  });

  describe('deleteTweet', () => {
    it('should call deleteTweet and return boolean', async () => {
      mockV2.deleteTweet.mockResolvedValue({
        data: { deleted: true },
      });

      const result = await service.deleteTweet('12345');

      expect(mockV2.deleteTweet).toHaveBeenCalledWith('12345');
      expect(result).toBe(true);
    });
  });

  describe('lookupUser', () => {
    it('should call userByUsername and map response correctly', async () => {
      mockV2.userByUsername.mockResolvedValue({
        data: {
          id: '99',
          name: 'Test User',
          username: 'testuser',
          description: 'A test user',
          public_metrics: {
            followers_count: 100,
            following_count: 50,
          },
        },
      });

      const result = await service.lookupUser('testuser');

      expect(mockV2.userByUsername).toHaveBeenCalledWith('testuser', {
        'user.fields': ['description', 'public_metrics'],
      });
      expect(result).toEqual({
        id: '99',
        name: 'Test User',
        username: 'testuser',
        description: 'A test user',
        publicMetrics: {
          followers_count: 100,
          following_count: 50,
        },
      });
    });
  });
});
