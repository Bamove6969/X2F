import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { AccountKind } from '@x2f/accounts';
import { loginTag } from '../../src/accounts.js';
import type { Deps } from '../../src/app.js';
import { trustDevice } from '../../src/auth/device.js';
import { subkey } from '../../src/config.js';

/** A login name's tag under the current `X2F_LOGIN_NAME_KEYS` key (or under key `keyId` of the ring). */
export function currentLoginTag(deps: Pick<Deps, 'config'>, loginName: string, keyId = deps.config.loginNameKeys.current): Buffer {
  return loginTag(deps.config.loginNameKeys.keys.get(keyId)!, loginName);
}

/** The id of the account a login name belongs to (looked up by its tag under any key), or undefined. */
export async function accountIdByLoginName(deps: Pick<Deps, 'db' | 'config'>, loginName: string): Promise<string | undefined> {
  const tags = [...deps.config.loginNameKeys.keys.keys()].map((id) => currentLoginTag(deps, loginName, id));
  const { rows } = await deps.db.query<{ id: string }>('select id from accounts where login_tag = any($1::bytea[])', [tags]);
  return rows[0]?.id;
}

/**
 * Inserts an account directly (tests only). `loginName` is the private login name, stored only as
 * its tag (FU-D) under the current key or under `loginKeyId` (null: an account from before
 * migration 009, which logs in by its display name until it sets one: `legacy_login_name`, its tag
 * is its display name's); `displayName` defaults to `D` + the login name (or a random one). A
 * trader gets the current Terms version unless `termsVersion` says otherwise; staff and owner
 * accounts carry none.
 */
export async function seedAccount(
  deps: Pick<Deps, 'db' | 'clock' | 'config'>,
  a: {
    loginName: string | null; displayName?: string; kind?: AccountKind; disabled?: boolean; termsVersion?: string | null; loginKeyId?: number;
  },
): Promise<string> {
  const kind = a.kind ?? 'trader';
  const terms = a.termsVersion !== undefined ? a.termsVersion : kind === 'trader' ? deps.config.termsVersion : null;
  const display = a.displayName ?? (a.loginName !== null ? `D${a.loginName}` : `D${randomBytes(6).toString('hex')}`);
  const keyId = a.loginKeyId ?? deps.config.loginNameKeys.current;
  const now = deps.clock();
  const { rows } = await deps.db.query<{ id: string }>(
    `insert into accounts (display_name, display_key, login_tag, login_tag_key_id, legacy_login_name, kind, webauthn_user_id, terms_version, terms_accepted_at, created_at, disabled_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning id`,
    [
      display, display.toLowerCase(), currentLoginTag(deps, a.loginName ?? display, keyId), keyId, a.loginName === null, kind, randomBytes(32),
      terms, terms === null ? null : now, now, a.disabled ? now : null,
    ],
  );
  return rows[0]!.id;
}

/** The login method recorded on a confirm token when it was issued (tests only). */
export async function confirmTokenMethod(deps: Pick<Deps, 'db'>, token: string): Promise<string | undefined> {
  const { rows } = await deps.db.query<{ method: string }>('select method from confirm_tokens where token_hash = $1', [
    createHash('sha256').update(token).digest(),
  ]);
  return rows[0]?.method;
}

/**
 * A device cookie value already trusted for the account (tests only): hold model v3 lets a
 * password log in with nothing else logged in only on a trusted device (a new one gets 403
 * `approval-unavailable`). Set it as the `__Host-x2f_dev` cookie.
 */
export async function trustedDevice(deps: Pick<Deps, 'db' | 'clock' | 'config'>, accountId: string): Promise<string> {
  const value = randomBytes(32).toString('base64url');
  await trustDevice(deps, accountId, createHmac('sha256', subkey(deps.config, 'device')).update(value).digest());
  return value;
}
