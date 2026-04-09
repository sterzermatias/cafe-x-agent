import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { jsonColumnTransformer } from './json-column.transformer.js';
import { ProfileSummary } from './profile-summary.entity.js';
import { ContentSnapshot } from './content-snapshot.entity.js';

export type TweetStatus =
  | 'pending'
  | 'approved'
  | 'published'
  | 'rejected'
  | 'failed';

export interface GenerationContext {
  source_type: 'rss' | 'manual' | 'scheduled';
  prompt_template_version: string;
  model_used: string;
  rss_sources: string[];
  recent_approved_ids: number[];
  recent_rejected_ids: number[];
  manual_topic?: string;
}

@Entity('generated_tweet')
export class GeneratedTweet {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'text' })
  status: TweetStatus;

  @Column({ type: 'text' })
  created_at: string;

  @Column({ type: 'text', nullable: true })
  published_at: string | null;

  @Column({ type: 'text', nullable: true })
  rejection_reason: string | null;

  @Column({ type: 'text', nullable: true })
  twitter_id: string | null;

  @Column({ type: 'text', nullable: true, transformer: jsonColumnTransformer })
  generation_context: GenerationContext | null;

  @Column({ type: 'integer', default: 5 })
  max_publish_retries: number;

  @Column({ type: 'integer', default: 0 })
  publish_retry_count: number;

  @Column({ name: 'profile_summary_id' })
  profile_summary_id: number;

  @ManyToOne(() => ProfileSummary, (profile) => profile.tweets)
  @JoinColumn({ name: 'profile_summary_id' })
  profileSummary: ProfileSummary;

  @Column({ name: 'content_snapshot_id', nullable: true })
  content_snapshot_id: number | null;

  @ManyToOne(() => ContentSnapshot, (snapshot) => snapshot.tweets, {
    nullable: true,
  })
  @JoinColumn({ name: 'content_snapshot_id' })
  contentSnapshot: ContentSnapshot | null;
}
