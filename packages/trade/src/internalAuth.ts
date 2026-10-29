/**
 * The bytes the moderation key signs for a request to the API's private internal listener
 * (`/internal/v1/*`). Both the moderation service (which signs) and the API (which verifies with
 * MOD_SIGNING_PUBLIC) build the message the same way, so the format lives here once.
 *
 * The signature binds the HTTP method, the request path and a freshness timestamp, plus a hash of
 * the request body so a captured POST cannot be replayed with different contents. The body hash is
 * computed by the caller (hex SHA-256 of the exact body bytes; the empty string's hash for a GET).
 *
 * Pure: TextEncoder only, no Node-only APIs.
 */
const DOMAIN = 'x2f/api-internal/v1\0';

export interface InternalRequest {
  method: string;
  path: string;
  /** Milliseconds since the epoch, on the signer's clock. */
  at: number;
  /** Lower-case hex SHA-256 of the exact request body ('' hashed for a body-less request). */
  bodyHash: string;
}

export const INTERNAL_AT_HEADER = 'x2f-mod-at';
export const INTERNAL_SIG_HEADER = 'x2f-mod-sig';

export function internalSignedBytes(r: InternalRequest): Uint8Array {
  return new TextEncoder().encode(`${DOMAIN}${r.method}\0${r.path}\0${r.at}\0${r.bodyHash}`);
}
