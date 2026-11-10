/**
 * Trader and Vendor accounts (owner, 2 Nov 2026; docs/design-hold-model-2026-11-02.md, board
 * BecomeVendor). A trader (the default) takes offers and pays no fee. A vendor posts offers, may
 * have team members, and pays the 1% fee on completed trades.
 *
 * The fee needs no change of its own: it is the poster's (packages/trade `feeFor`, fixed at take,
 * HANDOFF "Fees: the poster pays the 1%"), and only a vendor can post. A trader's offers from
 * before migration 198 (it could not meet the requirement) keep their poster paying the fee, as
 * before. NEEDS_FEE_BY_ACCOUNT_TYPE: if the owner ever wants the fee keyed to the account type
 * instead of the poster role, `accountTypeOf` is the flag and packages/trade `planTrade` the seam.
 *
 * `PUT /v1/account/type { type: 'vendor', confirmToken }` → `{ accountType: 'vendor' }`. The
 * account holder's full session only (a member gets 403 `owner-only`, a backup session 403
 * `recovery-session`); refused during the 24-hour hold (403 `recovery-hold`, before any token is
 * spent). In one transaction, under the account lock, with the session re-checked:
 * - already a vendor: 200, nothing spent;
 * - no passkey, security key or PGP key on the account: 403 `vendor-needs-key`;
 * - the confirm token for `become-vendor` (403 `confirm-required` / `confirm-invalid`), earned
 *   with a passkey, security key or PGP key (the password route issues none for it; any other
 *   method 403 `method-not-allowed`, and the token is not spent);
 * - then the switch, and alert `became-vendor`.
 * A session strength is not asked for (unlike team invites): the confirm with a passkey, security
 * key or PGP key is the requirement the owner set.
 *
 * There is no switching back to trader (owner answer Q77, 6 Nov 2026: open a new account instead):
 * any `type` but 'vendor' is 400 `bad-request`.
 */
import type { FastifyInstance, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { addAlert } from '../alerts.js';
import { STRONG_CONFIRM_METHODS, redeemConfirm } from '../auth/confirm.js';
import { holdInTx, holdRefusal, requireLiveSessionInTx, requireNotHeld, settleOf, withTx } from '../auth/hold.js';
import { requireSession } from '../auth/sessions.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';

export type AccountType = 'trader' | 'vendor';

/** The account's type ('trader' for any account that is not a vendor, staff and owner included). */
export async function accountTypeOf(db: Queryable, accountId: string): Promise<AccountType> {
  const { rows } = await db.query<{ account_type: AccountType }>('select account_type from accounts where id = $1', [accountId]);
  return rows[0]?.account_type ?? 'trader';
}

/** The vendor requirement: a passkey, security key or PGP key on the account itself. */
export async function hasVendorKey(db: Queryable, accountId: string): Promise<boolean> {
  const { rows } = await db.query<{ ok: boolean }>(
    `select exists (select 1 from pgp_keys where account_id = $1) or exists (select 1 from webauthn_credentials where account_id = $1) as ok`,
    [accountId],
  );
  return rows[0]!.ok;
}

/** 403 `not-vendor` unless the account is a vendor (inside a write's transaction, after its account lock). */
export async function assertVendor(db: Queryable, accountId: string): Promise<void> {
  if ((await accountTypeOf(db, accountId)) !== 'vendor') throw new ApiError(403, 'not-vendor');
}

/**
 * preHandler, before `requireConfirm`: 403 `not-vendor` for a trader account (an unlocked read, so
 * a refusal never spends a confirm token; the write checks again under its lock).
 */
export const requireVendor: preHandlerAsyncHookHandler = async function (req) {
  await assertVendor(req.server.deps.db, req.auth.accountId);
};

const checkType: preHandlerAsyncHookHandler = async function (req: FastifyRequest) {
  const b = req.body;
  if (b === null || typeof b !== 'object' || Array.isArray(b) || (b as { type?: unknown }).type !== 'vendor') throw new ApiError(400, 'bad-request');
};

export function accountTypeRoutes(app: FastifyInstance): void {
  app.put('/v1/account/type', { preHandler: [requireSession({ kinds: ['trader'] }), checkType, requireNotHeld] }, async (req) => {
    const deps = req.server.deps;
    const now = deps.clock();
    const raw = (req.body as { confirmToken?: unknown }).confirmToken;
    const token = raw === undefined ? undefined : typeof raw === 'string' ? raw : '';
    await withTx(deps.db, async (c) => {
      await requireLiveSessionInTx(c, req.auth, now);
      const hold = await holdInTx(c, settleOf(req), req.auth.accountId, now);
      if (hold !== null) throw holdRefusal(hold.holdUntil);
      if ((await accountTypeOf(c, req.auth.accountId)) === 'vendor') return;
      if (!(await hasVendorKey(c, req.auth.accountId))) throw new ApiError(403, 'vendor-needs-key');
      const method = await redeemConfirm({ db: c, clock: deps.clock }, req, { kind: 'become-vendor' }, token);
      if (!STRONG_CONFIRM_METHODS.includes(method)) throw new ApiError(403, 'method-not-allowed');
      await c.query("update accounts set account_type = 'vendor', vendor_since = $2 where id = $1 and account_type = 'trader'", [req.auth.accountId, now]);
      await addAlert(c, req.auth.accountId, 'became-vendor', { method }, now);
    });
    return { accountType: 'vendor' as const };
  });
}
