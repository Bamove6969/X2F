// Review F8 (tasks 3-6) / design build task 9: the internal server gets its staff directory and its
// certified devices from the ruling gate, and every question syncs the registry first, under the
// gate's own lock, and saves it.
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { staffDeviceKeyId } from '@x2f/staff';
import { describe, expect, it } from 'vitest';
import type { GateStore } from '../src/gate/store.js';
import { gateInternalDeps } from '../src/internal/gateDeps.js';
import { ctx, NOW, tapBy, world } from './gateWorld.js';

describe('gateInternalDeps', () => {
  it('answers from the gate after a sync: a new certification counts at once, and so does a switch-off', async () => {
    const w = await world();
    const mod = w.hire('mod');
    let saves = 0;
    let inside = 0;
    const store = {
      state: w.gate,
      save: async () => {
        saves += 1;
      },
      exclusive: async <T>(fn: () => Promise<T>) => {
        inside += 1;
        return fn();
      },
      close: async () => {},
    } as unknown as GateStore;
    const { staff, devices } = gateInternalDeps({ store, source: w.api, ctx: ctx() });
    expect(await staff.standing(mod.id)).toEqual({ kind: 'staff', role: 'mod' });
    const signPublic = randomBytes(32).toString('hex');
    const boxPublic = randomBytes(32).toString('hex');
    const deviceKeyId = staffDeviceKeyId(signPublic);
    expect(await devices.device(mod.id, deviceKeyId, NOW)).toBeNull();
    w.api.taps.push(tapBy(mod, { kind: 'certify-device', accountId: mod.id, deviceKeyId, signPublic, boxPublic }));
    expect(await devices.device(mod.id, deviceKeyId, NOW)).toEqual({ signPublic, boxPublic });
    w.api.staffRows.set(mod.id, { ...w.api.staffRows.get(mod.id)!, switchedOff: true });
    expect(await devices.device(mod.id, deviceKeyId, NOW)).toBeNull();
    expect(await staff.standing(mod.id)).toBeNull();
    expect(inside).toBe(5);
    expect(saves).toBe(5);
  });

  it('the process entry wires both into the internal server, and only from the gate (no gate: neither, so every call is refused)', async () => {
    const src = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/gateParts = \{ store, source, ctx: gateCtx \}/);
    expect(src).toMatch(/startInternalServer\([^]*?\.\.\.\(gateParts !== null \? gateInternalDeps\(gateParts\) : \{\}\)/);
  });
});
