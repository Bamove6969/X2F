import { buildNodeProxy, DEFAULT_PORT, NodeCheckError, requireRestrictedNode } from './server.js';

/** A required setting. */
function str(name: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') throw new RangeError(`${name} is required`);
  return v;
}

/** A positive integer setting; junk such as "512k" is refused rather than read as 512. */
function int(name: string): number | undefined {
  const v = process.env[name];
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new RangeError(`${name} must be a positive integer`);
  return n;
}

const optional = Object.fromEntries(
  Object.entries({
    timeoutMs: int('NODE_PROXY_TIMEOUT_MS'),
    maxBodyBytes: int('NODE_PROXY_MAX_BODY_BYTES'),
    maxInFlight: int('NODE_PROXY_MAX_IN_FLIGHT'),
    maxUpstream: int('NODE_PROXY_MAX_UPSTREAM'),
  }).filter(([, v]) => v !== undefined),
);

const upstream = str('NODE_PROXY_UPSTREAM');
try {
  await requireRestrictedNode(upstream, optional.timeoutMs);
} catch (e) {
  if (!(e instanceof NodeCheckError)) throw e;
  // Only the reason: never the node's URL.
  console.error(JSON.stringify({ reason: e.reason }));
  process.exit(1);
}
const app = buildNodeProxy({ upstream, webOrigin: str('NODE_PROXY_WEB_ORIGIN'), ...optional });
await app.listen({ host: process.env.NODE_PROXY_HOST ?? '127.0.0.1', port: int('NODE_PROXY_PORT') ?? DEFAULT_PORT });
// Only these lines are ever logged: no requests, callers, addresses or node URL.
console.log(JSON.stringify({ reason: 'listening' }));
