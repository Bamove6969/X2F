import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { networkInterfaces } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createGateway } from '../demo/gateway-core.js';
import { adoptedApiEnv, createAdopter, rpIdOf } from '../demo/rp-adopt.js';
import { isLoopbackPeer } from '../demo/self-origin.js';

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
    const a = createAdopter({ enabled: true, restart: async (o) => void restarts.push(o) ?? new Promise<void>((r) => (done = r)), log: () => {} });
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

  it('review M2: a failed restart is retried on the next page load, and a later host still cannot move a working one', async () => {
    const restarts: string[] = [];
    const logs: string[] = [];
    let fail = true;
    const a = createAdopter({
      enabled: true,
      restart: async (o) => {
        restarts.push(o);
        if (fail) throw new Error('the API did not come back');
      },
      log: (l) => void logs.push(l),
    });
    await a.beforeApi('https://p.example', true);
    expect(a.adopted()).toBeNull();
    expect(logs.some((l) => l.includes('rp-adopt-failed'))).toBe(true);
    fail = false;
    await a.beforeApi('https://p.example', false);
    expect(restarts).toEqual(['https://p.example']);
    await a.beforeApi('https://p.example', true);
    expect(restarts).toEqual(['https://p.example', 'https://p.example']);
    expect(a.adopted()).toBe('https://p.example');
    await a.beforeApi('https://q.example', true);
    expect(a.adopted()).toBe('https://p.example');
  });

  it('review M2: loopback peers are 127.0.0.0/8 and ::1 only', () => {
    for (const p of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1']) expect(isLoopbackPeer(p), p).toBe(true);
    for (const p of ['10.0.0.2', '100.101.102.103', '192.168.1.5', '::ffff:10.0.0.2', '', undefined]) expect(isLoopbackPeer(p), String(p)).toBe(false);
  });

  it('review M2: the gateway offers a host for adoption only from a loopback peer that says X-Forwarded-Proto: https', async () => {
    const api = await listen((_req, res) => res.end('ok'));
    const seen: [string | null, boolean][] = [];
    const { web, handle } = createGateway({
      api, relay: 1, node: 1, primary: 'http://localhost:4400', origins: new Set(['http://localhost:4400']),
      demo: (_q, s) => s.end(), beforeApi: async (o, page) => void seen.push([o, page]),
    });
    const gw = await listen(handle(web));
    // A LAN or tailnet client (or a rebinding page) with any Host and no front: selfOriginOf calls it
    // https, but it is never offered for adoption.
    const get = (port: number, headers: Record<string, string>) => fetch(`http://127.0.0.1:${port}/`, { headers }).then((r) => r.text());
    expect(await get(gw, { 'x-forwarded-host': 'x.attacker.example', accept: 'text/html' })).toBe('ok');
    expect(await get(gw, { 'x-forwarded-host': 'x.attacker.example', 'x-forwarded-proto': 'http', accept: 'text/html' })).toBe('ok');
    expect(await get(gw, { 'x-forwarded-host': 'p.example', 'x-forwarded-proto': 'https', accept: 'text/html' })).toBe('ok');
    expect(seen).toEqual([[null, true], [null, true], ['https://p.example', true]]);

    // The same request from a peer that is not loopback (the phone VM's or tailnet listener) is not offered.
    const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
    if (lan !== undefined) {
      const s = http.createServer(handle(web));
      servers.push(s);
      await new Promise<void>((r) => s.listen(0, lan, r));
      const port = (s.address() as AddressInfo).port;
      const body = await new Promise<string>((resolve, reject) => {
        const r = http.request({ host: lan, port, path: '/', localAddress: lan, headers: { 'x-forwarded-host': 'p.example', 'x-forwarded-proto': 'https', accept: 'text/html' } }, (res) => {
          let b = '';
          res.on('data', (c) => (b += c));
          res.on('end', () => resolve(b));
        });
        r.on('error', reject);
        r.end();
      });
      expect(body).toBe('ok');
      expect(seen.at(-1)).toEqual([null, true]);
    }
  });
});
