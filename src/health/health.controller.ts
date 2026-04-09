import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { loadavg } from 'os';
import { Like, Repository } from 'typeorm';
import { ContentSnapshot } from '../entities/content-snapshot.entity.js';
import { GeneratedTweet } from '../entities/generated-tweet.entity.js';

interface HealthResponse {
  status: 'ok';
  uptime: number;
  memory: { rss: number; heapUsed: number; heapTotal: number };
  cpu: number[];
  lastContentCapture: string | null;
  lastTweetPublished: string | null;
  stats: {
    totalTweets: number;
    approvalRate: number;
    todayCount: number;
  };
}

@Controller('health')
export class HealthController {
  constructor(
    @InjectRepository(GeneratedTweet)
    private readonly tweetRepo: Repository<GeneratedTweet>,
    @InjectRepository(ContentSnapshot)
    private readonly snapshotRepo: Repository<ContentSnapshot>,
  ) {}

  @Get()
  async check(): Promise<HealthResponse> {
    const mem = process.memoryUsage();
    const toMB = (bytes: number) =>
      Math.round((bytes / (1024 * 1024)) * 10) / 10;

    const [
      lastSnapshot,
      lastPublished,
      totalTweets,
      published,
      rejected,
      todayCount,
    ] = await Promise.all([
      this.snapshotRepo.findOne({
        order: { captured_at: 'DESC' },
      }),
      this.tweetRepo.findOne({
        where: { status: 'published' },
        order: { published_at: 'DESC' },
      }),
      this.tweetRepo.count(),
      this.tweetRepo.count({ where: { status: 'published' } }),
      this.tweetRepo.count({ where: { status: 'rejected' } }),
      this.tweetRepo.count({
        where: {
          created_at: Like(`${new Date().toISOString().slice(0, 10)}%`),
        },
      }),
    ]);

    const decided = published + rejected;
    const approvalRate =
      decided > 0 ? Math.round((published / decided) * 100) : 0;

    return {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      memory: {
        rss: toMB(mem.rss),
        heapUsed: toMB(mem.heapUsed),
        heapTotal: toMB(mem.heapTotal),
      },
      cpu: loadavg(),
      lastContentCapture: lastSnapshot?.captured_at ?? null,
      lastTweetPublished: lastPublished?.published_at ?? null,
      stats: {
        totalTweets,
        approvalRate,
        todayCount,
      },
    };
  }
}
