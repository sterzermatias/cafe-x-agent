import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Parser from 'rss-parser';

export interface RSSEntry {
  title: string;
  link: string;
  contentSnippet: string;
  pubDate: string;
  feedSource: string;
}

@Injectable()
export class RSSService implements OnModuleInit {
  private readonly logger = new Logger(RSSService.name);
  private feedUrls: string[] = [];
  private parser: Parser;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const raw = this.configService.get<string>('RSS_FEED_URLS', '');
    this.feedUrls = raw
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean);

    this.parser = new Parser({
      timeout: 10_000,
    });

    this.logger.log(`Initialized with ${this.feedUrls.length} feed(s)`);
  }

  async captureFeeds(): Promise<RSSEntry[]> {
    if (this.feedUrls.length === 0) {
      this.logger.warn('No RSS feed URLs configured');
      return [];
    }

    const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;

    const results = await Promise.allSettled(
      this.feedUrls.map((url) => this.parseFeed(url)),
    );

    const entries: RSSEntry[] = [];

    for (const result of results) {
      if (result.status === 'fulfilled') {
        entries.push(...result.value);
      }
    }

    return entries
      .filter((entry) => new Date(entry.pubDate).getTime() > twentyFourHoursAgo)
      .sort(
        (a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime(),
      );
  }

  async getLatestContent(limit = 30): Promise<RSSEntry[]> {
    const entries = await this.captureFeeds();
    return entries.slice(0, limit);
  }

  private async parseFeed(url: string): Promise<RSSEntry[]> {
    try {
      const feed = await this.parser.parseURL(url);

      return (feed.items ?? []).map((item) => ({
        title: item.title ?? '',
        link: item.link ?? '',
        contentSnippet: item.contentSnippet ?? '',
        pubDate: item.pubDate ?? item.isoDate ?? '',
        feedSource: url,
      }));
    } catch (error) {
      this.logger.warn(
        `Failed to parse feed ${url}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }
}
