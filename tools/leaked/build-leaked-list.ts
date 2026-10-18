// Builds X2F's leaked-password list from a Have I Been Pwned "Pwned Passwords" SHA-1 dump.
// Run by the operator (with the official downloader's output), never by the server:
//   tsx tools/leaked/build-leaked-list.ts <in.txt> <out.bin> [--min-count 10]
// Output: sorted, fixed-width 20-byte SHA-1 records, no header (read by apps/api/src/auth/leaked.ts).
import { createReadStream, createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const LINE = /^([0-9A-Fa-f]{40}):(\d+)$/;

/**
 * Reads HIBP `SHA1HEX:COUNT` lines, keeps those with `COUNT >= minCount` and writes their 20-byte
 * hashes to `out`. Input must be sorted by hash (strictly increasing), as the downloader writes it;
 * anything else throws, naming the line number only. Returns the number of records written.
 */
export async function buildLeakedList(lines: AsyncIterable<string>, out: string, minCount = 10): Promise<number> {
  if (!Number.isInteger(minCount) || minCount < 1) throw new Error('build-leaked-list: min count must be a positive integer');
  const file = createWriteStream(out);
  const failed = once(file, 'error').then(([e]) => Promise.reject(e as Error));
  failed.catch(() => {});
  let previous = '';
  let n = 0;
  let written = 0;
  try {
    for await (const raw of lines) {
      n++;
      const line = raw.trim();
      if (line === '') continue;
      const m = LINE.exec(line);
      if (!m) throw new Error(`build-leaked-list: line ${n} is not SHA1HEX:COUNT`);
      const hex = m[1]!.toUpperCase();
      if (hex <= previous) throw new Error(`build-leaked-list: input is not sorted by hash (line ${n})`);
      previous = hex;
      if (Number(m[2]) < minCount) continue;
      if (!file.write(Buffer.from(hex, 'hex'))) await Promise.race([once(file, 'drain'), failed]);
      written++;
    }
  } catch (e) {
    if (!file.closed) {
      const closed = once(file, 'close');
      file.destroy();
      await closed.catch(() => {});
    }
    await rm(out, { force: true }); // never leave a partial list behind
    throw e;
  }
  file.end();
  await Promise.race([once(file, 'close'), failed]);
  return written;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--min-count');
  let minCount = 10;
  if (at !== -1) {
    minCount = Number(args[at + 1]);
    args.splice(at, 2);
  }
  const [input, output] = args;
  if (!input || !output || args.length !== 2) {
    process.stderr.write('usage: tsx tools/leaked/build-leaked-list.ts <in.txt> <out.bin> [--min-count 10]\n');
    process.exit(2);
  }
  const rl = createInterface({ input: createReadStream(input), crlfDelay: Infinity });
  const written = await buildLeakedList(rl, output, minCount);
  process.stdout.write(`${JSON.stringify({ records: written, bytes: written * 20 })}\n`);
}
