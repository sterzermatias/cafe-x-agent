import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { jsonColumnTransformer } from './json-column.transformer.js';
import { type GeneratedTweet } from './generated-tweet.entity.js';

@Entity('profile_summary')
export class ProfileSummary {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text' })
  style: string;

  @Column({ type: 'text', transformer: jsonColumnTransformer })
  interests: string[];

  @Column({ type: 'text' })
  last_updated: string;

  @OneToMany('GeneratedTweet', 'profileSummary')
  tweets: GeneratedTweet[];
}
