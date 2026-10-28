import { createECDH } from 'node:crypto';

/** A fixed VAPID key pair (Task 19) for `loadConfig` tests: `X2F_VAPID_PUBLIC` and `X2F_VAPID_PRIVATE`, base64url. */
export const VAPID_ENV = (() => {
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(Buffer.alloc(32, 5));
  return { X2F_VAPID_PUBLIC: ecdh.getPublicKey().toString('base64url'), X2F_VAPID_PRIVATE: Buffer.alloc(32, 5).toString('base64url') };
})();
