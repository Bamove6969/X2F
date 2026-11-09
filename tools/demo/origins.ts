/**
 * DEMO ONLY: which origins the demo's web build, API, relay and node proxy are told about.
 *
 * Default: http://localhost:4400 (the app, the API, the relay under /relay) and
 * http://localhost:4401 (the node proxy). With a Tailscale address, the tailnet HTTPS origins.
 * With DEMO_PUBLIC_ORIGIN and DEMO_PUBLIC_NODE_ORIGIN (both, or neither: two HTTPS tunnel URLs,
 * e.g. Cloudflare quick tunnels to 127.0.0.1:4400 and 127.0.0.1:4401), the public ones: the web
 * build, the relay wss URL, the node proxy URL, the allowed origins and the CSP use them. The
 * local origins stay allowed. Every demo process still binds 127.0.0.1 only; a tunnel reaches out.
 */
import { PORTS } from './config.js';

export interface DemoOrigins {
  /** http://localhost:4400 */
  local: string;
  /** The origin the web build is made for (public, tailnet, or local). */
  primary: string;
  /** The relay's WebSocket origin (the primary origin's /relay). */
  primaryWs: string;
  /** The node proxy's origin the web build talks to. */
  node: string;
  /** The public tunnel origin, or '' (shown to the owner). */
  public: string;
  /** Every origin the app may be opened from (CORS, the API's X2F_ORIGINS, the gateway). */
  allowed: string[];
  /** The WebAuthn RP ID: the public host name, else localhost (as before). */
  rpId: string;
}

export class DemoOriginError extends Error {
  constructor(reason: string) {
    super(`demo: ${reason}`);
    this.name = 'DemoOriginError';
  }
}

/** A bare https origin (no path, query, credentials or port other than 443), returned normalized. */
export function publicOrigin(name: string, raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new DemoOriginError(`${name} is not a URL`);
  }
  if (u.protocol !== 'https:') throw new DemoOriginError(`${name} must be an https:// origin`);
  if (u.username !== '' || u.password !== '' || (u.pathname !== '/' && u.pathname !== '') || u.search !== '' || u.hash !== '') {
    throw new DemoOriginError(`${name} must be a bare origin (no path, query or credentials)`);
  }
  if (u.port !== '') throw new DemoOriginError(`${name} must use the default https port`);
  return u.origin;
}

export function demoOrigins(env: Record<string, string | undefined>, tsIp = ''): DemoOrigins {
  const local = `http://localhost:${PORTS.gateway}`;
  const localNode = `http://localhost:${PORTS.gatewayNode}`;
  const pubRaw = env.DEMO_PUBLIC_ORIGIN ?? '';
  const pubNodeRaw = env.DEMO_PUBLIC_NODE_ORIGIN ?? '';
  if ((pubRaw === '') !== (pubNodeRaw === '')) throw new DemoOriginError('set both DEMO_PUBLIC_ORIGIN and DEMO_PUBLIC_NODE_ORIGIN, or neither');
  const pub = pubRaw === '' ? '' : publicOrigin('DEMO_PUBLIC_ORIGIN', pubRaw);
  const pubNode = pubNodeRaw === '' ? '' : publicOrigin('DEMO_PUBLIC_NODE_ORIGIN', pubNodeRaw);
  // The two may be the same host: the gateway then sends the node's RPC paths to the node proxy.
  const ts = tsIp ? `https://${tsIp}:${PORTS.gatewayTls}` : '';
  const tsNode = tsIp ? `https://${tsIp}:${PORTS.gatewayNodeTls}` : '';
  const primary = pub || ts || local;
  const node = pubNode || tsNode || localNode;
  const allowed = [...new Set([local, `http://127.0.0.1:${PORTS.gateway}`, ...(ts ? [ts] : []), ...(pub ? [pub] : [])])];
  return {
    local,
    primary,
    primaryWs: primary.replace(/^http/, 'ws'),
    node,
    public: pub,
    allowed,
    rpId: pub ? new URL(pub).hostname : 'localhost',
  };
}

/** The first Cloudflare quick tunnel URL in a cloudflared log, or null. */
export function quickTunnelUrl(log: string): string | null {
  const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(log);
  return m ? m[0] : null;
}
