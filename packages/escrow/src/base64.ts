// Standard base64 without Node's Buffer, so the escrow code also runs in browsers.
const CHUNK = 0x8000;

export function toBase64(data: Uint8Array | DataView): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let bin = '';
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

export function fromBase64(s: string): Uint8Array {
  const bin = atob(s); // throws on invalid input
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
