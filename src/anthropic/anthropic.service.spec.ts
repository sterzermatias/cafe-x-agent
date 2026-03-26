import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AnthropicService } from './anthropic.service';

const mockCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate },
  }));
});

jest.mock('../rss/rss.service', () => ({}));

describe('AnthropicService', () => {
  let service: AnthropicService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnthropicService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const config: Record<string, string> = {
                ANTHROPIC_API_KEY: 'fake-api-key',
                ANTHROPIC_HAIKU_MODEL: 'claude-haiku-test',
                ANTHROPIC_SONNET_MODEL: 'claude-sonnet-test',
              };
              return config[key];
            }),
          },
        },
      ],
    }).compile();

    service = module.get<AnthropicService>(AnthropicService);
    service.onModuleInit();
  });

  describe('onModuleInit', () => {
    it('should initialize Anthropic client with API key', () => {
      const Anthropic = jest.requireMock('@anthropic-ai/sdk');
      expect(Anthropic).toHaveBeenCalledWith({ apiKey: 'fake-api-key' });
    });
  });

  describe('analyzeProfile', () => {
    it('should send correct prompt and parse JSON response', async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: '{"style": "casual and witty", "interests": ["tech", "music"]}',
          },
        ],
      });

      const result = await service.analyzeProfile({
        tweets: ['Tweet one', 'Tweet two'],
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-haiku-test',
          max_tokens: 1024,
          messages: [{ role: 'user', content: expect.stringContaining('Tweet one') }],
        }),
      );
      expect(result).toEqual({
        style: 'casual and witty',
        interests: ['tech', 'music'],
      });
    });
  });

  describe('summarizeTopics', () => {
    it('should send RSS entries in prompt and return summary string', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'AI and tech are trending.' }],
      });

      const result = await service.summarizeTopics([
        {
          title: 'AI News',
          link: 'https://example.com',
          contentSnippet: 'AI is booming',
          pubDate: '2026-03-25',
          feedSource: 'https://feed.com',
        },
      ]);

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-haiku-test',
          messages: [{ role: 'user', content: expect.stringContaining('AI News') }],
        }),
      );
      expect(result).toBe('AI and tech are trending.');
    });
  });

  describe('generateTweet', () => {
    it('should use Sonnet model and include approved/rejected examples in prompt', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: 'Generated tweet content' }],
      });

      const result = await service.generateTweet(
        { style: 'casual', interests: ['tech'] },
        'AI is trending',
        {
          approved: [{ content: 'Good tweet' }],
          rejected: [{ content: 'Bad tweet', rejection_reason: 'Too generic' }],
        },
      );

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-sonnet-test',
          max_tokens: 256,
          messages: [
            {
              role: 'user',
              content: expect.stringContaining('Good tweet'),
            },
          ],
        }),
      );

      const prompt = mockCreate.mock.calls[0][0].messages[0].content;
      expect(prompt).toContain('Bad tweet');
      expect(prompt).toContain('Too generic');
      expect(result).toBe('Generated tweet content');
    });
  });

  describe('validateContent', () => {
    it('should return safe: true for safe content', async () => {
      mockCreate.mockResolvedValue({
        content: [{ type: 'text', text: '{"safe": true}' }],
      });

      const result = await service.validateContent('A nice tweet');
      expect(result).toEqual({ safe: true });
    });

    it('should return safe: false with reason for unsafe content', async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: '{"safe": false, "reason": "Contains offensive language"}',
          },
        ],
      });

      const result = await service.validateContent('Bad content');
      expect(result).toEqual({
        safe: false,
        reason: 'Contains offensive language',
      });
    });
  });

  describe('callApi retry on 529', () => {
    it('should retry with backoff on overloaded error', async () => {
      jest.spyOn(service as any, 'sleep').mockResolvedValue(undefined);

      const overloadedError = { status: 529, message: 'Overloaded' };
      mockCreate
        .mockRejectedValueOnce(overloadedError)
        .mockRejectedValueOnce(overloadedError)
        .mockResolvedValueOnce({
          content: [{ type: 'text', text: '{"safe": true}' }],
        });

      const result = await service.validateContent('test');

      expect(mockCreate).toHaveBeenCalledTimes(3);
      expect(result).toEqual({ safe: true });
    });
  });

  describe('extractJson', () => {
    it('should strip markdown code fences from response', async () => {
      mockCreate.mockResolvedValue({
        content: [
          {
            type: 'text',
            text: '```json\n{"safe": true}\n```',
          },
        ],
      });

      const result = await service.validateContent('test');
      expect(result).toEqual({ safe: true });
    });
  });
});
