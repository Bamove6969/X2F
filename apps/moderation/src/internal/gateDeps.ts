import { syncRegistry, type GateSource } from '../gate/registry.js';
import type { GateStore } from '../gate/store.js';
import type { GateContext } from '../gate/verify.js';
import { gateDevices, gateStaffDirectory, type DeviceCertificates, type StaffDirectory } from './grant.js';

/**
 * Review F8 (tasks 3-6) / design build task 9: what the internal server knows of staff and their
 * certified devices, from the ruling gate. Each question first syncs the registry under the gate's
 * own lock and saves it (as `gateCheck`), so a switch-off or a revoked device the API already shows
 * counts at once. Without a gate the internal server gets neither, and refuses every call
 * (503 `gate-unavailable`).
 */
export function gateInternalDeps(g: { store: GateStore; source: GateSource; ctx: GateContext }): { staff: StaffDirectory; devices: DeviceCertificates } {
  const view = {
    get state() {
      return g.store.state;
    },
    sync: () =>
      g.store.exclusive(async () => {
        await syncRegistry(g.source, g.store.state, g.ctx);
        await g.store.save();
      }),
  };
  return { staff: gateStaffDirectory(view), devices: gateDevices(view) };
}

