import { describe, expect, it } from 'vitest';
import { portOffset } from '../demo/config.js';

describe('DEMO_PORT_OFFSET (demo r6: a second demo beside a running one)', () => {
  it('is 0 when unset or empty, else a multiple of 10 up to 900', () => {
    expect(portOffset({})).toBe(0);
    expect(portOffset({ DEMO_PORT_OFFSET: '' })).toBe(0);
    expect(portOffset({ DEMO_PORT_OFFSET: '10' })).toBe(10);
    expect(portOffset({ DEMO_PORT_OFFSET: '900' })).toBe(900);
    for (const bad of ['5', '-10', '1e1', '910', 'ten', '10.0', ' 1 0']) expect(() => portOffset({ DEMO_PORT_OFFSET: bad })).toThrow(/DEMO_PORT_OFFSET/);
  });
});

describe('demo:web (web-only redeploy)', () => {
  it('keeps the old hashed assets a tab may still ask for, but never a second escrow worker', async () => {
    const { carriedAssets } = await import('../demo/web-build.js');
    expect(carriedAssets(['index-OLD.js', 'chunk-A.js', 'escrow-worker-OLDHASH1.js', 'same.css'], ['index-NEW.js', 'same.css', 'escrow-worker-NEWHASH2.js'])).toEqual(['index-OLD.js', 'chunk-A.js']);
  });
});
