import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('profile_summary')
export class ProfileSummary {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text' })
  style: string;

  @Column({ type: 'text' })
  interests: string;

  @Column({ type: 'text' })
  last_updated: string;
}
