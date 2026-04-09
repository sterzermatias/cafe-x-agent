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

jest.mock('node:fs', () => ({
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
}));

jest.mock('rss-parser', () => jest.fn());
jest.mock('@anthropic-ai/sdk', () => jest.fn());

import { existsSync, readFileSync } from 'node:fs';
import { LearningService } from './learning.service';

const mockedExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockedReadFileSync = readFileSync as jest.MockedFunction<
  typeof readFileSync
>;

describe('LearningService', () => {
  let service: LearningService;

  const mockAnthropicService = {
    analyzeProfile: jest.fn(),
    summarizeTopics: jest.fn(),
  };

  const mockRSSService = {
    captureFeeds: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockProfileRepo = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockSnapshotRepo = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    service = new LearningService(
      mockRSSService as any,
      mockAnthropicService as any,
      mockConfigService as any,
      mockProfileRepo as any,
      mockSnapshotRepo as any,
    );
  });

  describe('analyzeFromExport', () => {
    const mockAnalysis = {
      style: 'casual and witty',
      interests: ['tech', 'music'],
    };

    const tweetsJson = JSON.stringify([
      { full_text: 'Hello world' },
      { full_text: 'RT @someone: retweet this' },
      { text: 'Another tweet' },
    ]);

    it('should read file, filter retweets, analyze profile, and save', async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(tweetsJson);
      mockAnthropicService.analyzeProfile.mockResolvedValue(mockAnalysis);
      mockProfileRepo.findOne.mockResolvedValue(null);
      const created = { id: 1, ...mockAnalysis, last_updated: 'now' };
      mockProfileRepo.create.mockReturnValue(created);
      mockProfileRepo.save.mockResolvedValue(created);

      const result = await service.analyzeFromExport('/tmp/tweets.json');

      expect(mockedExistsSync).toHaveBeenCalledWith('/tmp/tweets.json');
      expect(mockAnthropicService.analyzeProfile).toHaveBeenCalledWith({
        tweets: ['Hello world', 'Another tweet'],
      });
      expect(result.id).toBe(1);
    });

    it('should create new profile when none exists', async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(tweetsJson);
      mockAnthropicService.analyzeProfile.mockResolvedValue(mockAnalysis);
      mockProfileRepo.findOne.mockResolvedValue(null);
      const created = { id: 1, ...mockAnalysis };
      mockProfileRepo.create.mockReturnValue(created);
      mockProfileRepo.save.mockResolvedValue(created);

      await service.analyzeFromExport('/tmp/tweets.json');

      expect(mockProfileRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          style: 'casual and witty',
          interests: ['tech', 'music'],
        }),
      );
      expect(mockProfileRepo.save).toHaveBeenCalledWith(created);
    });

    it('should update existing profile when one exists (id: 1)', async () => {
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue(tweetsJson);
      mockAnthropicService.analyzeProfile.mockResolvedValue(mockAnalysis);
      const existing = {
        id: 1,
        style: 'old style',
        interests: ['old'],
        last_updated: 'old',
      };
      mockProfileRepo.findOne.mockResolvedValue(existing);
      mockProfileRepo.save.mockResolvedValue({
        ...existing,
        ...mockAnalysis,
      });

      await service.analyzeFromExport('/tmp/tweets.json');

      expect(mockProfileRepo.create).not.toHaveBeenCalled();
      expect(mockProfileRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 1,
          style: 'casual and witty',
          interests: ['tech', 'music'],
        }),
      );
    });

    it('should throw when file not found', async () => {
      mockedExistsSync.mockReturnValue(false);

      await expect(
        service.analyzeFromExport('/missing/file.json'),
      ).rejects.toThrow('Tweet export file not found: /missing/file.json');
    });
  });

  describe('captureContent', () => {
    const mockEntries = [
      {
        title: 'News 1',
        link: 'http://example.com/1',
        contentSnippet: 'Snippet 1',
        pubDate: '2026-03-25',
        feedSource: 'feed-a',
      },
      {
        title: 'News 2',
        link: 'http://example.com/2',
        contentSnippet: 'Snippet 2',
        pubDate: '2026-03-25',
        feedSource: 'feed-b',
      },
    ];

    it('should capture feeds, summarize topics, and save snapshot', async () => {
      mockRSSService.captureFeeds.mockResolvedValue(mockEntries);
      mockAnthropicService.summarizeTopics.mockResolvedValue(
        'Tech is trending',
      );
      const snapshot = { id: 1, topics_summary: 'Tech is trending' };
      mockSnapshotRepo.create.mockReturnValue(snapshot);
      mockSnapshotRepo.save.mockResolvedValue(snapshot);

      const result = await service.captureContent();

      expect(mockRSSService.captureFeeds).toHaveBeenCalled();
      expect(mockAnthropicService.summarizeTopics).toHaveBeenCalledWith(
        mockEntries,
      );
      expect(mockSnapshotRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          topics_summary: 'Tech is trending',
          source_feeds: ['feed-a', 'feed-b'],
        }),
      );
      expect(result).toEqual(snapshot);
    });

    it('should fall back to latest snapshot on RSS failure', async () => {
      mockRSSService.captureFeeds.mockRejectedValue(new Error('RSS down'));
      const latestSnapshot = {
        id: 5,
        topics_summary: 'cached topics',
        captured_at: '2026-03-24',
      };
      mockSnapshotRepo.findOne.mockResolvedValue(latestSnapshot);

      const result = await service.captureContent();

      expect(result).toEqual(latestSnapshot);
      expect(mockAnthropicService.summarizeTopics).not.toHaveBeenCalled();
    });

    it('should throw when no entries and no previous snapshot', async () => {
      mockRSSService.captureFeeds.mockResolvedValue([]);
      mockSnapshotRepo.findOne.mockResolvedValue(null);

      await expect(service.captureContent()).rejects.toThrow(
        'No RSS entries captured and no previous ContentSnapshot available',
      );
    });
  });

  describe('updateProfileFromFeedback', () => {
    it('should build feedback prompt and update profile', async () => {
      const profile = {
        id: 1,
        style: 'casual',
        interests: ['tech'],
        last_updated: 'old',
      };
      mockProfileRepo.findOne.mockResolvedValue(profile);

      const newAnalysis = {
        style: 'refined casual',
        interests: ['tech', 'ai'],
      };
      mockAnthropicService.analyzeProfile.mockResolvedValue(newAnalysis);
      mockProfileRepo.save.mockResolvedValue({
        ...profile,
        ...newAnalysis,
      });

      const approved = [{ content: 'Great tweet!' }] as any[];
      const rejected = [
        { content: 'Bad tweet', rejection_reason: 'too generic' },
      ] as any[];

      const result = await service.updateProfileFromFeedback(
        approved,
        rejected,
      );

      expect(mockAnthropicService.analyzeProfile).toHaveBeenCalledWith({
        tweets: [expect.stringContaining('APPROVED tweets')],
      });
      expect(
        mockAnthropicService.analyzeProfile.mock.calls[0][0].tweets[0],
      ).toContain('REJECTED tweets');
      expect(
        mockAnthropicService.analyzeProfile.mock.calls[0][0].tweets[0],
      ).toContain('too generic');
      expect(result.style).toBe('refined casual');
    });

    it('should throw when no profile exists', async () => {
      mockProfileRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateProfileFromFeedback([], []),
      ).rejects.toThrow('No profile found. Run /aprender first.');
    });
  });
});
