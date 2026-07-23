import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const inputPath = process.argv[2];
const outputPath = process.argv[3] ?? resolve('data/tweet-export.full.json');

if (!inputPath) {
  console.error(
    'Usage: ts-node scripts/flatten-twitter-export.ts <path/to/tweets.js> [output.full.json]',
  );
  process.exit(1);
}

const raw = readFileSync(resolve(inputPath), 'utf-8');

// Twitter export wraps the array: `window.YTD.tweets.part0 = [ ... ]`
const eqIdx = raw.indexOf('=');
if (eqIdx === -1) {
  throw new Error('No "=" found in input — does not look like a tweets.js export');
}
const jsonText = raw.slice(eqIdx + 1).trim();

const parsed = JSON.parse(jsonText) as {
  tweet?: { full_text?: string; created_at?: string; id_str?: string };
}[];
if (!Array.isArray(parsed)) {
  throw new Error('Parsed payload is not an array');
}

const flattened = parsed
  .map((item) => ({
    full_text: item?.tweet?.full_text ?? '',
    created_at: item?.tweet?.created_at ?? '',
    id_str: item?.tweet?.id_str ?? '',
  }))
  .filter((t) => t.full_text.length > 0);

const retweets = flattened.filter((t) => t.full_text.startsWith('RT @')).length;
const originals = flattened.length - retweets;

writeFileSync(resolve(outputPath), JSON.stringify(flattened, null, 2));

console.log(`Input:    ${inputPath}`);
console.log(`Output:   ${outputPath}`);
console.log(`Total:    ${flattened.length} tweets (preserves created_at, id_str)`);
console.log(`Originals: ${originals}`);
console.log(`Retweets:  ${retweets}`);
