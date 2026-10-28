import { insertPgpKey } from '../../../../apps/api/src/auth/pgp.js';
import { seedAccount } from '../../../../apps/api/test/helpers/accounts.js';
import { genKey, type Pair } from '../../../../apps/api/test/helpers/pgpKeys.js';
import { createSoftAuthenticator, type SoftAuthenticator } from '../../../../apps/api/test/helpers/softAuthenticator.js';
import { uniqueName, type Server } from './server.js';

/** A staff account seeded with an attested security key ("YubiKey") and a PGP key, its two login methods. */
export async function staffWithKeyAndPgp(srv: Server): Promise<{ username: string; soft: SoftAuthenticator; key: Pair }> {
  const username = uniqueName('crew');
  const id = await seedAccount(srv.deps, { loginName: username, kind: 'staff' });
  const soft = createSoftAuthenticator({ backedUp: false, userVerified: true });
  await srv.deps.db.query(
    `insert into webauthn_credentials (account_id, credential_id, public_key, counter, kind, backed_up, device_type, attested, label, created_at)
     values ($1, $2, $3, 0, 'security-key', false, 'singleDevice', true, 'YubiKey', $4)`,
    [id, Buffer.from(soft.credentialId, 'base64url'), soft.cosePublicKey, srv.now()],
  );
  const key = await genKey();
  await insertPgpKey(srv.deps.db, srv.deps.config, { accountId: id, fingerprint: key.fingerprint, armored: key.publicKey, now: srv.now() });
  return { username, soft, key };
}
