import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { jsonColumnTransformer } from './json-column.transformer.js';
import { type GeneratedTweet } from './generated-tweet.entity.js';

@Entity('content_snapshot')
export class ContentSnapshot {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text' })
  topics_summary: string;

  @Column({ type: 'text', transformer: jsonColumnTransformer })
  raw_content: object[];

  @Column({ type: 'text', transformer: jsonColumnTransformer })
  source_feeds: string[];

  @Column({ type: 'text' })
  captured_at: string;

  @OneToMany('GeneratedTweet', 'contentSnapshot')
  tweets: GeneratedTweet[];
}
