import Database from 'better-sqlite3';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dbPath = process.argv[2] ?? resolve('db.sqlite');
const outputPath = process.argv[3] ?? resolve('data/migrate-feedback-vps.sql');

// IDs from the local Telegram test session on 2026-05-26 — only rows with a final decision.
// Pending rows (38, 40) are intentionally excluded — they have no signal for the few-shot.
const targetIds = [37, 39, 41, 42, 43];

const db = new Database(dbPath, { readonly: true });

interface Row {
  id: number;
  content: string;
  status: string;
  created_at: string;
  published_at: string | null;
  rejection_reason: string | null;
  twitter_id: string | null;
  generation_context: string | null;
  max_publish_retries: number;
  publish_retry_count: number;
}

const placeholders = targetIds.map(() => '?').join(',');
const rows = db
  .prepare(
    `SELECT id, content, status, created_at, published_at, rejection_reason,
            twitter_id, generation_context, max_publish_retries, publish_retry_count
     FROM generated_tweet WHERE id IN (${placeholders})
     ORDER BY id`,
  )
  .all(...targetIds) as Row[];

if (rows.length !== targetIds.length) {
  console.error(
    `Expected ${targetIds.length} rows, found ${rows.length}. Aborting.`,
  );
  process.exit(1);
}

// SQLite string literal escaping: single-quote becomes two single-quotes.
const lit = (v: string | null | number): string => {
  if (v === null) return 'NULL';
  if (typeof v === 'number') return String(v);
  return `'${v.replace(/'/g, "''")}'`;
};

const inserts = rows.map((r) => {
  const cols = [
    'content',
    'status',
    'created_at',
    'published_at',
    'rejection_reason',
    'twitter_id',
    'generation_context',
    'max_publish_retries',
    'publish_retry_count',
    'profile_summary_id',
    'content_snapshot_id',
  ];
  const vals = [
    lit(r.content),
    lit(r.status),
    lit(r.created_at),
    lit(r.published_at),
    lit(r.rejection_reason),
    lit(r.twitter_id),
    lit(r.generation_context),
    String(r.max_publish_retries),
    String(r.publish_retry_count),
    '1', // profile_summary_id — both local and VPS upsert into id=1
    'NULL', // content_snapshot_id — local snapshot doesn't exist on VPS, field is nullable
  ];
  return `-- local id=${r.id} status=${r.status}\nINSERT INTO generated_tweet (${cols.join(', ')}) VALUES (${vals.join(', ')});`;
});

const header = `-- Migration: feedback from local Telegram test session (2026-05-26)
-- Source DB: ${dbPath}
-- Rows: ${rows.length} (local ids: ${targetIds.join(', ')})
-- Apply on VPS with: sqlite3 db.sqlite < migrate-feedback-vps.sql
-- Idempotency: this script appends rows; running it twice will create duplicates.
`;

writeFileSync(outputPath, header + '\n' + inserts.join('\n\n') + '\n');

db.close();

console.log(`Wrote ${rows.length} INSERTs to ${outputPath}`);
console.log(`Rows by status: ${rows.map((r) => `${r.id}=${r.status}`).join(', ')}`);
