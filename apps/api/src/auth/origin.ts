import type { FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '../errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD']);

/** The request's `Origin` when it is exactly one of `origins` (no prefix, case or slash games); else null. */
function matchOrigin(req: FastifyRequest, origins: readonly string[]): string | null {
  const value = req.headers.origin;
  if (typeof value !== 'string' || value === 'null') return null;
  return origins.includes(value) ? value : null;
}

/**
 * `onRequest` hook (before any body is parsed): every request other than GET and HEAD must carry
 * an `Origin` exactly equal to one of `config.origins`, else 403 `origin-refused`. Together with
 * SameSite=Strict cookies and JSON-only bodies this is the CSRF defence.
 */
export async function originHook(req: FastifyRequest, _reply: FastifyReply): Promise<void> {
  if (SAFE_METHODS.has(req.method)) return;
  if (matchOrigin(req, req.server.deps.config.origins) === null) throw new ApiError(403, 'origin-refused');
}

/** The checked origin of this request (Task 7 uses its host as `siteHost`); 403 `origin-refused` if it fails the check. */
export function requestOrigin(req: FastifyRequest): URL {
  const origin = matchOrigin(req, req.server.deps.config.origins);
  if (origin === null) throw new ApiError(403, 'origin-refused');
  return new URL(origin);
}
