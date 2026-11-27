import { createHmac } from 'node:crypto';
import { request } from 'node:http';
import { MOD_INTERNAL_MAC_HEADER, MOD_INTERNAL_TS_HEADER, modInternalMacInput } from '@x2f/trade';

/**
 * Plan 4 Task 11: the API's client of the moderation process's internal API; design build task 9
 * (design-chat-membership-keys-2026-11-08). No chat text passes through it:
 * - `chatGrant`: the chat key re-wrapped by the moderation process to a certified staff device of a
 *   staff member on the case; the API stores and forwards the wrap, which only that device opens.
 * - `chatSend`: a moderator message a certified staff device sealed under the chat key and
 *   countersigned (x2f/mod-countersign/v1); the moderation process checks it and signs the v2
 *   envelope as the moderator; the API stores it.
 * NEEDS_P5_PROOF_ENVELOPE: there is NO proof read (`proofRead`, the unblurred image through the API,
 * review 8 Nov I-1); the design re-wraps the proof key to the staff device the same way, once the
 * unblurred proof exists. The moderation process listens on a Unix socket only
 * (`MOD_INTERNAL_SOCKET`); every request carries an HMAC (`MOD_INTERNAL_SECRET`) over the method,
 * the path, the exact body and the time, and names the activity-log entry the API committed for
 * it, which the moderation process checks in the API's database before it does anything.
 */

/** Who asks, on which device: the staff member the log entry names and their certified device key id. */
export interface ModCaseCall {
  code: string;
  logEntryId: string;
  staffAccountId: string;
  deviceKeyId: string;
}

/** The staff device's sealed, countersigned moderator message (as staff-web sends it). */
export interface ModCountersigned {
  seq: number;
  nonce: string;
  ct: string;
  ctSha256: string;
  requestId: string;
  issuedAt: string;
  sig: string;
}

export interface ModerationClient {
  readonly name: 'moderation';
  /**
   * `POST /internal/chat/grant`: the chat key re-wrapped to the staff device (`wrap`, of `tkh`), the
   * next moderator seq, and both private lanes (`lanes: [{ to, pkh, wrap, nextSeq, record }]`, the
   * lane key PK sealed to the device and the moderator-signed lane record for trader `to`;
   * private-mod-chat-2026-11-27). Unchecked here: the staff route checks and verifies them.
   */
  chatGrant(a: ModCaseCall): Promise<{ wrap: string; tkh: string; boxPublic: string; nextSeq: number; lanes: unknown }>;
  /**
   * `POST /internal/chat/send`: the countersigned message signed as the moderator; the API stores it.
   * With `to`, a private lane message (envelope v3, the lane countersign).
   */
  chatSend(a: ModCaseCall & ModCountersigned & { to?: 'buyer' | 'seller' }): Promise<{ envelope: unknown }>;
}

/** A refusal from the moderation process (its status and error code), or `moderation-unavailable` (503). */
export class ModerationError extends Error {
  constructor(readonly status: number, readonly code: string, readonly nextSeq: number | null = null) {
    super(code);
    this.name = 'ModerationError';
  }
}

/** Stands in where no moderation process is configured: every call is `moderation-unavailable`. */
export const NO_MODERATION: ModerationClient = {
  name: 'moderation',
  chatGrant: async () => {
    throw new ModerationError(503, 'moderation-unavailable');
  },
  chatSend: async () => {
    throw new ModerationError(503, 'moderation-unavailable');
  },
};

export interface SocketModerationOptions {
  /** `MOD_INTERNAL_SOCKET`: the moderation process's Unix socket path. */
  socketPath: string;
  /** `MOD_INTERNAL_SECRET`: 32 bytes, shared with the moderation process only. */
  secret: Uint8Array;
  clock: () => Date;
  /** Per call; default 10 s. */
  timeoutMs?: number;
}

/** The largest answer read (one sealed chat envelope fits well under it). */
export const MOD_ANSWER_MAX_BYTES = 1024 * 1024;
const ERROR_CODE = /^[a-z][a-z0-9-]{0,40}$/;

interface Answer {
  status: number;
  type: string;
  body: Buffer;
}

/** The real client: HTTP over the Unix socket, signed as the moderation process expects. */
export function socketModerationClient(o: SocketModerationOptions): ModerationClient {
  if (!(o.secret instanceof Uint8Array) || o.secret.length !== 32) throw new TypeError('config: MOD_INTERNAL_SECRET must be 32 bytes');
  const timeoutMs = o.timeoutMs ?? 10_000;

  const call = (path: string, payload: Record<string, string | number>): Promise<Answer> => {
    const body = JSON.stringify(payload);
    const ts = String(o.clock().getTime());
    const mac = createHmac('sha256', o.secret).update(modInternalMacInput({ method: 'POST', path, body, ts }), 'utf8').digest('hex');
    return new Promise<Answer>((resolve, reject) => {
      const req = request(
        {
          socketPath: o.socketPath,
          path,
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
            [MOD_INTERNAL_MAC_HEADER]: mac,
            [MOD_INTERNAL_TS_HEADER]: ts,
          },
          timeout: timeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on('data', (c: Buffer) => {
            size += c.length;
            if (size > MOD_ANSWER_MAX_BYTES) {
              res.destroy();
              reject(new ModerationError(502, 'moderation-unavailable'));
              return;
            }
            chunks.push(c);
          });
          res.on('end', () => resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? ''), body: Buffer.concat(chunks) }));
          res.on('error', () => reject(new ModerationError(503, 'moderation-unavailable')));
        },
      );
      req.on('timeout', () => req.destroy(new Error('timeout')));
      // A socket that is missing, refused or cut: the process is not there.
      req.on('error', () => reject(new ModerationError(503, 'moderation-unavailable')));
      req.end(body);
    });
  };

  /** A non-200 answer as a ModerationError carrying the process's own code (when it is one). */
  const refusal = (a: Answer): ModerationError => {
    let code = 'moderation-unavailable';
    let nextSeq: number | null = null;
    try {
      const v = JSON.parse(a.body.toString('utf8')) as { error?: unknown; nextSeq?: unknown };
      if (typeof v.error === 'string' && ERROR_CODE.test(v.error)) code = v.error;
      if (typeof v.nextSeq === 'number' && Number.isSafeInteger(v.nextSeq) && v.nextSeq >= 0) nextSeq = v.nextSeq;
    } catch {
      // Not JSON: keep the generic code.
    }
    return new ModerationError(a.status >= 400 && a.status < 600 ? a.status : 502, code, nextSeq);
  };

  const json = (a: Answer): Record<string, unknown> => {
    if (a.status !== 200) throw refusal(a);
    try {
      const v = JSON.parse(a.body.toString('utf8')) as unknown;
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch {
      // Falls through.
    }
    throw new ModerationError(502, 'moderation-unavailable');
  };

  return {
    name: 'moderation',
    async chatGrant(a) {
      const v = json(await call('/internal/chat/grant', { code: a.code, logEntryId: a.logEntryId, staffAccountId: a.staffAccountId, deviceKeyId: a.deviceKeyId }));
      if (typeof v.wrap !== 'string' || typeof v.tkh !== 'string' || typeof v.boxPublic !== 'string' || typeof v.nextSeq !== 'number') throw new ModerationError(502, 'moderation-unavailable');
      return { wrap: v.wrap, tkh: v.tkh, boxPublic: v.boxPublic, nextSeq: v.nextSeq, lanes: v.lanes };
    },
    async chatSend(a) {
      const v = json(await call('/internal/chat/send', {
        code: a.code, logEntryId: a.logEntryId, staffAccountId: a.staffAccountId, deviceKeyId: a.deviceKeyId,
        seq: a.seq, nonce: a.nonce, ct: a.ct, ctSha256: a.ctSha256, requestId: a.requestId, issuedAt: a.issuedAt, sig: a.sig,
        ...(a.to === undefined ? {} : { to: a.to }),
      }));
      if (v.envelope === undefined) throw new ModerationError(502, 'moderation-unavailable');
      return { envelope: v.envelope };
    },
  };
}
