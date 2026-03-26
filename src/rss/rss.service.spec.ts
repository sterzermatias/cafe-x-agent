import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RSSService } from './rss.service';

const mockParseURL = jest.fn();

jest.mock('rss-parser', () => {
  return jest.fn().mockImplementation(() => ({
    parseURL: mockParseURL,
  }));
});

describe('RSSService', () => {
  let service: RSSService;
  let configGet: jest.Mock;

  const now = Date.now();
  const recentDate = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  const olderDate = new Date(now - 6 * 60 * 60 * 1000).toISOString();
  const staleDate = new Date(now - 48 * 60 * 60 * 1000).toISOString();

  beforeEach(async () => {
    jest.clearAllMocks();

    configGet = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RSSService,
        {
          provide: ConfigService,
          useValue: { get: configGet },
        },
      ],
    }).compile();

    service = module.get<RSSService>(RSSService);
  });

  describe('onModuleInit', () => {
    it('should parse RSS_FEED_URLS from comma-separated string', () => {
      configGet.mockReturnValue('https://feed1.com/rss,https://feed2.com/rss');
      service.onModuleInit();

      expect(configGet).toHaveBeenCalledWith('RSS_FEED_URLS', '');
    });
  });

  describe('captureFeeds', () => {
    it('should return empty array when no URLs configured', async () => {
      configGet.mockReturnValue('');
      service.onModuleInit();

      const result = await service.captureFeeds();
      expect(result).toEqual([]);
    });

    it('should parse multiple feeds and filter entries from last 24h sorted by date DESC', async () => {
      configGet.mockReturnValue('https://feed1.com/rss,https://feed2.com/rss');
      service.onModuleInit();

      mockParseURL
        .mockResolvedValueOnce({
          items: [
            { title: 'Old article', link: 'https://example.com/old', contentSnippet: 'old', pubDate: staleDate },
            { title: 'Recent A', link: 'https://example.com/a', contentSnippet: 'snippet a', pubDate: olderDate },
          ],
        })
        .mockResolvedValueOnce({
          items: [
            { title: 'Recent B', link: 'https://example.com/b', contentSnippet: 'snippet b', pubDate: recentDate },
          ],
        });

      const result = await service.captureFeeds();

      expect(result).toHaveLength(2);
      expect(result[0].title).toBe('Recent B');
      expect(result[1].title).toBe('Recent A');
      expect(result.find((e) => e.title === 'Old article')).toBeUndefined();
    });

    it('should return entries from successful feeds when one feed fails', async () => {
      configGet.mockReturnValue('https://feed1.com/rss,https://bad.com/rss');
      service.onModuleInit();

      mockParseURL
        .mockResolvedValueOnce({
          items: [
            { title: 'Good entry', link: 'https://example.com/good', contentSnippet: 'ok', pubDate: recentDate },
          ],
        })
        .mockRejectedValueOnce(new Error('Network error'));

      const result = await service.captureFeeds();

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Good entry');
    });
  });

  describe('getLatestContent', () => {
    it('should return limited entries', async () => {
      configGet.mockReturnValue('https://feed1.com/rss');
      service.onModuleInit();

      const items = Array.from({ length: 5 }, (_, i) => ({
        title: `Article ${i}`,
        link: `https://example.com/${i}`,
        contentSnippet: `snippet ${i}`,
        pubDate: new Date(now - i * 60 * 60 * 1000).toISOString(),
      }));

      mockParseURL.mockResolvedValue({ items });

      const result = await service.getLatestContent(2);
      expect(result).toHaveLength(2);
    });
  });

  describe('parseFeed error handling', () => {
    it('should return entries from working feeds when individual feed fails', async () => {
      configGet.mockReturnValue('https://good.com/rss,https://broken.com/rss');
      service.onModuleInit();

      mockParseURL
        .mockResolvedValueOnce({
          items: [
            { title: 'Works', link: 'https://example.com/works', contentSnippet: 'ok', pubDate: recentDate },
          ],
        })
        .mockRejectedValueOnce(new Error('Parse failed'));

      const result = await service.captureFeeds();
      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Works');
    });
  });
});
