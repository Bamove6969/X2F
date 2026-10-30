// `npm run news -w @x2f/api -- <list|add|edit|delete> ...` (Plan 4 Task 28): posts the News inbox
// until the staff screen exists. Needs only DATABASE_URL. See news/cli.ts for the commands.
import { readFile } from 'node:fs/promises';
import { createPool } from '../db/pool.js';
import { runNewsCommand } from '../news/cli.js';

const url = process.env.DATABASE_URL;
if (!url) {
  process.stderr.write('news: DATABASE_URL is missing\n');
  process.exit(1);
}
const db = createPool(url, 1);
try {
  const result = await runNewsCommand(process.argv.slice(2), { db, clock: () => new Date(), readFile: (p) => readFile(p, 'utf8') });
  process.stdout.write(`${result.out}\n`);
  process.exitCode = result.code;
} finally {
  await db.end();
}
