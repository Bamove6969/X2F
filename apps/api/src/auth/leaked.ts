import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { normalizePassword } from '@x2f/accounts';
import type { LeakedList } from '../app.js';

const RECORD = 20;

/**
 * Opens the leaked-password list (`tools/leaked/build-leaked-list.ts`): sorted 20-byte SHA-1
 * records. Throws at startup if the file is missing or its size is not a multiple of 20. Lookups
 * hash the NFC form as UTF-8 and binary-search with positioned reads; nothing leaves the server.
 */
export async function openLeakedList(path: string): Promise<LeakedList> {
  const fh = await open(path, 'r');
  const { size } = await fh.stat();
  if (size % RECORD !== 0) {
    await fh.close();
    throw new Error('leaked list: file size is not a multiple of 20');
  }
  const count = size / RECORD;
  return {
    async has(password: string): Promise<boolean> {
      // SHA-1 because that is the format Have I Been Pwned publishes; it is a lookup key, not a password hash.
      const target = createHash('sha1').update(normalizePassword(password), 'utf8').digest();
      const buf = Buffer.alloc(RECORD);
      let lo = 0;
      let hi = count - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        await fh.read(buf, 0, RECORD, mid * RECORD);
        const c = Buffer.compare(buf, target);
        if (c === 0) return true;
        if (c < 0) lo = mid + 1;
        else hi = mid - 1;
      }
      return false;
    },
  };
}
