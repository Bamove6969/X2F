import fastifyCookie from '@fastify/cookie';
import Fastify, { LogController, type FastifyError, type FastifyInstance, type FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { Config } from './config.js';
import { originHook } from './auth/origin.js';
import { passwordRoutes } from './auth/password.js';
import { pgpRoutes, type PgpSigner } from './auth/pgp.js';
import { recoveryRoutes } from './auth/recovery.js';
import { logoutRoute } from './auth/sessions.js';
import { totpRoutes } from './auth/totp.js';
import { ApiError } from './errors.js';
import { newBudgets, type Budgets } from './limits.js';
import { addSecurityHeaders } from './static/serve.js';

// Interface-only stubs, filled in by the task named on each; their shapes follow the plan text.
/** Task 6: the leaked-password list held on X2F's own server. */
export interface LeakedList {
  has(password: string): Promise<boolean>;
}
/** Task 12: Monero payout address check for the configured network. */
export interface AddressValidator {
  check(address: string): 'ok' | 'invalid' | 'integrated';
}
/** Task 8: FIDO metadata snapshot and AAGUID allowlist for staff and owner keys. */
export interface AttestationPolicy {
  init(): Promise<void>;
  isAllowed(aaguid: string, fmt: string): boolean;
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
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Per-app request budgets on `deps.clock` (P2-I8). */
    budgets: Budgets;
    /** The app's dependencies, for hooks that receive only the request (`requireSession`, the origin check). */
    deps: Deps;
  }
}

export interface BuildOptions {
  /** Where log lines go (default stdout); tests capture them. */
  logStream?: { write(line: string): void };
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
  app.decorateRequest('auth', null as never);
  await app.register(fastifyCookie);

  // Referrer-Policy, COOP, HSTS and nosniff on every response, errors and 404s included (P3-I15).
  app.addHook('onRequest', addSecurityHeaders);

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

  return app;
}
