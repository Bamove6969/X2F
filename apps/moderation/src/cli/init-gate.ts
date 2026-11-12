// `npm run init-gate -w @x2f/moderation` (re-verify P6): makes a new, empty ruling gate
// (MOD_STATE_DIR/gate.bin) where none exists, after the operator types "yes". The moderation
// process never makes one itself: a missing gate.bin stops it. Then run pin-owner.
import { createInterface } from 'node:readline/promises';
import { initGate } from '../gate/store.js';

const need = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`init-gate: ${name} is missing`);
  return v;
};

const key = new Uint8Array(Buffer.from(need('MOD_KEYSTORE_KEY'), 'base64'));
if (key.length !== 32) throw new Error('init-gate: MOD_KEYSTORE_KEY is malformed (base64 of 32 bytes)');
const rl = createInterface({ input: process.stdin, output: process.stdout });
try {
  const result = await initGate({ dir: need('MOD_STATE_DIR'), keystoreKey: key, print: (l) => process.stdout.write(`${l}\n`), confirm: (q) => rl.question(q) });
  process.stdout.write(`${result}\n`);
  process.exitCode = result === 'created' ? 0 : 1;
} finally {
  rl.close();
}
