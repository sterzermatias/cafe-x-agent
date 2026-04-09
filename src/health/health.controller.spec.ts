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

import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  const mockTweetRepo = {
    findOne: jest.fn(),
    count: jest.fn(),
  };

  const mockSnapshotRepo = {
    findOne: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    controller = new HealthController(
      mockTweetRepo as any,
      mockSnapshotRepo as any,
    );
  });

  describe('check', () => {
    it('should return correct structure with status ok', async () => {
      mockSnapshotRepo.findOne.mockResolvedValue({
        captured_at: '2026-03-25T10:00:00Z',
      });
      mockTweetRepo.findOne.mockResolvedValue({
        published_at: '2026-03-25T09:00:00Z',
        status: 'published',
      });
      mockTweetRepo.count
        .mockResolvedValueOnce(10) // totalTweets
        .mockResolvedValueOnce(7) // published
        .mockResolvedValueOnce(2) // rejected
        .mockResolvedValueOnce(3); // todayCount

      const result = await controller.check();

      expect(result.status).toBe('ok');
      expect(typeof result.uptime).toBe('number');
      expect(result.memory).toHaveProperty('rss');
      expect(result.memory).toHaveProperty('heapUsed');
      expect(result.memory).toHaveProperty('heapTotal');
      expect(Array.isArray(result.cpu)).toBe(true);
      expect(result.lastContentCapture).toBe('2026-03-25T10:00:00Z');
      expect(result.lastTweetPublished).toBe('2026-03-25T09:00:00Z');
      expect(result.stats.totalTweets).toBe(10);
      expect(result.stats.todayCount).toBe(3);
    });

    it('should return nulls when no data exists', async () => {
      mockSnapshotRepo.findOne.mockResolvedValue(null);
      mockTweetRepo.findOne.mockResolvedValue(null);
      mockTweetRepo.count
        .mockResolvedValueOnce(0) // totalTweets
        .mockResolvedValueOnce(0) // published
        .mockResolvedValueOnce(0) // rejected
        .mockResolvedValueOnce(0); // todayCount

      const result = await controller.check();

      expect(result.lastContentCapture).toBeNull();
      expect(result.lastTweetPublished).toBeNull();
      expect(result.stats.totalTweets).toBe(0);
      expect(result.stats.approvalRate).toBe(0);
      expect(result.stats.todayCount).toBe(0);
    });

    it('should calculate approval rate correctly', async () => {
      mockSnapshotRepo.findOne.mockResolvedValue(null);
      mockTweetRepo.findOne.mockResolvedValue(null);
      mockTweetRepo.count
        .mockResolvedValueOnce(20) // totalTweets
        .mockResolvedValueOnce(8) // published
        .mockResolvedValueOnce(2) // rejected
        .mockResolvedValueOnce(5); // todayCount

      const result = await controller.check();

      // approvalRate = 8 / (8 + 2) * 100 = 80
      expect(result.stats.approvalRate).toBe(80);
    });
  });
});
