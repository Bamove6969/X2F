import { ROLES, normalizeTradeCode, type Role } from '@x2f/core';
import { canonicalJson } from '@x2f/protocol';
import Fastify, { type FastifyInstance } from 'fastify';
import sodium from 'libsodium-wrappers';

/** A signed admin call is refused when its `at` is further than this from the relay's clock. */
export const ADMIN_MAX_AGE_MS = 60_000;
const DOMAINS = { register: 'x2f/relay-register/v1\0', close: 'x2f/relay-close/v1\0' } as const;
const MAX_REPLAY_ENTRIES = 10_000;
const HEX_KEY = /^[0-9a-f]{64}$/;

export type AdminKind = keyof typeof DOMAINS;
export interface RegisterBody {
  channel: string;
  signPublics: Record<Role, string>;
  /** Milliseconds since the epoch, on the signer's clock. */
  at: number;
}
export interface CloseBody {
  channel: string;
  at: number;
}

/** The bytes the moderation key signs: the domain, then canonical JSON of every field but `sig`. */
export function adminMessage(kind: 'register', body: RegisterBody): Uint8Array;
export function adminMessage(kind: 'close', body: CloseBody): Uint8Array;
export function adminMessage(kind: AdminKind, body: RegisterBody | CloseBody): Uint8Array {
  return new TextEncoder().encode(DOMAINS[kind] + canonicalJson(body));
}

export interface AdminOptions {
  /** The moderation service's Ed25519 signing key (hex). */
  modSigningPublic: string;
  /** Clock for the freshness check; tests pass a fixed one. */
  now?: () => number;
}

interface Target {
  registerTrade(code: string, signPublics: Record<Role, string>): void;
  closeTrade(code: string): void;
}

class Refused extends Error {
  constructor(readonly status: number, readonly reason: string) {
    super(reason);
  }
}

function isPlainObject(x: unknown): x is Record<string, unknown> {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const proto = Object.getPrototypeOf(x) as unknown;
  return proto === Object.prototype || proto === null;
}

function exactKeys(o: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(o);
  return own.length === keys.length && keys.every((k) => Object.prototype.hasOwnProperty.call(o, k));
}

/**
 * The relay's private admin listener: the moderation service registers and closes trade
 * channels with calls signed by its key. Bind it to a private interface only; the public
 * listener has no admin route. No trustProxy, and logs carry reasons only.
 */
export async function buildRelayAdmin(target: Target, o: AdminOptions, log: (e: { reason: string }) => void): Promise<FastifyInstance> {
  await sodium.ready;
  if (typeof o.modSigningPublic !== 'string' || !HEX_KEY.test(o.modSigningPublic)) throw new TypeError('relay admin: bad moderation signing key');
  const modKey = sodium.from_hex(o.modSigningPublic);
  const now = o.now ?? Date.now;
  /** Signed messages seen within the freshness window, so none can be replayed (e.g. after a close). */
  const seen = new Map<string, number>();

  const check = (kind: AdminKind, raw: unknown): Record<string, unknown> => {
    const keys = kind === 'register' ? ['channel', 'signPublics', 'at', 'sig'] : ['channel', 'at', 'sig'];
    if (!isPlainObject(raw) || !exactKeys(raw, keys)) throw new Refused(400, 'bad-body');
    const { channel, at, sig } = raw;
    if (typeof channel !== 'string' || normalizeTradeCode(channel) === null) throw new Refused(400, 'bad-body');
    if (typeof at !== 'number' || !Number.isSafeInteger(at)) throw new Refused(400, 'bad-body');
    if (kind === 'register') {
      const sp = raw.signPublics;
      if (!isPlainObject(sp) || !exactKeys(sp, ROLES) || ROLES.some((r) => typeof sp[r] !== 'string' || !HEX_KEY.test(sp[r] as string))) {
        throw new Refused(400, 'bad-body');
      }
    }
    let sigBytes: Uint8Array;
    try {
      if (typeof sig !== 'string') throw new Error('sig');
      sigBytes = sodium.from_base64(sig, sodium.base64_variants.ORIGINAL);
    } catch {
      throw new Refused(400, 'bad-body');
    }
    const body = kind === 'register'
      ? { channel, signPublics: raw.signPublics as Record<Role, string>, at }
      : { channel, at };
    const msg = kind === 'register' ? adminMessage('register', body as RegisterBody) : adminMessage('close', body as CloseBody);
    if (sigBytes.length !== sodium.crypto_sign_BYTES || !sodium.crypto_sign_verify_detached(sigBytes, msg, modKey)) {
      throw new Refused(401, 'bad-signature');
    }
    const t = now();
    if (Math.abs(t - at) > ADMIN_MAX_AGE_MS) throw new Refused(401, 'stale');
    for (const [k, until] of seen) if (until < t) seen.delete(k);
    const id = sodium.to_hex(sodium.crypto_generichash(32, msg, null));
    if (seen.has(id)) throw new Refused(409, 'replay');
    if (seen.size >= MAX_REPLAY_ENTRIES) throw new Refused(503, 'busy');
    seen.set(id, t + 2 * ADMIN_MAX_AGE_MS);
    return body;
  };

  const app = Fastify({ logger: false, bodyLimit: 4096 });
  // Parse JSON ourselves: refuse anything that is not exactly the documented body.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(null, { invalid: true });
    }
  });
  app.setErrorHandler((_e, _req, reply) => {
    log({ reason: 'admin-bad-request' });
    return reply.code(400).send({ error: 'bad-body' });
  });

  const handle = (kind: AdminKind) => async (req: { body: unknown }, reply: { code(n: number): { send(b: unknown): unknown } }) => {
    try {
      const body = check(kind, req.body);
      if (kind === 'register') {
        try {
          target.registerTrade(body.channel as string, body.signPublics as Record<Role, string>);
        } catch (e) {
          if (e instanceof TypeError) throw new Refused(400, 'bad-body');
          if (e instanceof Error && e.name === 'RelayAtCapacityError') throw new Refused(503, 'at-capacity');
          throw new Refused(409, 'exists');
        }
        log({ reason: 'admin-registered' });
        return reply.code(201).send({ ok: true });
      }
      target.closeTrade(body.channel as string);
      log({ reason: 'admin-closed' });
      return reply.code(200).send({ ok: true });
    } catch (e) {
      if (!(e instanceof Refused)) throw e;
      log({ reason: `admin-${e.reason}` });
      return reply.code(e.status).send({ error: e.reason });
    }
  };
  app.post('/v1/admin/trades', handle('register'));
  app.post('/v1/admin/trades/close', handle('close'));
  return app;
}
