jest.mock('typeorm', () => ({
  Repository: class {},
  Entity: () => () => {},
  Column: () => () => {},
  PrimaryGeneratedColumn: () => () => {},
  OneToMany: () => () => {},
  ManyToOne: () => () => {},
  JoinColumn: () => () => {},
  In: jest.fn((val) => val),
  IsNull: jest.fn(),
  Like: jest.fn((val) => val),
}));

jest.mock('@nestjs/typeorm', () => ({
  InjectRepository: () => () => {},
}));

jest.mock('@nestjs/common', () => {
  const actual = jest.requireActual('@nestjs/common');
  return {
    ...actual,
    Logger: jest.fn().mockImplementation(() => ({
      log: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    })),
  };
});

jest.mock('@anthropic-ai/sdk', () => jest.fn());
jest.mock('rss-parser', () => jest.fn());
jest.mock('twitter-api-v2', () => ({
  TwitterApi: jest.fn(),
}));
jest.mock('bottleneck', () => jest.fn());

import { TweetGeneratorService } from './tweet-generator.service';
import { type GeneratedTweet } from '../entities/generated-tweet.entity';

describe('TweetGeneratorService', () => {
  let service: TweetGeneratorService;

  const mockAnthropicService = {
    generateTweet: jest.fn(),
    validateContent: jest.fn(),
  };

  const mockTwitterService = {
    postTweet: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn().mockReturnValue('claude-sonnet-5'),
  };

  const mockTweetRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    count: jest.fn(),
  };

  const mockProfileRepo = {
    findOne: jest.fn(),
  };

  const mockSnapshotRepo = {
    findOne: jest.fn(),
  };

  const mockProfile = {
    id: 1,
    style: 'casual and witty',
    interests: ['tech', 'music'],
  };

  const mockSnapshot = {
    id: 1,
    topics_summary: 'AI is trending',
    source_feeds: ['feed-a'],
    captured_at: '2026-03-25',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    service = new TweetGeneratorService(
      mockAnthropicService as any,
      mockTwitterService as any,
      mockConfigService as any,
      mockTweetRepo as any,
      mockProfileRepo as any,
      mockSnapshotRepo as any,
    );
  });

  describe('generate', () => {
    beforeEach(() => {
      mockProfileRepo.findOne.mockResolvedValue(mockProfile);
      mockSnapshotRepo.findOne.mockResolvedValue(mockSnapshot);
      mockTweetRepo.find.mockResolvedValue([]);
      mockAnthropicService.generateTweet.mockResolvedValue(
        'This is a great tweet about tech',
      );
      mockAnthropicService.validateContent.mockResolvedValue({ safe: true });
      mockTweetRepo.create.mockImplementation((data) => ({
        id: 1,
        ...data,
      }));
      mockTweetRepo.save.mockImplementation((entity) =>
        Promise.resolve({ ...entity, id: entity.id ?? 1 }),
      );
    });

    it('should load context, generate, validate, and save tweet', async () => {
      const result = await service.generate();

      expect(mockProfileRepo.findOne).toHaveBeenCalled();
      expect(mockSnapshotRepo.findOne).toHaveBeenCalled();
      expect(mockAnthropicService.generateTweet).toHaveBeenCalledWith(
        { style: mockProfile.style, interests: mockProfile.interests },
        mockSnapshot.topics_summary,
        expect.objectContaining({ approved: [], rejected: [] }),
      );
      expect(mockAnthropicService.validateContent).toHaveBeenCalledWith(
        'This is a great tweet about tech',
      );
      expect(mockTweetRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'This is a great tweet about tech',
          status: 'pending',
          generation_context: expect.objectContaining({
            source_type: 'scheduled',
            model_used: 'claude-sonnet-5',
          }),
        }),
      );
      expect(result.tweet).toBe('This is a great tweet about tech');
    });

    it('should throw when no profile found', async () => {
      mockProfileRepo.findOne.mockResolvedValue(null);

      await expect(service.generate()).rejects.toThrow(
        'No profile found. Run /aprender first.',
      );
    });

    it('should set source_type to manual and include manual_topic', async () => {
      const result = await service.generate({ topic: 'NestJS tips' });

      expect(mockAnthropicService.generateTweet).toHaveBeenCalledWith(
        expect.anything(),
        'Topic requested by user: NestJS tips',
        expect.anything(),
      );
      expect(mockTweetRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          generation_context: expect.objectContaining({
            source_type: 'manual',
            manual_topic: 'NestJS tips',
          }),
        }),
      );
      expect(result.tweet).toBeDefined();
    });

    it('should retry then truncate when tweet is too long', async () => {
      const longTweet = 'x'.repeat(300);
      mockAnthropicService.generateTweet
        .mockResolvedValueOnce(longTweet)
        .mockResolvedValueOnce(longTweet);

      const result = await service.generate();

      expect(mockAnthropicService.generateTweet).toHaveBeenCalledTimes(2);
      expect(result.tweet).toHaveLength(280);
      expect(result.tweet).toMatch(/\.\.\.$/);
    });

    it('should retry up to 3 times on content validation failure and throw', async () => {
      mockAnthropicService.validateContent.mockResolvedValue({
        safe: false,
        reason: 'inappropriate',
      });

      await expect(service.generate()).rejects.toThrow(
        'Tweet failed content validation after 3 attempts: inappropriate',
      );

      expect(mockAnthropicService.generateTweet).toHaveBeenCalledTimes(3);
      expect(mockAnthropicService.validateContent).toHaveBeenCalledTimes(3);
    });
  });

  describe('approve', () => {
    it('should post tweet and update status to published', async () => {
      const tweet = {
        id: 1,
        content: 'Hello world',
        status: 'pending',
        twitter_id: null,
      };
      mockTweetRepo.findOne.mockResolvedValue(tweet);
      mockTweetRepo.save.mockImplementation((entity) =>
        Promise.resolve(entity),
      );
      mockTwitterService.postTweet.mockResolvedValue({
        id: 'tw123',
        url: 'https://x.com/i/status/tw123',
      });

      const result = await service.approve(1);

      expect(result.success).toBe(true);
      expect(result.url).toBe('https://x.com/i/status/tw123');
      expect(result.alreadyPublished).toBe(false);
    });

    it('should return alreadyPublished without re-posting', async () => {
      const tweet = {
        id: 1,
        content: 'Hello world',
        status: 'published',
        twitter_id: 'tw123',
      };
      mockTweetRepo.findOne.mockResolvedValue(tweet);

      const result = await service.approve(1);

      expect(result.alreadyPublished).toBe(true);
      expect(result.success).toBe(true);
      expect(mockTwitterService.postTweet).not.toHaveBeenCalled();
    });

    it('should return success false on publish failure', async () => {
      const tweet = {
        id: 1,
        content: 'Hello',
        status: 'pending',
        twitter_id: null,
      };
      mockTweetRepo.findOne.mockResolvedValue(tweet);
      mockTweetRepo.save.mockImplementation((entity) =>
        Promise.resolve(entity),
      );
      mockTwitterService.postTweet.mockRejectedValue(
        new Error('Twitter API error'),
      );
      jest
        .spyOn(service as any, 'sleep')
        .mockResolvedValue(undefined);

      const result = await service.approve(1);

      expect(result.success).toBe(false);
      expect(result.url).toBeNull();
    });
  });

  describe('reject', () => {
    it('should update status to rejected with reason', async () => {
      const tweet = {
        id: 1,
        content: 'Bad tweet',
        status: 'pending',
        rejection_reason: null,
      };
      mockTweetRepo.findOne.mockResolvedValue(tweet);
      mockTweetRepo.save.mockImplementation((entity) =>
        Promise.resolve(entity),
      );

      const result = await service.reject(1, 'too generic');

      expect(result.status).toBe('rejected');
      expect(result.rejection_reason).toBe('too generic');
      expect(mockTweetRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'rejected',
          rejection_reason: 'too generic',
        }),
      );
    });
  });

  describe('getStats', () => {
    it('should return correct counts and approval rate', async () => {
      const tweets = [
        { status: 'published', created_at: '2026-03-26T10:00:00Z' },
        { status: 'published', created_at: '2026-03-24T10:00:00Z' },
        { status: 'rejected', created_at: '2026-03-26T11:00:00Z' },
        { status: 'pending', created_at: '2026-03-26T12:00:00Z' },
      ] as GeneratedTweet[];

      mockTweetRepo.find.mockResolvedValue(tweets);
      mockTweetRepo.findOne.mockResolvedValue({
        content: 'Last published',
        published_at: '2026-03-26T10:00:00Z',
        twitter_id: 'tw999',
      });

      const stats = await service.getStats();

      expect(stats.total).toBe(4);
      expect(stats.published).toBe(2);
      expect(stats.rejected).toBe(1);
      expect(stats.pending).toBe(1);
      // approval rate = 2 / (2 + 1) * 100 = 67
      expect(stats.approvalRate).toBe(67);
      expect(stats.lastPublished).toEqual({
        content: 'Last published',
        published_at: '2026-03-26T10:00:00Z',
        url: 'https://x.com/i/status/tw999',
      });
    });
  });
});
