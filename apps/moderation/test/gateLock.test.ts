// Security review 2026-11-12, M1 residual (re-verify): the gate store holds a lock file on
// MOD_STATE_DIR (`gate.lock`) for its life when opened with `{ lock: true }`, as the process entry
// does, so a successor started while this process still runs (a lost instance lock) cannot open
// gate.bin beside it; a closed store saves nothing more. A lock left by a process that is gone is
// taken over. (Node has no flock: the file names the holder's pid, checked for liveness.)
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { GATE_FILE, GATE_LOCK_FILE, openGateStore } from '../src/gate/index.js';

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});
const fresh = async () => {
  const d = await mkdtemp(join(tmpdir(), 'x2f-gate-lock-'));
  dirs.push(d);
  return d;
};

describe('the gate store lock (MOD_STATE_DIR/gate.lock)', () => {
  it('a second locked open of the same directory is refused while the first is open; after close it opens', async () => {
    const dir = await fresh();
    const key = new Uint8Array(randomBytes(32));
    const a = await openGateStore(dir, key, { lock: true });
    expect((await readFile(join(dir, GATE_LOCK_FILE), 'utf8')).trim()).toBe(String(process.pid));
    await expect(openGateStore(dir, key, { lock: true })).rejects.toThrow(/locked/);
    await a.close();
    const b = await openGateStore(dir, key, { lock: true });
    await b.close();
  });

  it('a closed store saves nothing more (a pass still running after the stop cannot write gate.bin)', async () => {
    const dir = await fresh();
    const key = new Uint8Array(randomBytes(32));
    const a = await openGateStore(dir, key, { lock: true });
    await a.save();
    const before = await readFile(join(dir, GATE_FILE));
    await a.close();
    await expect(a.save()).rejects.toThrow(/closed/);
    expect(Buffer.compare(await readFile(join(dir, GATE_FILE)), before)).toBe(0);
  });

  it('a lock file left by a process that no longer runs is taken over', async () => {
    const dir = await fresh();
    const key = new Uint8Array(randomBytes(32));
    // A pid far above any live one (Linux pid_max is at most 4194304).
    await writeFile(join(dir, GATE_LOCK_FILE), '4194999\n');
    const a = await openGateStore(dir, key, { lock: true });
    expect((await readFile(join(dir, GATE_LOCK_FILE), 'utf8')).trim()).toBe(String(process.pid));
    await a.close();
  });
});
