import { describe, expect, it } from 'vitest';
import { demoOrigins, DemoOriginError, publicOrigin, quickTunnelUrl } from '../demo/origins.js';

describe('demo origins', () => {
  it('defaults to localhost', () => {
    const o = demoOrigins({});
    expect(o).toMatchObject({ primary: 'http://localhost:4400', primaryWs: 'ws://localhost:4400', node: 'http://localhost:4401', public: '', rpId: 'localhost' });
    expect(o.allowed).toEqual(['http://localhost:4400', 'http://127.0.0.1:4400']);
  });

  it('uses the public tunnel origins for the build, the relay, the node proxy and the allowed origins', () => {
    const o = demoOrigins({ DEMO_PUBLIC_ORIGIN: 'https://a-b.trycloudflare.com', DEMO_PUBLIC_NODE_ORIGIN: 'https://c-d.trycloudflare.com/' });
    expect(o.primary).toBe('https://a-b.trycloudflare.com');
    expect(o.primaryWs).toBe('wss://a-b.trycloudflare.com');
    expect(o.node).toBe('https://c-d.trycloudflare.com');
    expect(o.allowed).toEqual(['http://localhost:4400', 'http://127.0.0.1:4400', 'https://a-b.trycloudflare.com']);
    expect(o.rpId).toBe('a-b.trycloudflare.com');
  });

  it('prefers the public origins over a tailnet address, and keeps the tailnet one allowed', () => {
    const o = demoOrigins({ DEMO_PUBLIC_ORIGIN: 'https://a.example', DEMO_PUBLIC_NODE_ORIGIN: 'https://b.example' }, '100.70.1.2');
    expect(o.primary).toBe('https://a.example');
    expect(o.allowed).toContain('https://100.70.1.2:4443');
    expect(demoOrigins({}, '100.70.1.2').node).toBe('https://100.70.1.2:4444');
  });

  it('keeps an explicit https port (a Tailscale Funnel on 8443 and 10000)', () => {
    const o = demoOrigins({ DEMO_PUBLIC_ORIGIN: 'https://h.tail1.ts.net:8443', DEMO_PUBLIC_NODE_ORIGIN: 'https://h.tail1.ts.net:10000/' });
    expect(o.primary).toBe('https://h.tail1.ts.net:8443');
    expect(o.primaryWs).toBe('wss://h.tail1.ts.net:8443');
    expect(o.node).toBe('https://h.tail1.ts.net:10000');
    expect(o.allowed).toContain('https://h.tail1.ts.net:8443');
    // The WebAuthn RP ID is a host name, never a port.
    expect(o.rpId).toBe('h.tail1.ts.net');
    expect(publicOrigin('DEMO_PUBLIC_ORIGIN', 'https://a.example:443')).toBe('https://a.example');
  });

  it('refuses one without the other, the same origin twice, http, paths and credentials', () => {
    expect(() => demoOrigins({ DEMO_PUBLIC_ORIGIN: 'https://a.example' })).toThrow(DemoOriginError);
    expect(() => demoOrigins({ DEMO_PUBLIC_NODE_ORIGIN: 'https://a.example' })).toThrow(DemoOriginError);
    // One host may carry both: the gateway routes the node's RPC paths by path.
    expect(demoOrigins({ DEMO_PUBLIC_ORIGIN: 'https://a.example', DEMO_PUBLIC_NODE_ORIGIN: 'https://a.example/' }).node).toBe('https://a.example');
    for (const bad of ['http://a.example', 'wss://a.example', 'https://a.example/x', 'https://a.example?x=1', 'https://u:p@a.example', 'http://a.example:8443', 'not a url']) {
      expect(() => publicOrigin('DEMO_PUBLIC_ORIGIN', bad)).toThrow(DemoOriginError);
    }
  });

  it('finds the quick tunnel URL in a cloudflared log', () => {
    expect(quickTunnelUrl('INF |  https://fancy-words-here.trycloudflare.com  |\n')).toBe('https://fancy-words-here.trycloudflare.com');
    expect(quickTunnelUrl('INF Requesting new quick Tunnel on trycloudflare.com...')).toBeNull();
  });
});
