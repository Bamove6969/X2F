// Owner rule p5-7: the choke point for Jabber account-change notices (migration 331). Every table
// in CHANGE_TABLES queues one notice per changing transaction; nothing else does; and the list is
// complete against the live schema, so a new account table or column fails here until classified.
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CHANGE_TABLES, NOT_ACCOUNT_CHANGES } from '../src/jabber/changePaths.js';
import { testDb } from './helpers/db.js';

let db: pg.Pool;
beforeAll(async () => {
  db = await testDb();
});
afterAll(async () => {
  await db.end();
});

let n = 0;
async function account(kind = 'trader'): Promise<string> {
  n++;
  const { rows } = await db.query<{ id: string }>(
    `insert into accounts (display_name, display_key, kind, webauthn_user_id, created_at)
     values ($1, lower($1), $2, $3, now()) returning id`,
    [`Path${n}x${randomBytes(3).toString('hex')}`, kind, randomBytes(16)],
  );
  return rows[0]!.id;
}

const SEALED = Buffer.from('01aa', 'hex');
async function withJabber(accountId: string, enabled = true): Promise<void> {
  await db.query('insert into jabber_contacts (account_id, jid_sealed, verified_at, enabled) values ($1, $2, now(), $3)', [accountId, SEALED, enabled]);
}
async function notices(accountId: string): Promise<number> {
  return (await db.query<{ n: number }>('select count(*)::int as n from jabber_outbox where account_id = $1', [accountId])).rows[0]!.n;
}

const hex40 = () => randomBytes(20).toString('hex');

/** One representative row per change table: its insert, an update of a change column, a bookkeeping-only update (if any). */
const FIXTURES: Record<string, { insert: string; change: string; bookkeeping?: string; where: string }> = {
  passwords: {
    insert: `insert into passwords (account_id, hash, updated_at) values ($1, 'h', now())`,
    change: `update passwords set updated_at = now() + interval '1 s', hash = 'h2' where account_id = $1`,
    bookkeeping: `update passwords set hash = 'h3', pepper_id = 2 where account_id = $1`,
    where: 'account_id = $1',
  },
  totp: {
    insert: `insert into totp (account_id, secret_enc, created_at) values ($1, '\\x01', now())`,
    change: `update totp set created_at = now() + interval '1 s' where account_id = $1`,
    bookkeeping: `update totp set last_step = 99, secret_enc = '\\x02' where account_id = $1`,
    where: 'account_id = $1',
  },
  recovery_codes: {
    insert: `insert into recovery_codes (account_id, code_hash) select $1, gen_random_uuid()::text::bytea from generate_series(1, 3)`,
    change: `update recovery_codes set key_id = 2 where account_id = $1`,
    bookkeeping: `update recovery_codes set used_at = now() where account_id = $1`,
    where: 'account_id = $1',
  },
  webauthn_credentials: {
    insert: `insert into webauthn_credentials (account_id, credential_id, public_key, counter, kind, backed_up, device_type, label, created_at)
             values ($1, gen_random_uuid()::text::bytea, '\\x01', 0, 'passkey', false, 'singleDevice', 'Phone', now())`,
    change: `update webauthn_credentials set label = 'Laptop' where account_id = $1`,
    bookkeeping: `update webauthn_credentials set counter = 5, last_used_at = now() where account_id = $1`,
    where: 'account_id = $1',
  },
  pgp_keys: {
    insert: `insert into pgp_keys (account_id, fingerprint, armored_enc, created_at) values ($1, '${hex40()}', '\\x01', now())`,
    change: `update pgp_keys set created_at = now() + interval '1 s' where account_id = $1`,
    bookkeeping: `update pgp_keys set armored_enc = '\\x02', last_used_at = now() where account_id = $1`,
    where: 'account_id = $1',
  },
  wallets: {
    insert: `insert into wallets (account_id, app, label, address, created_at, usable_from) values ($1, 'feather', 'Main', gen_random_uuid()::text, now(), now())`,
    change: `update wallets set removed_at = now() where account_id = $1`,
    bookkeeping: `update wallets set address = null where account_id = $1`,
    where: 'account_id = $1',
  },
  team_members: {
    insert: `insert into team_members (account_id, display_name, display_key, roles, invite_expires_at, created_at) values ($1, 'Mate', 'mate', '{offers}', now(), now())`,
    change: `update team_members set roles = '{offers,trades}' where account_id = $1`,
    where: 'account_id = $1',
  },
  account_holds: {
    insert: `insert into account_holds (account_id, started_at, hold_until, reason, started_methods) values ($1, now(), now() + interval '1 day', 'weak-change', '{}')`,
    change: `update account_holds set hold_until = now() + interval '2 days' where account_id = $1`,
    where: 'account_id = $1',
  },
  trading_holds: {
    insert: `insert into trading_holds (account_id, created_at) values ($1, now())`,
    change: `update trading_holds set lifted_at = now() + interval '1 s' where account_id = $1`,
    where: 'account_id = $1',
  },
  nudge_settings: {
    insert: `insert into nudge_settings (account_id) values ($1)`,
    change: `update nudge_settings set enabled = false where account_id = $1`,
    where: 'account_id = $1',
  },
  account_blocks: {
    insert: `insert into account_blocks (account_id, blocked_id, created_at) values ($1, $2, now())`,
    change: `update account_blocks set created_at = now() + interval '1 s' where account_id = $1`,
    where: 'account_id = $1',
  },
  banned_identifiers: {
    insert: `insert into banned_identifiers (kind, tag_key_id, tag, account_id, banned_at) values ('display-name', 1, decode('${randomBytes(32).toString('hex')}', 'hex'), $1, now())`,
    change: `update banned_identifiers set banned_at = now() + interval '1 s' where account_id = $1`,
    where: 'account_id = $1',
  },
  past_reputation: {
    insert: `insert into past_reputation (account_id, site, evidence_url, claimed_trades, fingerprint, key_enc, challenge_text, signature_enc, status, created_at)
             values ($1, 'Bisq', 'https://archive.ph/x', 3, '${hex40()}', '\\x01', 't', '\\x01', 'signed', now())`,
    change: `update past_reputation set status = 'removed' where account_id = $1`,
    where: 'account_id = $1',
  },
};

describe('the change paths are complete against the schema', () => {
  it('every jabber_note_change trigger is a CHANGE_TABLES entry, with the same account column, bookkeeping columns and operations', async () => {
    const { rows } = await db.query<{ table: string; def: string; ins: boolean; upd: boolean; del: boolean }>(
      `select c.relname as table, pg_get_triggerdef(t.oid) as def,
              (t.tgtype & 4) <> 0 as ins, (t.tgtype & 16) <> 0 as upd, (t.tgtype & 8) <> 0 as del
         from pg_trigger t join pg_class c on c.oid = t.tgrelid
        where t.tgname = 'jabber_note_change' and not t.tgisinternal
        order by c.relname`,
    );
    const argsOf = (def: string) => [...(/jabber_note_change\((.*)\)\s*$/.exec(def)?.[1] ?? '').matchAll(/'([^']*)'/g)].map((m) => m[1]!);
    const fromDb = Object.fromEntries(rows.map((r) => {
      const args = argsOf(r.def);
      return [r.table, {
        accountColumn: args[0], bookkeeping: args.slice(1).sort(),
        ops: [r.ins && 'insert', r.upd && 'update', r.del && 'delete'].filter(Boolean),
      }];
    }));
    const listed = Object.fromEntries(CHANGE_TABLES.map((t) => [t.table, {
      accountColumn: t.accountColumn, bookkeeping: Object.keys(t.bookkeeping).sort(), ops: [...t.ops],
    }]));
    expect(fromDb).toEqual(listed);
  });

  it('every column of a change table is classified: a change or bookkeeping (a new column fails here until decided)', async () => {
    for (const t of CHANGE_TABLES) {
      const { rows } = await db.query<{ column_name: string }>(
        `select column_name from information_schema.columns where table_schema = 'public' and table_name = $1`, [t.table],
      );
      const classified = [...t.changes, ...Object.keys(t.bookkeeping)];
      expect(new Set(classified).size, `${t.table} lists a column twice`).toBe(classified.length);
      expect(rows.map((r) => r.column_name).sort(), t.table).toEqual(classified.sort());
    }
  });

  it('every column that refers to an account is a change path or listed in NOT_ACCOUNT_CHANGES with its reason', async () => {
    const { rows } = await db.query<{ ref: string }>(
      `select distinct cl.relname || '.' || att.attname as ref
         from pg_constraint con
         join pg_class cl on cl.oid = con.conrelid
         join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
        where con.contype = 'f' and con.confrelid = 'accounts'::regclass and cl.relname <> 'jabber_contacts'`,
    );
    const paths = CHANGE_TABLES.filter((t) => t.table !== 'accounts').map((t) => `${t.table}.${t.accountColumn}`);
    const classified = [...paths, ...Object.keys(NOT_ACCOUNT_CHANGES)];
    expect(new Set(classified).size, 'listed twice').toBe(classified.length);
    // Both ways: a new reference fails until classified, and a listed one must still exist.
    expect(rows.map((r) => r.ref).sort()).toEqual(classified.sort());
    for (const reason of Object.values(NOT_ACCOUNT_CHANGES)) expect(reason.length).toBeGreaterThan(10);
  });

  it('every change table has a fixture below (so each path is exercised)', () => {
    expect(Object.keys(FIXTURES).sort()).toEqual(CHANGE_TABLES.map((t) => t.table).filter((t) => t !== 'accounts').sort());
  });
});

describe('each change path queues exactly one notice per transaction', () => {
  for (const [table, f] of Object.entries(FIXTURES)) {
    it(`${table}: insert, change and delete each queue one notice; bookkeeping queues none`, async () => {
      const a = await account();
      const other = await account();
      await withJabber(a);
      await db.query(f.insert, f.insert.includes('$2') ? [a, other] : [a]);
      expect(await notices(a), 'insert').toBe(1);
      await db.query(f.change, [a]);
      expect(await notices(a), 'change').toBe(2);
      if (f.bookkeeping) {
        await db.query(f.bookkeeping, [a]);
        expect(await notices(a), 'bookkeeping').toBe(2);
      }
      await db.query(`delete from ${table} where ${f.where}`, [a]);
      expect(await notices(a), 'delete').toBe(3);
      // The other account named in the row (the blocked person) is never told.
      await withJabber(other);
      await db.query(f.insert, f.insert.includes('$2') ? [a, other] : [a]);
      expect(await notices(other)).toBe(0);
    });
  }

  it('accounts: a settings change queues one; login bookkeeping (tag rotation, had_wallet) queues none', async () => {
    const a = await account();
    await withJabber(a);
    await db.query('update accounts set had_wallet = true, login_tag = $2, login_tag_key_id = 2 where id = $1', [a, randomBytes(32)]);
    expect(await notices(a)).toBe(0);
    await db.query('update accounts set last_login_at = now(), terms_signature = $2 where id = $1', [a, randomBytes(16)]);
    expect(await notices(a), 'last_login_at and terms_signature are bookkeeping (lead default, p11-119)').toBe(0);
    await db.query('update accounts set one_device = true where id = $1', [a]);
    expect(await notices(a)).toBe(1);
    await db.query('update accounts set idle_reminder_minutes = 15 where id = $1', [a]);
    await db.query('update accounts set disabled_at = now() where id = $1', [a]);
    expect(await notices(a)).toBe(3);
  });

  it('several writes in one transaction queue one notice; a rolled-back change queues none', async () => {
    const a = await account();
    await withJabber(a);
    const c = await db.connect();
    try {
      await c.query('begin');
      await c.query('update accounts set one_device = true where id = $1', [a]);
      await c.query(`insert into passwords (account_id, hash, updated_at) values ($1, 'h', now())`, [a]);
      await c.query('commit');
      await c.query('begin');
      await c.query('update accounts set idle_reminder_minutes = 30 where id = $1', [a]);
      await c.query('rollback');
    } finally {
      c.release();
    }
    expect(await notices(a)).toBe(1);
  });

  it('nothing is queued without a proven, switched-on Jabber address', async () => {
    const none = await account();
    await db.query('update accounts set one_device = true where id = $1', [none]);
    const off = await account();
    await withJabber(off, false);
    await db.query('update accounts set one_device = true where id = $1', [off]);
    const pending = await account();
    await db.query(`insert into jabber_contacts (account_id, pending_sealed, pending_code_hash, pending_expires_at) values ($1, '\\x01', '\\x01', now())`, [pending]);
    await db.query('update accounts set one_device = true where id = $1', [pending]);
    expect([await notices(none), await notices(off), await notices(pending)]).toEqual([0, 0, 0]);
  });

  it("a team member's login account changing notifies the team account", async () => {
    const team = await account();
    const member = await account('member');
    await db.query(
      `insert into team_members (account_id, display_name, display_key, roles, invite_expires_at, member_account_id, joined_at, created_at)
       values ($1, 'Mate', 'mate', '{offers}', now(), $2, now(), now())`,
      [team, member],
    );
    await withJabber(team);
    await db.query(`insert into pgp_keys (account_id, fingerprint, armored_enc, created_at) values ($1, '${hex40()}', '\\x01', now())`, [member]);
    expect(await notices(team)).toBe(1);
  });
});

describe('the Jabber setting itself', () => {
  let a: string;
  beforeEach(async () => {
    a = await account();
    await withJabber(a);
  });
  const sealedQueued = async () =>
    (await db.query<{ jid_sealed: Buffer }>('select jid_sealed from jabber_outbox where account_id = $1 order by id', [a])).rows.map((r) => r.jid_sealed.toString('hex'));

  it('switching it off tells the address that was on', async () => {
    await db.query('update jabber_contacts set enabled = false where account_id = $1', [a]);
    expect(await sealedQueued()).toEqual(['01aa']);
  });

  it('deleting it tells the address that was on', async () => {
    await db.query('delete from jabber_contacts where account_id = $1', [a]);
    expect(await sealedQueued()).toEqual(['01aa']);
  });

  it('proving a new address tells the old one', async () => {
    await db.query(`update jabber_contacts set jid_sealed = '\\x01bb' where account_id = $1`, [a]);
    expect(await sealedQueued()).toEqual(['01aa']);
  });

  it('sending a test code, a wrong code and the last-sent time are not changes', async () => {
    await db.query(
      `update jabber_contacts set pending_sealed = '\\x01', pending_code_hash = '\\x01', pending_expires_at = now(), pending_sent_at = now() where account_id = $1`, [a],
    );
    await db.query('update jabber_contacts set pending_tries = 1, last_sent_at = now() where account_id = $1', [a]);
    expect(await notices(a)).toBe(0);
  });

  it("deleting the account itself still succeeds (the outbox has no foreign key)", async () => {
    await db.query('delete from accounts where id = $1', [a]);
    expect(await notices(a)).toBe(1);
  });
});
