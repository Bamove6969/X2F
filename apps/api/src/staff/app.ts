import type { TradePublisher } from '../trades/store.js';
import fastifyCookie from '@fastify/cookie';
import { can } from '@x2f/staff';
import type { FastifyInstance } from 'fastify';
import { installErrorAnswers, newFastify, type Deps } from '../app.js';
import { originHook } from '../auth/origin.js';
import { STAFF_REALM } from '../auth/sessions.js';
import { EventBus } from '../events/bus.js';
import { newBudgets } from '../limits.js';
import { addSecurityHeaders } from '../static/serve.js';
import type { ModerationClient } from '../disputes/moderationClient.js';
import { staffDisputeRoutes } from '../disputes/staffRoutes.js';
import type { appendLog } from '../log/append.js';
import { assertRoutePerm, requireStaff, type StaffRoutePerm } from './guard.js';
import { staffInviteRoutes } from './invites.js';
import { staffMemberRoutes } from './members.js';
import { ownerKeyRoutes } from './ownerKeys.js';
import { keyTapRoutes } from './keyTap.js';
import { sendPush, webPushTransport, type PushKind, type PushOptions, type PushTransport } from '../push/send.js';
import { staffAccountRoutes } from './account.js';
import { staffFeedbackRoutes } from './feedback.js';
import { staffFeeSweepRoutes } from './feeSweep.js';
import { staffLoginRoutes } from './login.js';
import { staffNewsRoutes } from './news.js';
import { staffHoldRoutes } from './holds.js';
import { staffPastRepRoutes } from './pastrep.js';
import { staffPriceHealthRoutes } from './priceHealth.js';
import { ownerSetupRoutes } from './ownerSetup.js';
import { serveStaffWeb } from './web.js';
import { staffRevenueRoutes } from './revenue.js';
import { staffSettingsRoutes } from './settings.js';
import { staffSiteRoutes } from './site.js';

// The moderation process as the staff API sees it (Plan 4 Task 11): the API never holds a
// moderator key (Global Constraints) and reads a chat or a proof only through it.
export type { ModerationClient } from '../disputes/moderationClient.js';

export interface StaffDeps extends Deps {
  /** `X2F_STAFF_ORIGIN`: the staff app's own exact origin; the only `Origin` its unsafe requests may carry. */
  staffOrigin: string;
  /** The WebAuthn relying party of staff keys; default the staff origin's host name. */
  staffRpId?: string;
  moderation: ModerationClient;
  /** Plan 4 Task 11: the trader API's event bus (moderator-joined, proof-requested, chat); omitted, none are sent. */
  traderEvents?: Pick<EventBus, 'publish'>;
  /** The activity log's writer for the case routes (tests inject a failing one). */
  appendLog?: typeof appendLog;
  /** `X2F_STAFF_WEB_ROOT`: the built staff app (apps/staff-web/dist), served on this origin (Task 16). */
  staffWebRoot?: string;
  /**
   * The trader app's trade publisher (main.ts passes `app.tradePublish`): a staff action that moves
   * a trade (ending a hold resumes its trades) reaches the traders' live views. Unset: nobody hears.
   */
  tradePublish?: TradePublisher;
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
export async function buildStaffApi(
  deps: StaffDeps,
  options: { logStream?: { write(line: string): void }; pushTransport?: PushTransport } = {},
): Promise<FastifyInstance> {
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
  // Lead re-review 6 Nov item 2: real Web Push (staff subscribe at /staff/v1/account/push).
  const transport = options.pushTransport ?? webPushTransport;
  app.decorate('push', {
    send: (accountId: string, kind: PushKind, opts?: PushOptions) =>
      sendPush({ db: deps.db, clock: deps.clock, config: deps.config, transport, log: app.log }, accountId, kind, opts),
  });
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
  // Lead re-review 6 Nov items 1-2: one's own login methods, sessions, alerts and push.
  staffAccountRoutes(app);
  // Plan 4 Task 5: security-key taps, used by every tapped action (Tasks 7, 8, 12).
  keyTapRoutes(app, {
    guard: requireStaff('self'),
    accountOf: (req) => req.staff.accountId,
    // RV5 m10: a tap is used only from the session that started it (every consume passes it).
    sessionOf: (req) => req.auth.sessionId,
    // RV5 m7: a tap only for an action the member may take.
    allows: (req, need) => (need === 'owner' ? req.staff.role === 'owner' : can(req.staff.role, need, req.staff.grants)),
  });
  // Plan 4 Task 7: staff management, invites and the owner's keys.
  staffMemberRoutes(app);
  staffInviteRoutes(app);
  ownerKeyRoutes(app);
  // Plan 4 Task 6: owner first-run setup (public-setup; locked for good once it finishes).
  ownerSetupRoutes(app);
  // Plan 4 Task 8: the owner's settings (settings.write) and the site controls (site.control).
  staffSettingsRoutes(app);
  staffSiteRoutes(app);
  // Plan 4 Task 28: the owner writes News (site.control).
  staffNewsRoutes(app);
  // Owner Q13 (6 Nov): the owner's Price health page, moved from the trader API.
  staffPriceHealthRoutes(app);
  // Plan 5 Task 10 (owner 2026-11-02): a claim's verified dollar figure (senior moderators and the owner).
  staffPastRepRoutes(app);
  staffHoldRoutes(app);
  // Plan 5 Tasks 4 and 21: the owner reads platform feedback and the feedback form (feedback.read).
  staffFeedbackRoutes(app);
  // Plan 4 Task 11: the moderator's queue, case, logged chat access, messages, proof and freeze.
  staffDisputeRoutes(app, {
    moderation: deps.moderation,
    ...(deps.traderEvents ? { traderEvents: deps.traderEvents } : {}),
    ...(deps.appendLog ? { appendLog: deps.appendLog } : {}),
  });
  // Plan 4 Task 32: the owner's revenue totals from the internal revenue ledger (earnings.read).
  staffRevenueRoutes(app);
  // B-006 / Plan 4 Task 9: the fee wallet's sweep settings (settings.write; the send waits on Plan 6).
  staffFeeSweepRoutes(app);
  // Plan 4 Task 16: the staff web app's pages, last, so every API route above wins.
  if (deps.staffWebRoot !== undefined) await serveStaffWeb(app, deps.staffWebRoot);

  return app;
}
