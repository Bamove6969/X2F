import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { networkInterfaces } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createGateway } from '../demo/gateway-core.js';
import { adoptedApiEnv, createAdopter, rpIdOf } from '../demo/rp-adopt.js';

describe("a preview pane's host as the RP ID (owner demo 13 Nov: no security key under the preview)", () => {
  it('takes the host name of an https origin, never an IP address or http', () => {
    expect(rpIdOf('https://abc-4400.preview.example.dev')).toBe('abc-4400.preview.example.dev');
    expect(rpIdOf('https://p.example:8443')).toBe('p.example');
    expect(rpIdOf('http://p.example')).toBeNull();
    expect(rpIdOf('https://100.101.102.103:4443')).toBeNull();
    expect(rpIdOf('https://[::1]')).toBeNull();
    expect(rpIdOf('https://p.example/x')).toBeNull();
  });

  it("restarts the API's environment with the host as RP ID and the origin allowed", () => {
    const env = { X2F_RP_ID: 'localhost', X2F_ORIGINS: 'http://localhost:4400,http://127.0.0.1:4400', OTHER: 'x' };
    expect(adoptedApiEnv(env, 'https://p.example')).toEqual({
      X2F_RP_ID: 'p.example', X2F_ORIGINS: 'http://localhost:4400,http://127.0.0.1:4400,https://p.example', OTHER: 'x',
    });
    expect(() => adoptedApiEnv(env, 'https://10.0.0.1')).toThrow();
  });

  it('adopts the first host from a page load only, once, and holds requests until the API is back', async () => {
    const restarts: string[] = [];
    let done!: () => void;
    const restart = (o: string): Promise<void> => {
      restarts.push(o);
      return new Promise<void>((r) => (done = r));
    };
    const a = createAdopter({ enabled: true, restart, log: () => {} });
    await a.beforeApi(null, true);
    await a.beforeApi('https://p.example', false);
    expect(restarts).toEqual([]);
    let passed = false;
    const held = a.beforeApi('https://p.example', true).then(() => (passed = true));
    await new Promise((r) => setTimeout(r, 10));
    expect(passed).toBe(false);
    done();
    await held;
    await a.beforeApi('https://q.example', true);
    expect(restarts).toEqual(['https://p.example']);
    expect(a.adopted()).toBe('https://p.example');

    const off = createAdopter({ enabled: false, restart: async (o) => void restarts.push(o), log: () => {} });
    await off.beforeApi('https://r.example', true);
    expect(restarts).toEqual(['https://p.example']);
  });

  it('adopts only the pinned host when the operator pins one (DEMO_ADOPT_HOST, review M4)', async () => {
    const restarts: string[] = [];
    const a = createAdopter({ enabled: true, pin: 'P.example', restart: async (o) => void restarts.push(o), log: () => {} });
    await a.beforeApi('https://mybox.local', true);
    await a.beforeApi('https://p.example.evil', true);
    expect(restarts).toEqual([]);
    expect(a.adopted()).toBeNull();
    await a.beforeApi('https://p.example', true);
    expect(restarts).toEqual(['https://p.example']);
  });

  let servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
    servers = [];
  });
  const listen = async (h: (req: IncomingMessage, res: ServerResponse) => void): Promise<number> => {
    const s = http.createServer(h);
    servers.push(s);
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
    return (s.address() as AddressInfo).port;
  };

  it("the gateway hands the API's hook the unplanned https origin and waits for it", async () => {
    const api = await listen((_req, res) => res.end('ok'));
    const seen: [string | null, boolean][] = [];
    const { web, handle } = createGateway({
      api, relay: 1, node: 1, primary: 'http://localhost:4400', origins: new Set(['http://localhost:4400']),
      demo: (_q, s) => s.end(), beforeApi: async (o, page) => void seen.push([o, page]),
    });
    const gw = await listen(handle(web));
    const get = (headers: Record<string, string>) => fetch(`http://127.0.0.1:${gw}/`, { headers }).then((r) => r.text());
    expect(await get({ 'x-forwarded-host': 'p.example', 'x-forwarded-proto': 'https', accept: 'text/html' })).toBe('ok');
    expect(await get({ host: 'localhost:4400' })).toBe('ok');
    expect(seen).toEqual([['https://p.example', true], [null, false]]);
  });

  // The phone's LAN address (DEMO_PHONE_IP) and the tailnet one are the gateway's only non-loopback
  // listeners; a client there must not choose the RP ID nor speak for a TLS front (review M4).
  const lanIp = Object.values(networkInterfaces()).flat().find((i) => i?.family === 'IPv4' && !i.internal)?.address;
  it.skipIf(lanIp === undefined)('a non-loopback client adopts nothing and its X-Forwarded-* headers are dropped', async () => {
    const upstream: (string | undefined)[] = [];
    const api = await listen((req, res) => {
      upstream.push(req.headers['x-forwarded-host'] as string | undefined);
      res.end('ok');
    });
    const seen: [string | null, boolean][] = [];
    const { web, handle } = createGateway({
      api, relay: 1, node: 1, primary: 'http://localhost:4400', origins: new Set(['http://localhost:4400']),
      demo: (_q, s) => s.end(), beforeApi: async (o, page) => void seen.push([o, page]),
    });
    const s = http.createServer(handle(web));
    servers.push(s);
    await new Promise<void>((r) => s.listen(0, lanIp, r));
    const gw = (s.address() as AddressInfo).port;
    const get = (headers: Record<string, string>) => fetch(`http://${lanIp}:${gw}/`, { headers }).then((r) => r.text());
    expect(await get({ 'x-forwarded-host': 'p.example', 'x-forwarded-proto': 'https', accept: 'text/html' })).toBe('ok');
    expect(await get({ host: 'mybox.local', accept: 'text/html' })).toBe('ok');
    expect(seen).toEqual([[null, true], [null, true]]);
    expect(upstream).toEqual([undefined, undefined]);
  });
});
