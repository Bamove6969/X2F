// `npm run pin-owner -w @x2f/moderation` (Plan 4 Task 13): pins the owner's security keys into the
// ruling gate (MOD_STATE_DIR/gate.bin), after the operator compares each key check code with the
// locked owner setup page. Reads the owner's keys through the read-only API role
// (MOD_API_READER_DATABASE_URL); needs MOD_KEYSTORE_KEY. Refuses when the owner is already pinned.
import { createInterface } from 'node:readline/promises';
import pg from 'pg';
import { openGateStore } from '../gate/store.js';
import { pgGateSource } from '../gate/registry.js';
import { pinOwner } from '../gate/pin.js';

const need = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`pin-owner: ${name} is missing`);
  return v;
};

const key = new Uint8Array(Buffer.from(need('MOD_KEYSTORE_KEY'), 'base64'));
if (key.length !== 32) throw new Error('pin-owner: MOD_KEYSTORE_KEY is malformed (base64 of 32 bytes)');
const db = new pg.Pool({ connectionString: need('MOD_API_READER_DATABASE_URL'), max: 1 });
const rl = createInterface({ input: process.stdin, output: process.stdout });
try {
  const store = await openGateStore(need('MOD_STATE_DIR'), key);
  const result = await pinOwner({
    source: pgGateSource(db),
    gate: store.state,
    print: (line) => process.stdout.write(`${line}\n`),
    confirm: (q) => rl.question(q),
  });
  if (result === 'pinned') await store.save();
  process.stdout.write(`${result}\n`);
  process.exitCode = result === 'pinned' ? 0 : 1;
} finally {
  rl.close();
  await db.end();
}
