/**
 * The m-2 blocking fix (owner's demo notes, 13 Nov 2026: swiping Back from the recovery-code step
 * left sign-up and reached the app without the code being saved). From the moment this tab's
 * sign-up makes the account until the recovery code is saved, a small marker in sessionStorage
 * remembers it, so leaving `/setup` (Back, a typed address, a reload) leads back to the
 * recovery-code step. It holds only the public Trade Tag and the ticked methods: never the
 * code, the login name or anything secret. Storage that fails or is blocked simply holds nothing.
 */
import { SIGNUP_ORDER, type LoginMethod, type SignupMethod } from './kit.js';

const KEY = 'x2f.signup.backup-pending';

export interface PendingSignup {
  tradeTag: string;
  method: LoginMethod;
  methods: SignupMethod[];
  done: SignupMethod[];
}

const isMethod = (m: unknown): m is SignupMethod => typeof m === 'string' && (SIGNUP_ORDER as readonly string[]).includes(m);

export function readPendingSignup(): PendingSignup | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw === null) return null;
    const v = JSON.parse(raw) as Partial<PendingSignup>;
    if (typeof v.tradeTag !== 'string' || !isMethod(v.method) || (v.method as SignupMethod) === 'totp') return null;
    if (!Array.isArray(v.methods) || !v.methods.every(isMethod) || !Array.isArray(v.done) || !v.done.every(isMethod)) return null;
    return { tradeTag: v.tradeTag, method: v.method, methods: v.methods, done: v.done };
  } catch {
    return null;
  }
}

export function writePendingSignup(p: PendingSignup): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Blocked storage: the in-flow gate (`needsBackup`) still holds while the flow is open.
  }
}

export function clearPendingSignup(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

/**
 * Where a signed-in page should send this tab instead, or null: the recovery-code step while this
 * tab's own sign-up (same Trade Tag) still owes it, on any path outside `/setup`.
 */
export function backupRedirect(pathname: string, me: { tradeTag?: string } | null): string | null {
  if (me === null || pathname === '/setup' || pathname.startsWith('/setup/')) return null;
  const p = readPendingSignup();
  if (p === null || p.tradeTag !== (me.tradeTag ?? '')) return null;
  return '/setup/backup';
}
