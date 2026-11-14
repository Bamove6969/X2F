/** DEMO ONLY: the part of door.ts the gateway core needs, without a database client. */
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The pendingId of a password step's JSON answer, or null. */
export function pendingIdOf(body: Buffer): string | null {
  try {
    const j = JSON.parse(body.toString('utf8')) as { status?: unknown; pendingId?: unknown };
    return j.status === 'second-factor' && typeof j.pendingId === 'string' && UUID.test(j.pendingId) ? j.pendingId : null;
  } catch {
    return null;
  }
}

