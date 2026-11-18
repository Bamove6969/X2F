// Security review 2026-11-12, M1 residual (re-verify): the gate store holds a lock file on
// MOD_STATE_DIR (`gate.lock`) for its life when opened with `{ lock: true }`, as the process entry
// does, so a successor started while this process still runs (a lost instance lock) cannot open
// gate.bin beside it; a closed store saves nothing more. A lock left by a process that is gone is
// taken over. (Node has no flock: the file names the holder's pid, boot id and process start time.)
// Review of ruling-payout a42dad1b, N2: in a container the service often runs as pid 1, so a lock
// left by an unclean exit names our own pid; our own pid is stale unless this process holds the
// lock, and a live pid whose start time or boot differs from the lock's is a reused pid, also stale.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { GATE_FILE, GATE_LOCK_FILE, openGateStore } from '../src/gate/index.js';
import { newGate } from './gateWorld.js';

const dirs: string[] = [];
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});
const lockOf = (text: string) => JSON.parse(text) as { pid: number; boot: string | null; start: string | null };
const LINUX = existsSync('/proc/self/stat') && existsSync('/proc/sys/kernel/random/boot_id');
const bootId = () => readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
/** Field 22 of /proc/<pid>/stat (after the parenthesised name): the start time in clock ticks since boot. */
const startOf = (pid: number) => {
  const st = readFileSync(`/proc/${pid}/stat`, 'utf8');
  return st.slice(st.lastIndexOf(')') + 2).split(' ')[19]!;
};
const fresh = async () => {
  const d = await mkdtemp(join(tmpdir(), 'x2f-gate-lock-'));
  dirs.push(d);
  return d;
};

describe('the gate store lock (MOD_STATE_DIR/gate.lock)', () => {
  it('a second locked open of the same directory is refused while the first is open; after close it opens', async () => {
    const dir = await fresh();
    const key = new Uint8Array(randomBytes(32));
    await newGate(dir, key);
    const a = await openGateStore(dir, key, { lock: true });
    expect(lockOf(await readFile(join(dir, GATE_LOCK_FILE), 'utf8')).pid).toBe(process.pid);
    await expect(openGateStore(dir, key, { lock: true })).rejects.toThrow(/locked/);
    await a.close();
    const b = await openGateStore(dir, key, { lock: true });
    await b.close();
  });

  it('a closed store saves nothing more (a pass still running after the stop cannot write gate.bin)', async () => {
    const dir = await fresh();
    const key = new Uint8Array(randomBytes(32));
    await newGate(dir, key);
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
    await newGate(dir, key);
    // A pid far above any live one (Linux pid_max is at most 4194304).
    await writeFile(join(dir, GATE_LOCK_FILE), '4194999\n');
    const a = await openGateStore(dir, key, { lock: true });
    expect(lockOf(await readFile(join(dir, GATE_LOCK_FILE), 'utf8')).pid).toBe(process.pid);
    await a.close();
  });

  it('N2: the lock records the pid, the boot id and the process start time', async () => {
    const dir = await fresh();
    const key = new Uint8Array(randomBytes(32));
    await newGate(dir, key);
    const a = await openGateStore(dir, key, { lock: true });
    const l = lockOf(await readFile(join(dir, GATE_LOCK_FILE), 'utf8'));
    expect(l.pid).toBe(process.pid);
    if (LINUX) {
      expect(l.boot).toBe(bootId());
      expect(l.start).toBe(startOf(process.pid));
    }
    await a.close();
  });

  it('N2: a lock left by an earlier process with our own pid (pid 1 in a container, an unclean exit) is taken over', async () => {
    const dir = await fresh();
    const key = new Uint8Array(randomBytes(32));
    await newGate(dir, key);
    // The old format (a bare pid) and the new one with another start time: neither is this process's.
    for (const stale of [`${process.pid}\n`, JSON.stringify({ pid: process.pid, boot: LINUX ? bootId() : null, start: '1' })]) {
      await writeFile(join(dir, GATE_LOCK_FILE), stale);
      const a = await openGateStore(dir, key, { lock: true });
      expect(lockOf(await readFile(join(dir, GATE_LOCK_FILE), 'utf8')).pid).toBe(process.pid);
      await a.close();
    }
  });

  it.runIf(LINUX)('N2: a live pid reused by another process (other start time, or another boot) is stale; the real holder is not', async () => {
    const dir = await fresh();
    const key = new Uint8Array(randomBytes(32));
    await newGate(dir, key);
    const other = process.ppid;
    for (const reused of [{ pid: other, boot: bootId(), start: '1' }, { pid: other, boot: '00000000-0000-0000-0000-000000000000', start: startOf(other) }]) {
      await writeFile(join(dir, GATE_LOCK_FILE), JSON.stringify(reused));
      const a = await openGateStore(dir, key, { lock: true });
      await a.close();
    }
    await writeFile(join(dir, GATE_LOCK_FILE), JSON.stringify({ pid: other, boot: bootId(), start: startOf(other) }));
    await expect(openGateStore(dir, key, { lock: true })).rejects.toThrow(/locked by process/);
  });
});
