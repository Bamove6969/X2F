import { buildRelay } from './server.js';

/** A numeric setting; junk such as "512k" is refused rather than read as 512. */
function num(name: string, integer = true): number | undefined {
  const v = process.env[name];
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || (integer && !Number.isInteger(n))) throw new RangeError(`${name} must be ${integer ? 'an integer' : 'a number'}`);
  return n;
}

const overrides = Object.fromEntries(
  Object.entries({
    maxEnvelopeBytes: num('RELAY_MAX_ENVELOPE_BYTES'),
    memoryBudgetBytes: num('RELAY_MEMORY_BUDGET_BYTES'),
    maxUnauthenticated: num('RELAY_MAX_UNAUTHENTICATED'),
    rateRefillPerSec: num('RELAY_RATE_REFILL_PER_SEC', false),
  }).filter(([, v]) => v !== undefined),
);

// Trades are registered and closed only by the moderation service, through moderator-signed
// calls on the private admin listener.
const modSigningPublic = process.env.RELAY_MOD_SIGNING_PUBLIC;
if (!modSigningPublic) throw new Error('RELAY_MOD_SIGNING_PUBLIC is required (the moderation service signing key, hex)');
const log = (e: { reason: string }): void => console.log(JSON.stringify(e));
const relay = await buildRelay(overrides, log, { modSigningPublic });
const port = num('RELAY_PORT') ?? 8787;
await relay.app.listen({ host: process.env.RELAY_HOST ?? '127.0.0.1', port });
// The admin listener must stay on a private interface; it is never published.
await relay.admin!.listen({ host: process.env.RELAY_ADMIN_HOST ?? '127.0.0.1', port: num('RELAY_ADMIN_PORT') ?? 8788 });
console.log(JSON.stringify({ reason: 'listening', maxTrades: relay.limits.maxTrades }));
