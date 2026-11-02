import fastifyCookie from '@fastify/cookie';
import type { FastifyInstance } from 'fastify';
import { installErrorAnswers, newFastify, type Deps } from '../app.js';
import { originHook } from '../auth/origin.js';
import { STAFF_REALM } from '../auth/sessions.js';
import { EventBus } from '../events/bus.js';
import { newBudgets } from '../limits.js';
import { addSecurityHeaders } from '../static/serve.js';
import { assertRoutePerm, requireStaff, type StaffRoutePerm } from './guard.js';
import { keyTapRoutes } from './keyTap.js';
import { staffFeedbackRoutes } from './feedback.js';
import { staffLoginRoutes } from './login.js';
import { staffNewsRoutes } from './news.js';

/**
 * The moderation process as the staff API sees it (Plan 4 Task 11 builds it; until then nothing
 * calls it, and tests pass a stub). The API never holds a moderator key (Global Constraints).
 */
export interface ModerationClient {
  readonly name: 'moderation';
}

export interface StaffDeps extends Deps {
  /** `X2F_STAFF_ORIGIN`: the staff app's own exact origin; the only `Origin` its unsafe requests may carry. */
  staffOrigin: string;
  /** The WebAuthn relying party of staff keys; default the staff origin's host name. */
  staffRpId?: string;
  moderation: ModerationClient;
}

/** One registered staff route, as the privilege matrix test (test/staff/routes.ts) lists it. */
export interface StaffRoute {
  method: string;
  url: string;
  perm: StaffRoutePerm;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Plan 4 Task 4: every route of the staff app with its declared perm (HEAD routes left out). */
    staffRoutes: readonly StaffRoute[];
  }
}

/**
 * The staff app's Content-Security-Policy (like Plan 3's, without the relay, node proxy or wasm):
 * sent on every response, the staff web app's pages included (Task 16).
 */
export const STAFF_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "style-src 'self'",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * `buildStaffApi` (Plan 4 Task 4): a second Fastify instance on its own port and origin, with its
 * own session cookie (`__Host-x2f_staff`) and its own sessions (`sessions.app = 'staff'`). Request
 * logging is off (R5, `newFastify`). Unsafe requests need `Origin` equal to `staffOrigin` exactly;
 * WebAuthn uses the staff origin and relying party. Every route declares a perm in `config.perm`,
 * checked at startup (`assertRoutePerm`).
 */
export async function buildStaffApi(deps: StaffDeps, options: { logStream?: { write(line: string): void } } = {}): Promise<FastifyInstance> {
  const origin = new URL(deps.staffOrigin);
  if (origin.origin !== deps.staffOrigin) throw new Error('config: X2F_STAFF_ORIGIN must be an exact origin such as https://staff.example.org');
  // The staff app's own view of the config: its origin is the only allowed one, and keys are
  // registered and checked against its own relying party.
  const staffDeps: StaffDeps = {
    ...deps,
    config: { ...deps.config, origins: [deps.staffOrigin], rpId: deps.staffRpId ?? origin.hostname },
  };
  const app = newFastify(options.logStream);
  app.decorate('deps', staffDeps);
  app.decorate('budgets', newBudgets(deps.clock));
  // Staff have no live streams yet; ending a session still tells the (empty) bus.
  app.decorate('events', new EventBus());
  // No staff push subscriptions yet (Plan 6): a new staff login pushes nothing.
  app.decorate('push', { send: async () => false });
  app.decorate('sessionRealm', STAFF_REALM);
  app.decorate('sessionWriteRoutes', [] as string[]);
  app.decorateRequest('auth', null as never);
  app.decorateRequest('confirmedAction', null);
  app.decorateRequest('staff', null as never);
  await app.register(fastifyCookie);

  app.addHook('onRequest', addSecurityHeaders);
  app.addHook('onRequest', (_req, reply, done) => {
    // Every staff answer is private: never cached. The CSP covers the staff pages Task 16 serves.
    void reply.header('cache-control', 'no-store').header('content-security-policy', STAFF_CSP);
    done();
  });
  app.addHook('onRequest', originHook);
  app.removeContentTypeParser('text/plain');
  installErrorAnswers(app);

  const routes: StaffRoute[] = [];
  app.decorate('staffRoutes', routes);
  app.addHook('onRoute', (r) => {
    const perm = assertRoutePerm(r);
    for (const m of [r.method].flat()) if (m !== 'HEAD') routes.push({ method: m, url: r.url, perm });
  });

  app.get('/healthz', { config: { perm: 'public-login' } }, async () => ({ ok: true }));
  await staffLoginRoutes(app);
  // Plan 4 Task 5: security-key taps, used by every tapped action (Tasks 7, 8, 12).
  keyTapRoutes(app, { guard: requireStaff('self'), accountOf: (req) => req.staff.accountId });
  // Plan 4 Task 28: the owner writes News (site.control).
  staffNewsRoutes(app);
  // Plan 5 Tasks 4 and 21: the owner reads platform feedback and the feedback form (feedback.read).
  staffFeedbackRoutes(app);

  return app;
}
