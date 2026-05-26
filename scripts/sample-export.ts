import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const inputPath = process.argv[2] ?? resolve('data/tweet-export.full.json');
const outputPath = process.argv[3] ?? resolve('data/tweet-export.json');
const limit = Number(process.argv[4] ?? 1000);

const raw = readFileSync(resolve(inputPath), 'utf-8');
const all = JSON.parse(raw) as {
  full_text: string;
  created_at: string;
  id_str: string;
}[];

const originals = all.filter((t) => !t.full_text.startsWith('RT @'));

// Sort by created_at desc — Twitter format "Thu May 21 14:50:38 +0000 2026"
originals.sort(
  (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
);

const sample = originals.slice(0, limit).map((t) => ({ full_text: t.full_text }));

writeFileSync(resolve(outputPath), JSON.stringify(sample, null, 2));

const newest = originals[0]?.created_at ?? 'n/a';
const oldestInSample = originals[Math.min(sample.length - 1, originals.length - 1)]?.created_at ?? 'n/a';

console.log(`Input:           ${inputPath}`);
console.log(`Output:          ${outputPath}`);
console.log(`Originals total: ${originals.length}`);
console.log(`Sampled:         ${sample.length} (most recent)`);
console.log(`Newest:          ${newest}`);
console.log(`Oldest in sample: ${oldestInSample}`);
