import { ValueTransformer } from 'typeorm';

export const jsonColumnTransformer: ValueTransformer = {
  to: (value: unknown): string | null =>
    value !== undefined && value !== null ? JSON.stringify(value) : null,
  from: (value: string | null): unknown =>
    value !== null && value !== undefined ? JSON.parse(value) : null,
};
