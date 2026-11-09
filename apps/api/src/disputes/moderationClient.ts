import { createHmac } from 'node:crypto';
import { request } from 'node:http';
import { MOD_INTERNAL_MAC_HEADER, MOD_INTERNAL_TS_HEADER, modInternalMacInput } from '@x2f/trade';

/**
 * Plan 4 Task 11: the API's client of the moderation process's internal API. The moderation
 * process holds the chat's moderator identity, so only it can seal the moderator's message.
 *
 * NEEDS_P4_CHAT_MEMBERSHIP: there is NO chat read here (the plan's `chatRead`, plaintext from the
 * moderation process through the API, was removed: a compromised API could read every disputed
 * chat), and NO proof read (`proofRead`, the unblurred image through the API, review 8 Nov I-1).
 * Build task 9 of design-chat-membership-keys-2026-11-08 (`/internal/chat/grant`, keys wrapped to
 * certified staff device keys; the proof key re-wrapped the same way) replaces both.
 * NEEDS_P4_MOD_COUNTERSIGN: the moderation process answers `chatSend` only in dev builds
 * (X2F_DEV_MOD_CHAT=1, review 8 Nov I-2); in production it is 404 and the API answers 502. It listens on a Unix socket only
 * (`MOD_INTERNAL_SOCKET`); every request carries an HMAC (`MOD_INTERNAL_SECRET`) over the method,
 * the path, the exact body and the time, and names the activity-log entry the API committed for
 * it, which the moderation process checks in the API's database before it does anything.
 */

export interface ModerationClient {
  readonly name: 'moderation';
  /** `POST /internal/chat/send`: the moderator's message sealed to both traders; the API stores it. */
  chatSend(a: { code: string; logEntryId: string; text: string }): Promise<{ envelope: unknown }>;
}

/** A refusal from the moderation process (its status and error code), or `moderation-unavailable` (503). */
export class ModerationError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
    this.name = 'ModerationError';
  }
}

/** Stands in where no moderation process is configured: every call is `moderation-unavailable`. */
export const NO_MODERATION: ModerationClient = {
  name: 'moderation',
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

  const call = (path: string, payload: Record<string, string>): Promise<Answer> => {
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
    try {
      const v = JSON.parse(a.body.toString('utf8')) as { error?: unknown };
      if (typeof v.error === 'string' && ERROR_CODE.test(v.error)) code = v.error;
    } catch {
      // Not JSON: keep the generic code.
    }
    return new ModerationError(a.status >= 400 && a.status < 600 ? a.status : 502, code);
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
    async chatSend(a) {
      const v = json(await call('/internal/chat/send', { code: a.code, logEntryId: a.logEntryId, text: a.text }));
      if (v.envelope === undefined) throw new ModerationError(502, 'moderation-unavailable');
      return { envelope: v.envelope };
    },
  };
}
