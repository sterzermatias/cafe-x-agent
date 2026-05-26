import Database from 'better-sqlite3';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dbPath = process.argv[2] ?? resolve('db.sqlite');
const outputPath = process.argv[3] ?? resolve('data/migrate-profile-vps.sql');

const db = new Database(dbPath, { readonly: true });

interface Row {
  id: number;
  style: string;
  interests: string;
  last_updated: string;
}

const row = db
  .prepare('SELECT id, style, interests, last_updated FROM profile_summary WHERE id = 1')
  .get() as Row | undefined;

if (!row) {
  console.error('No profile_summary with id=1 found. Aborting.');
  process.exit(1);
}

const lit = (v: string | number): string => {
  if (typeof v === 'number') return String(v);
  return `'${v.replace(/'/g, "''")}'`;
};

const sql = `-- Migration: profile_summary id=1 from local DB to VPS
-- Source DB: ${dbPath}
-- Apply on VPS with: sqlite3 db.sqlite < migrate-profile-vps.sql
-- Idempotent: uses INSERT OR REPLACE on the primary key.

INSERT OR REPLACE INTO profile_summary (id, style, interests, last_updated) VALUES (
  ${row.id},
  ${lit(row.style)},
  ${lit(row.interests)},
  ${lit(row.last_updated)}
);
`;

writeFileSync(outputPath, sql);

db.close();

console.log(`Wrote profile_summary id=${row.id} to ${outputPath}`);
console.log(`last_updated: ${row.last_updated}`);
console.log(`style length: ${row.style.length} chars`);
