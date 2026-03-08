import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('feed_snapshot')
export class FeedSnapshot {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text' })
  topics_summary: string;

  @Column({ type: 'text' })
  raw_tweets: string;

  @Column({ type: 'text' })
  captured_at: string;
}
