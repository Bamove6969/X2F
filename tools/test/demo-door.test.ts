import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as openpgp from 'openpgp';
import { afterEach, describe, expect, it } from 'vitest';
import { createDoorHandler, DOOR_CSP, doorPage } from '../demo/door-page.js';
import { softTraderLogin, type TraderSecret } from '../demo/door.js';
import { newPgp } from '../regtest/e2e/staffClient.js';

let servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  servers = [];
});

async function serve(handle: http.RequestListener): Promise<string> {
  const s = http.createServer(handle);
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  return `127.0.0.1:${(s.address() as AddressInfo).port}`;
}

describe('the demo trader login (door.ts): the real PGP login, no password', () => {
  it('starts with the key and the login name, answers the decrypted code, and returns the API\'s cookies', async () => {
    const pgp = await newPgp('ana (demo)');
    const who: TraderSecret = { displayName: 'demo_ana', loginName: 'ana-demo', pgp };
    const calls: Array<{ url: string; body: Record<string, unknown>; cookie: string | null }> = [];
    const code = 'ABCD-1234';
    const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const headers = new Headers(init?.headers);
      calls.push({ url: String(url), body, cookie: headers.get('cookie') });
      if (String(url).endsWith('/v1/login/pgp/start')) {
        const encryptedMessage = await openpgp.encrypt({ message: await openpgp.createMessage({ text: `X2F login code: ${code}\n` }), encryptionKeys: await openpgp.readKey({ armoredKey: pgp.publicKey }) });
        return new Response(JSON.stringify({ challengeId: 'c1', encryptedMessage }), { status: 200 });
      }
      return new Response(JSON.stringify({ status: 'ok' }), { status: 200, headers: { 'set-cookie': '__Host-x2f_session=s1; Path=/; Secure; HttpOnly' } });
    }) as typeof fetch;
    const set = await softTraderLogin({ api: 'http://127.0.0.1:1', origin: 'http://localhost:4400', fetchImpl: fakeFetch }, who, new Map([['__Host-x2f_dev', 'd']]));
    expect(calls[0]!.url).toBe('http://127.0.0.1:1/v1/login/pgp/start');
    expect(calls[0]!.body).toEqual({ key: pgp.publicKey, loginName: 'ana-demo' });
    expect(calls[0]!.cookie).toBe('__Host-x2f_dev=d');
    expect(calls[1]!.url).toBe('http://127.0.0.1:1/v1/login/pgp/finish');
    expect(calls[1]!.body.challengeId).toBe('c1');
    expect(calls[1]!.body.code).toBe(code);
    expect(set).toEqual(['__Host-x2f_session=s1; Path=/; Secure; HttpOnly']);
  });

  it('refuses an approval wait (the account is logged in elsewhere)', async () => {
    const pgp = await newPgp('ben (demo)');
    const fakeFetch = (async (url: string | URL) => {
      if (String(url).endsWith('/start')) {
        const encryptedMessage = await openpgp.encrypt({ message: await openpgp.createMessage({ text: 'X2F login code: x\n' }), encryptionKeys: await openpgp.readKey({ armoredKey: pgp.publicKey }) });
        return new Response(JSON.stringify({ challengeId: 'c', encryptedMessage }), { status: 200 });
      }
      return new Response(JSON.stringify({ status: 'approve-on-device', approvalId: 'a', number: 42, expiresAt: '' }), { status: 200 });
    }) as typeof fetch;
    await expect(softTraderLogin({ api: 'http://x', origin: 'http://x', fetchImpl: fakeFetch }, { displayName: 'b', loginName: 'ben-demo', pgp }, new Map())).rejects.toThrow(/another device/);
  });
});

describe('/__demo/login (door-page.ts)', () => {
  const people = [{ displayName: 'demo_ana', loginName: 'ana-demo' }];

  it('lists the seeded accounts, escapes them, and says there are no passwords', () => {
    const page = doorPage(people);
    expect(page).toContain('Log in as demo_ana');
    expect(page).toContain('no passwords');
    expect(page).not.toMatch(/password:/i);
    expect(doorPage([{ displayName: '<b>', loginName: 'x"y' }], '<i>')).not.toMatch(/as <b>|<i>|x"y/);
  });

  it('logs a seeded account in from a form on this origin only, and passes the API\'s cookies on', async () => {
    const asked: string[] = [];
    let handle: http.RequestListener = () => undefined;
    // The handler reads its origins when made, so it is made once the port is known.
    const host = await serve((req, res) => handle(req, res));
    handle = createDoorHandler({
      origins: new Set([`http://${host}`]),
      people: () => people,
      login: async (loginName, cookies) => {
        asked.push(`${loginName} ${cookies.get('__Host-x2f_dev') ?? ''} ${cookies.has('__Host-x2f_staff')}`);
        return ['__Host-x2f_session=s; Path=/'];
      },
    });
    const post = (origin: string, as: string) => fetch(`http://${host}/__demo/login`, {
      method: 'POST', redirect: 'manual',
      headers: { origin, 'content-type': 'application/x-www-form-urlencoded', cookie: '__Host-x2f_dev=d; __Host-x2f_staff=t' },
      body: new URLSearchParams({ as }).toString(),
    });
    const get = await fetch(`http://${host}/__demo/login`);
    expect(get.status).toBe(200);
    expect(get.headers.get('content-security-policy')).toBe(DOOR_CSP);
    expect((await post('https://evil.example', 'ana-demo')).status).toBe(403);
    expect((await post(`http://${host}`, 'nobody')).status).toBe(400);
    expect(asked).toEqual([]);
    const ok = await post(`http://${host}`, 'ana-demo');
    expect(ok.status).toBe(303);
    expect(ok.headers.get('location')).toBe('/');
    expect(ok.headers.get('set-cookie')).toBe('__Host-x2f_session=s; Path=/');
    expect(asked).toEqual(['ana-demo d false']);
  });
});
