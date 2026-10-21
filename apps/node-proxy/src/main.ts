import { buildNodeProxy } from './server.js';

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
  }).filter(([, v]) => v !== undefined),
);

const app = buildNodeProxy({ upstream: str('NODE_PROXY_UPSTREAM'), webOrigin: str('NODE_PROXY_WEB_ORIGIN'), ...optional });
await app.listen({ host: process.env.NODE_PROXY_HOST ?? '127.0.0.1', port: int('NODE_PROXY_PORT') ?? 8788 });
// Only this line is ever logged: no requests, callers, addresses or node URL.
console.log(JSON.stringify({ reason: 'listening' }));
