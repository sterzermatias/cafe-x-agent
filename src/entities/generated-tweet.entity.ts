import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('generated_tweet')
export class GeneratedTweet {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'text' })
  status: string;

  @Column({ type: 'text' })
  created_at: string;

  @Column({ type: 'text', nullable: true })
  published_at: string;
}
