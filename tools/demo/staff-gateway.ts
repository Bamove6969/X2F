/**
 * DEMO ONLY: the staff gateway, the staff origin's entry point (staff-gateway-core.ts): staff-web
 * and the staff API on their own port (PORTS.staffGateway, 4402), on 127.0.0.1 only. A public front
 * (the Tailscale Funnel's 443, DEMO_PUBLIC_STAFF_ORIGIN) reaches it on 127.0.0.1 like any local
 * client. Separate from the trader gateway (gateway.ts), so the two origins share nothing but the
 * machine.
 */
import http from 'node:http';
import { STAFF_CAST, readStaffSecrets, softStaffLogin, type StaffSecret } from './staff-accounts.js';
import { createStaffGateway } from './staff-gateway-core.js';
import { assertDemo } from './guard.js';

await assertDemo(process.env, process.env.DEMO_MONEROD_RPC ?? '');
const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`staff gateway: ${k} is missing`);
  return v;
};
const STAFF_API = Number(env('DEMO_STAFF_API_PORT'));
const PORT = Number(env('DEMO_STAFF_GATEWAY_PORT'));
const PRIMARY = env('DEMO_STAFF_ORIGIN');
const RP_ID = env('DEMO_STAFF_RP_ID');
const ORIGINS = new Set(env('DEMO_STAFF_ORIGINS').split(','));

/** The keys as this process last used them (their counters only ever move on). */
const used = new Map<string, StaffSecret>();
function secretOf(loginName: string): StaffSecret | undefined {
  const fresh = readStaffSecrets().find((s) => s.loginName === loginName);
  if (!fresh) return undefined;
  const before = used.get(loginName);
  if (before && before.keys[0]?.credentialId === fresh.keys[0]?.credentialId) return before;
  used.set(loginName, fresh);
  return fresh;
}

const handle = createStaffGateway({
  staffApi: STAFF_API,
  primary: PRIMARY,
  origins: ORIGINS,
  people: () => {
    const seeded = new Set(readStaffSecrets().map((s) => s.loginName));
    return STAFF_CAST.filter((p) => seeded.has(p.loginName));
  },
  login: async (loginName, cookies) => {
    const who = secretOf(loginName);
    if (!who) throw new Error('not a seeded staff account');
    return softStaffLogin({ api: `http://127.0.0.1:${STAFF_API}`, origin: PRIMARY, rpId: RP_ID }, who, cookies);
  },
});

http.createServer(handle).listen(PORT, '127.0.0.1');
console.log(JSON.stringify({ reason: 'listening', on: `127.0.0.1:${PORT}`, origin: PRIMARY }));
