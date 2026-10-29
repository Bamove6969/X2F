import fastifyCookie from '@fastify/cookie';
import Fastify, { LogController, type FastifyError, type FastifyInstance, type FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { Config } from './config.js';
import { methodRoutes } from './auth/methods.js';
import { originHook } from './auth/origin.js';
import { passwordRoutes } from './auth/password.js';
import { pgpRoutes, type PgpSigner } from './auth/pgp.js';
import { recoveryRoutes } from './auth/recovery.js';
import { logoutRoute } from './auth/sessions.js';
import { totpRoutes } from './auth/totp.js';
import { webauthnLoginRoutes, webauthnRoutes } from './auth/webauthn.js';
import type { TxConfirmations } from './trades/chain.js';
import { confirmationsRoute, tradeRoutes } from './trades/routes.js';
import type { TradePublisher } from './trades/store.js';
import { walletRoutes } from './wallets/routes.js';
import { methodListRoutes, type LiveOfferStats } from './methods/routes.js';
import { offerRoutes } from './offers/routes.js';
import { nudgeRoutes, type NudgeWiring } from './nudge/routes.js';
import { feedbackFormRoutes } from './feedback/form.js';
import type { MarketPrices } from './price/market.js';
import { priceRoutes } from './price/routes.js';
import { ApiError } from './errors.js';
import { accountRoutes } from './routes/account.js';
import { tradeIdentityRoutes } from './trades/identity.js';
import { newBudgets, type Budgets } from './limits.js';
import { addSecurityHeaders, clientErrorHandler, frameworkErrors } from './static/serve.js';
import { EventBus, type EventBusOptions } from './events/bus.js';
import { eventRoutes, type EventStreamOptions } from './events/routes.js';
import { tradeEventPublisher } from './events/tradePublisher.js';
import { pushRoutes } from './push/routes.js';
import { sendPush, webPushTransport, type PushKind, type PushTransport } from './push/send.js';

// Interface-only stubs, filled in by the task named on each; their shapes follow the plan text.
/** Task 6: the leaked-password list held on X2F's own server. */
export interface LeakedList {
  has(password: string): Promise<boolean>;
}
/**
 * Task 12: Monero payout address check for the configured network. Async because monero-ts's
 * `MoneroUtils.isValidAddress` is (it runs in its WebAssembly task queue).
 */
export interface AddressValidator {
  check(address: string): Promise<'ok' | 'invalid' | 'integrated'>;
}
/**
 * Task 8: FIDO metadata snapshot and AAGUID allowlists for staff and owner keys. `kind` picks the
 * allowlist: the owner's (YubiKey 5 on firmware 5.7 or newer) or staff's (certified YubiKey 5, the
 * Yubico Security Key series, Google Titan), owner's rules of 2026-10-20.
 */
export interface AttestationPolicy {
  init(): Promise<void>;
  isAllowed(aaguid: string, fmt: string, kind: 'owner' | 'staff'): boolean;
}
/** Task 7: the official X2F PGP signing key (R7). */
export type { PgpSigner } from './auth/pgp.js';

export interface Deps {
  config: Config;
  db: pg.Pool;
  clock: () => Date;
  leaked: LeakedList;
  addresses: AddressValidator;
  attestation: AttestationPolicy;
  pgpSigner: PgpSigner;
  /** Plan 3 Task 3: market prices, XMR/USD median × exchange rate, with price health (`main.ts` starts polling). */
  prices: MarketPrices;
  /** Live-offer counts for `/v1/methods`; default Task 4's, from the `offers` table (offers/routes.ts `liveOfferStats`). */
  liveOffers?: LiveOfferStats;
  /** Task 26: shared-context check (Tasks 6, 20), SSE publish and Web Push (Task 19). */
  nudges: NudgeWiring;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Per-app request budgets on `deps.clock` (P2-I8). */
    budgets: Budgets;
    /** The app's dependencies, for hooks that receive only the request (`requireSession`, the origin check). */
    deps: Deps;
    /** Task 19: live events to each account's own open streams (`publish`, `delivered`). */
    events: EventBus;
    /** Task 19: the generic Web Push (`send(accountId, kind)`; true when a push service answered 201). */
    push: { send(accountId: string, kind: PushKind): Promise<boolean> };
  }
}

export interface BuildOptions {
  /** Where log lines go (default stdout); tests capture them. */
  logStream?: { write(line: string): void };
  /** Task 19: stream caps, heartbeat and stream lifetime (defaults in events/). */
  events?: EventBusOptions & EventStreamOptions;
  /** Task 19: where pushes go (default web-push); tests pass a fake push service. */
  pushTransport?: PushTransport;
  /** Trade event delivery after commit; default Task 19's `tradeEventPublisher` (SSE, Web Push, final alert). */
  tradePublish?: TradePublisher;
  /** Plan 3 Task 24: confirmations from X2F's own node; without it the released screen's count is unknown. */
  txConfirmations?: TxConfirmations;
}

export const BODY_LIMIT = 16 * 1024;

/** Spread into `app.listen()`: the default "Server listening at http://host:port" names the bind address. */
export const LISTEN_OPTIONS = { listenTextResolver: () => 'listening' };

/** R5: a request in a log line is its method and route pattern, nothing else. */
function logRequest(req: FastifyRequest): { method?: string; route?: string } {
  const out: { method?: string; route?: string } = {};
  if (typeof req.method === 'string') out.method = req.method;
  const route = req.routeOptions?.url;
  if (typeof route === 'string') out.route = route;
  return out;
}

/**
 * An error in a log line is its class name and code only. Its message, stack and fields such as
 * Postgres' `detail` ("Key (col)=(value)") or fastify's "already sent ... in /url" can quote row
 * values, URLs and trade codes.
 */
function logError(e: unknown): { type: string; code?: string } {
  const out: { type: string; code?: string } = { type: e instanceof Error ? e.name : 'Error' };
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === 'string') out.code = code;
  return out;
}

export const WITHHELD_MESSAGE = 'message withheld (may contain a URL)';

/**
 * pino hook run on every log call. A string argument with '/' or '?' (a URL, a path, a query) is
 * replaced; and a call with an error but no message gets a fixed one, because pino would otherwise
 * copy `err.message` into `msg`.
 */
function logMethod(this: unknown, args: unknown[], method: (...a: unknown[]) => void): void {
  const out = args.map((a) => (typeof a === 'string' && /[/?]/.test(a) ? WITHHELD_MESSAGE : a));
  const first = out[0];
  if (first !== null && typeof first === 'object' && typeof out[1] !== 'string' && (first instanceof Error || 'err' in first)) {
    out.splice(1, 0, 'error');
  }
  method.apply(this, out);
}

export async function buildApi(deps: Deps, options: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    // R5: no request logging, no proxy trust (so no forwarded addresses), and a request
    // serializer that keeps only the method and the route pattern: never the URL (it can carry
    // trade codes), the caller's address or port, or the Host header.
    // (`logController` is fastify 5.12's replacement for the deprecated top-level `disableRequestLogging`.)
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: BODY_LIMIT,
    // Malformed URLs are refused before onRequest runs; this keeps the headers and hides the path (P3-I15).
    frameworkErrors,
    // HTTP that cannot be parsed at all (bad request line, oversized headers) gets the headers too.
    clientErrorHandler,
    logger: {
      level: 'info',
      base: null, // drops pino's default pid and machine hostname
      serializers: {
        req: logRequest,
        res: (res) => ({ statusCode: res.statusCode }),
        // Typed by fastify as returning message and stack; leaving them out is the point.
        err: logError as unknown as (e: FastifyError) => { type: string; message: string; stack: string },
        error: logError,
      },
      hooks: { logMethod },
      redact: { paths: ['req.body', 'req.headers.cookie', 'res.headers["set-cookie"]'], censor: '[redacted]' },
      ...(options.logStream ? { stream: options.logStream } : {}),
    },
  });

  app.decorate('budgets', newBudgets(deps.clock));
  app.decorate('deps', deps);
  const events = new EventBus(options.events);
  app.decorate('events', events);
  const transport = options.pushTransport ?? webPushTransport;
  app.decorate('push', {
    send: (accountId: string, kind: PushKind) => sendPush({ db: deps.db, clock: deps.clock, config: deps.config, transport, log: app.log }, accountId, kind),
  });
  app.decorateRequest('auth', null as never);
  app.decorateRequest('confirmedAction', null);
  await app.register(fastifyCookie);

  // Referrer-Policy, COOP, HSTS and nosniff on every response, errors and 404s included (P3-I15).
  app.addHook('onRequest', addSecurityHeaders);

  // API answers carry secrets (confirm tokens, recovery codes, TOTP secrets, login challenges) and
  // private account data: never stored by a browser cache or a proxy.
  app.addHook('onRequest', (req, reply, done) => {
    // The raw URL can spell /v1 with percent-escapes (/%761/...); the router decodes them, so the
    // matched route pattern and the decoded path count too.
    let decoded = req.url;
    try {
      decoded = decodeURIComponent(req.url);
    } catch {
      // Undecodable: the framework error path answers it.
    }
    if (req.url.startsWith('/v1/') || decoded.startsWith('/v1/') || req.routeOptions.url?.startsWith('/v1/')) {
      void reply.header('cache-control', 'no-store');
    }
    done();
  });

  // CSRF: before any body is parsed, unsafe methods need an exact configured Origin (Task 4).
  app.addHook('onRequest', originHook);

  // Only JSON bodies: the built-in text/plain parser would let a cross-site form post a JSON body.
  app.removeContentTypeParser('text/plain');

  app.setNotFoundHandler((_req, reply) => {
    void reply.code(404).send({ error: 'not-found' });
  });

  app.setErrorHandler((err: FastifyError | ApiError, req, reply) => {
    if (err instanceof ApiError) {
      const retry = err.extra?.retryAfterSeconds;
      if (typeof retry === 'number') void reply.header('retry-after', String(retry));
      return reply.code(err.status).send({ ...err.extra, error: err.code });
    }
    const status = typeof err.statusCode === 'number' ? err.statusCode : 500;
    if (status === 415) return reply.code(415).send({ error: 'unsupported-media-type' });
    if (status >= 400 && status < 500) return reply.code(status).send({ error: 'bad-request' });
    req.log.error({ req, err }, 'request failed');
    return reply.code(500).send({ error: 'internal' });
  });

  app.get('/healthz', async () => ({ ok: true }));
  logoutRoute(app);
  passwordRoutes(app);
  await pgpRoutes(app);
  totpRoutes(app);
  recoveryRoutes(app);
  methodRoutes(app);
  // Task 11: account overview, sessions, alerts and Terms.
  accountRoutes(app);
  // Task 8: WebAuthn sign-up, confirm, add-key, and the login mount (by login name + discoverable).
  webauthnRoutes(app);
  await app.register(webauthnLoginRoutes, { prefix: '/v1/login/webauthn', kinds: ['trader', 'staff', 'owner'] });
  // Task 12: payout wallets and the 24-hour wait (traders only).
  walletRoutes(app);
  // Plan 3 Task 3: method lists, suggestions and the price (browsing needs no session); the owner's price health.
  methodListRoutes(app);
  offerRoutes(app);
  priceRoutes(app);
  // Plan 3 Task 19: live events (SSE) and generic Web Push subscriptions.
  eventRoutes(app, events, options.events);
  pushRoutes(app);
  // Plan 3, Task 6: the trade view and the participants' events route; Task 19 delivers its events.
  tradeRoutes(app, { publish: options.tradePublish ?? tradeEventPublisher({ events, push: app.push }) });
  // Plan 3 Task 8: a trade's participant identities and the moderation attestation (traders only).
  tradeIdentityRoutes(app);
  // Plan 3, Task 26: nudges, nudge settings and blocks.
  nudgeRoutes(app);
  // Plan 3, Task 24: the released screen's live confirmations from X2F's own node.
  confirmationsRoute(app, options.txConfirmations);
  // Plan 5, Task 21: the feedback form every "can't do that" popup links to.
  feedbackFormRoutes(app);

  return app;
}
