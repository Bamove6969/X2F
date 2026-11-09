// @vitest-environment happy-dom
// Row P-031 (job J-22): the receiving device shows only its own redrawn copy of a proof image, and a
// clear refusal (never a crash, never the received bytes) when the image fails the check. The rule
// and its fuzzing are in packages/proof/test/receive.test.ts; the browser decoder and canvas are
// passed in here, as in reencode.test.ts (happy-dom has no real canvas).
import { act } from 'react';
import { crc32, deflateSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { type ReceiveDeps, readImageHeader } from '@x2f/proof';
import { showableProof } from '../src/proof/receive.js';
import { PROOF_REFUSED_BODY, PROOF_REFUSED_TITLE, ProofThumb } from '../src/screens/proof/ProofThumb.js';
import { render } from './render.js';

const latin1 = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  out.set(latin1(type), 4);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** A w x h RGB PNG, every pixel `rgb`. */
function png(w: number, h: number, rgb: [number, number, number], ...extra: Uint8Array[]): Uint8Array {
  const head = new Uint8Array(13);
  const v = new DataView(head.buffer);
  v.setUint32(0, w);
  v.setUint32(4, h);
  head[8] = 8;
  head[9] = 2;
  const raw = new Uint8Array(h * (1 + 3 * w));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgb, y * (1 + 3 * w) + 1 + 3 * x);
  return Buffer.concat([Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), chunk('IHDR', head), ...extra, chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array(0))]);
}

const RECEIVED = png(4, 3, [10, 20, 30], chunk('tEXt', latin1('Comment\0<script>alert(1)</script>')));
const REDRAWN = png(4, 3, [10, 20, 30]);

function deps(over: Partial<ReceiveDeps> = {}): ReceiveDeps & { decode: ReturnType<typeof vi.fn> } {
  const decode = vi.fn(async (bytes: Uint8Array) => ({ ...readImageHeader(bytes), close: () => undefined }));
  return { decode, render: async () => REDRAWN, ...over } as ReceiveDeps & { decode: ReturnType<typeof vi.fn> };
}

/** Let the check's promises settle inside act. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  });
}

describe('showableProof', () => {
  it('returns a data: URL of the redrawn PNG, not of the received bytes', async () => {
    const shown = await showableProof(RECEIVED, { mime: 'image/png', width: 4, height: 3 }, deps());
    expect(shown.src.startsWith('data:image/png;base64,')).toBe(true);
    const bytes = Buffer.from(shown.src.slice('data:image/png;base64,'.length), 'base64');
    expect(bytes.equals(Buffer.from(REDRAWN))).toBe(true);
    expect(bytes.includes(Buffer.from('<script'))).toBe(false);
  });
});

describe('ProofThumb', () => {
  it('shows the redrawn copy once the check passes', async () => {
    const { host } = render(<ProofThumb bytes={RECEIVED} declared={{ mime: 'image/png', width: 4, height: 3 }} alt="Payment proof" deps={deps()} />);
    expect(host.querySelector('[data-part="proof-checking"]')).not.toBeNull();
    expect(host.querySelector('img')).toBeNull();
    await settle();
    const img = host.querySelector('img')!;
    expect(img.getAttribute('data-part')).toBe('proof-image');
    expect(img.getAttribute('alt')).toBe('Payment proof');
    expect(img.getAttribute('width')).toBe('4');
    expect(Buffer.from(img.getAttribute('src')!.split(',')[1]!, 'base64').equals(Buffer.from(REDRAWN))).toBe(true);
    expect(host.querySelector('[data-part="proof-refused"]')).toBeNull();
  });

  const refusals: [string, Uint8Array, string, Partial<ReceiveDeps>][] = [
    ['truncated', RECEIVED.subarray(0, 30), 'image/png', {}],
    ['wrong magic', latin1('<svg onload="alert(1)"/>'), 'image/png', {}],
    ['declared type not allowed', RECEIVED, 'image/svg+xml', {}],
    ['oversized header', png(3000, 1, [0, 0, 0]), 'image/png', {}],
    ['polyglot tail', Buffer.concat([RECEIVED, latin1('<script>alert(1)</script>')]), 'image/png', {}],
    ['decoder fails', RECEIVED, 'image/png', { decode: async () => Promise.reject(new DOMException('bad', 'InvalidStateError')) }],
    ['decoder throws synchronously', RECEIVED, 'image/png', { decode: () => { throw new Error('boom'); } }],
    ['canvas fails', RECEIVED, 'image/png', { render: async () => Promise.reject(new Error('no canvas')) }],
  ];
  for (const [name, bytes, mime, over] of refusals) {
    it(`${name}: a refusal, no image, no crash`, async () => {
      const { host } = render(<ProofThumb bytes={bytes} declared={{ mime }} alt="Payment proof" deps={deps(over)} />);
      await settle();
      expect(host.querySelector('img')).toBeNull();
      const notice = host.querySelector('[data-part="proof-refused"]')!;
      expect(notice).not.toBeNull();
      expect(notice.getAttribute('role')).toBe('alert');
      expect(notice.textContent).toContain(PROOF_REFUSED_TITLE);
      expect(notice.textContent).toContain(PROOF_REFUSED_BODY);
    });
  }
});
