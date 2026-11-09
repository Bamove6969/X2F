/**
 * `POST /v1/register/name-check { loginName }` → `{ available }` (design real-app review item 6,
 * board SetupUsername: "juniper.oak is available"). The sign-up's live tick for the one private
 * username (the login name; the public display name has its own step and is checked at register).
 *
 * The trade-off (lead job 2026-11-08, reported to the lead): any availability answer is an oracle
 * for whether a private login name exists, which helps a password guesser pick targets. It is bounded,
 * not closed:
 * - per device cookie, `NAME_CHECK_DEVICE_BUCKET` (10 at once, 2 a minute; 429 `slow-down`), taken
 *   first so a device over its pace never spends the site budget. A script that drops its cookie
 *   gets a fresh one each time, so this only paces honest browsers;
 * - site wide, `NAME_CHECK_BUCKET` (30 at once, 10 a minute; 503 `busy`): the real bound on
 *   enumeration, about 14,400 names a day for everyone together. Draining it only turns the tick
 *   off; sign-up still works and `createAccount` still answers a taken name with `names-unavailable`.
 * - no IP address is read or kept (the API keeps none), and the name is never logged or echoed.
 * Every request costs a token before the shape check, so a malformed name probes nothing for free.
 * A name found this way still has its per-name login throttle (R28), so guesses at its password stay
 * paced; what a finder gains is knowing where to aim them.
 */
import { checkLoginName } from '@x2f/accounts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { loginNameAvailable } from '../accounts.js';
import { ApiError } from '../errors.js';
import { deviceHash, ensureDeviceCookie } from './device.js';

const NAME_CHECK_BODY_LIMIT = 1024;

async function nameCheck(req: FastifyRequest, reply: FastifyReply) {
  ensureDeviceCookie(req, reply);
  // The cookie was just minted when missing, so there is always a device to key on.
  req.server.budgets.nameCheckDevice.take(deviceHash(req)!.toString('hex'));
  req.server.budgets.nameCheck.take();
  const b = req.body as Record<string, unknown> | null;
  if (b === null || typeof b !== 'object' || Array.isArray(b) || typeof b.loginName !== 'string') throw new ApiError(400, 'bad-request');
  const r = checkLoginName(b.loginName);
  if (!r.ok) throw new ApiError(400, 'login-name-invalid');
  const deps = req.server.deps;
  return { available: await loginNameAvailable(deps.db, deps.config, r.key) };
}

export function nameCheckRoutes(app: FastifyInstance): void {
  app.post('/v1/register/name-check', { bodyLimit: NAME_CHECK_BODY_LIMIT }, nameCheck);
}
