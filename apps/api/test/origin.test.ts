import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requestOrigin } from '../src/auth/origin.js';
import { testApp, testConfig } from './helpers/app.js';

let app: FastifyInstance;

beforeAll(async () => {
  ({ app } = await testApp({ config: testConfig({ origins: ['https://x2f.test', 'http://x2fexample.onion'] }) }));
  app.post('/t/echo', async (req) => ({ host: requestOrigin(req).host }));
  app.get('/t/read', async () => ({ ok: true }));
});

afterAll(async () => {
  await app.close();
});

const post = (headers: Record<string, string>) => app.inject({ method: 'POST', url: '/t/echo', headers, payload: {} });

describe('origin check', () => {
  it.each([
    ['a foreign origin', { origin: 'https://evil.test' }],
    ['no Origin header', {} as Record<string, string>],
    ['Origin: null', { origin: 'null' }],
    ['a lookalike sharing the prefix', { origin: 'https://x2f.test.evil.com' }],
    ['a trailing slash', { origin: 'https://x2f.test/' }],
    ['another scheme', { origin: 'http://x2f.test' }],
    ['another port', { origin: 'https://x2f.test:8443' }],
    ['upper case', { origin: 'https://X2F.test' }],
  ])('refuses %s with 403 origin-refused', async (_label, headers) => {
    const res = await post(headers);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'origin-refused' });
  });

  it('passes an exact configured origin and exposes its host', async () => {
    const a = await post({ origin: 'https://x2f.test' });
    expect(a.statusCode).toBe(200);
    expect(a.json()).toEqual({ host: 'x2f.test' });
    const b = await post({ origin: 'http://x2fexample.onion' });
    expect(b.json()).toEqual({ host: 'x2fexample.onion' });
  });

  it('checks before parsing the body: a cross-site text/plain post gets 403, not 415', async () => {
    const res = await app.inject({
      method: 'POST', url: '/t/echo', headers: { origin: 'https://evil.test', 'content-type': 'text/plain' }, payload: '{"a":1}',
    });
    expect(res.statusCode).toBe(403);
    const same = await app.inject({
      method: 'POST', url: '/t/echo', headers: { origin: 'https://x2f.test', 'content-type': 'text/plain' }, payload: '{"a":1}',
    });
    expect(same.statusCode).toBe(415);
    expect(same.json()).toEqual({ error: 'unsupported-media-type' });
  });

  it('lets GET and HEAD through without an Origin', async () => {
    expect((await app.inject({ method: 'GET', url: '/t/read' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'HEAD', url: '/t/read' })).statusCode).toBe(200);
  });

  it('refuses other unsafe methods without a matching Origin', async () => {
    for (const method of ['PUT', 'DELETE', 'PATCH', 'OPTIONS'] as const) {
      const res = await app.inject({ method, url: '/t/echo', headers: { origin: 'https://evil.test' } });
      expect(res.statusCode, method).toBe(403);
    }
  });
});
