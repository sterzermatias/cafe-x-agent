import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
// rss-parser: librería que parsea feeds RSS/Atom a objetos JS
import Parser from 'rss-parser';

// Interface = contrato de datos — define la forma de cada entrada RSS
export interface RSSEntry {
  title: string;
  link: string;
  contentSnippet: string;
  pubDate: string;
  feedSource: string;
}

// Servicio de captura de feeds RSS — reemplaza la lectura de timeline de Twitter
@Injectable()
export class RSSService implements OnModuleInit {
  private readonly logger = new Logger(RSSService.name);
  private feedUrls: string[] = [];
  private parser: Parser;

  constructor(private readonly configService: ConfigService) {}

  // Lee las URLs de feeds desde la env var (separadas por coma) al iniciar el módulo
  onModuleInit() {
    const raw = this.configService.get<string>('RSS_FEED_URLS', '');
    this.feedUrls = raw
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean); // filter(Boolean) elimina strings vacíos

    this.parser = new Parser({
      timeout: 10_000, // 10 segundos máximo por feed (10_000 = 10000, separador visual)
    });

    this.logger.log(`Initialized with ${this.feedUrls.length} feed(s)`);
  }

  // Parsea TODOS los feeds en paralelo y filtra solo entradas de las últimas 24hs
  async captureFeeds(): Promise<RSSEntry[]> {
    if (this.feedUrls.length === 0) {
      this.logger.warn('No RSS feed URLs configured');
      return [];
    }

    const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;

    // Promise.allSettled ejecuta todas las promesas en paralelo
    // A diferencia de Promise.all, NO falla si una promesa individual falla
    const results = await Promise.allSettled(
      this.feedUrls.map((url) => this.parseFeed(url)),
    );

    // Solo recoge los resultados exitosos (ignora feeds que fallaron)
    const entries: RSSEntry[] = [];

    for (const result of results) {
      if (result.status === 'fulfilled') {
        entries.push(...result.value);
      }
    }

    // Filtra por fecha y ordena de más reciente a más antigua
    return entries
      .filter((entry) => new Date(entry.pubDate).getTime() > twentyFourHoursAgo)
      .sort(
        (a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime(),
      );
  }

  // Conveniencia: captura feeds y devuelve solo las primeras N entradas
  async getLatestContent(limit = 30): Promise<RSSEntry[]> {
    const entries = await this.captureFeeds();
    return entries.slice(0, limit);
  }

  // Parsea un feed individual — si falla, devuelve [] en vez de romper todo
  private async parseFeed(url: string): Promise<RSSEntry[]> {
    try {
      const feed = await this.parser.parseURL(url);

      // Mapea cada item del feed al formato RSSEntry con nullish coalescing (??) como fallback
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
