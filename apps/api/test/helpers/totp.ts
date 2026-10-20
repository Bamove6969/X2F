import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { Secret, TOTP } from 'otpauth';
import type { Deps } from '../../src/app.js';
import { startSession } from '../../src/auth/sessions.js';

export const ORIGIN = 'https://x2f.test';
export const STEP_MS = 30_000;

/** The 6-digit code an authenticator app shows for `secret` (base32) at `at`. */
export function codeAt(secret: string, at: Date): string {
  return TOTP.generate({ secret: Secret.fromBase32(secret), algorithm: 'SHA1', digits: 6, period: 30, timestamp: at.getTime() });
}

/** A 6-digit code that is not the right one for `secret` at `at` (or the neighbouring steps). */
export function wrongCodeAt(secret: string, at: Date): string {
  const near = new Set([-1, 0, 1].map((d) => codeAt(secret, new Date(at.getTime() + d * STEP_MS))));
  for (let i = 0; ; i++) {
    const c = String(i).padStart(6, '0');
    if (!near.has(c)) return c;
  }
}

/** A browser: keeps the cookies the API sets and sends them back. */
export class Browser {
  cookies: Record<string, string> = {};

  constructor(private readonly app: FastifyInstance) {}

  keep(res: LightMyRequestResponse): LightMyRequestResponse {
    for (const c of res.cookies) {
      if (c.maxAge === 0 || c.value === '') delete this.cookies[c.name];
      else this.cookies[c.name] = c.value;
    }
    return res;
  }

  async post(url: string, payload: unknown = {}): Promise<LightMyRequestResponse> {
    return this.keep(
      await this.app.inject({ method: 'POST', url, headers: { origin: ORIGIN }, cookies: this.cookies, payload: payload as Record<string, unknown> }),
    );
  }

  async get(url: string): Promise<LightMyRequestResponse> {
    return this.keep(await this.app.inject({ method: 'GET', url, cookies: this.cookies }));
  }

  async delete(url: string): Promise<LightMyRequestResponse> {
    return this.keep(await this.app.inject({ method: 'DELETE', url, headers: { origin: ORIGIN }, cookies: this.cookies }));
  }
}

/** Adds `POST /t/login { accountId, firstSession?, level? }`, which starts a session directly (tests only). */
export function addTestLogin(app: FastifyInstance, deps: Deps): void {
  app.post('/t/login', async (req, reply) => {
    const b = req.body as { accountId: string; firstSession?: boolean; level?: 'full' | 'recovery' };
    const sessionId = await startSession(deps, req, reply, {
      accountId: b.accountId, level: b.level ?? 'full', deviceLabel: 'Test browser', method: 'passkey',
      firstSession: b.firstSession ?? false,
    });
    return { sessionId };
  });
}
