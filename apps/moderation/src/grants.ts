import sodium from 'libsodium-wrappers';
import { normalizeTradeCode } from '@x2f/core';
import { makeGrantAccepted, unwrapChatKey, verifyChatGrant, verifyChatKeyRecord, type Participants } from '@x2f/protocol';
import { channelFor } from '@x2f/trade';
import { loadChatIdentity, type Queryable } from './keystore.js';
import type { ChatGrantItem, Link } from './link.js';

/**
 * Design build task 6 (design-chat-membership-keys-2026-11-08 section 3, T1): the moderation side of
 * a trader's dispute grant. For each grant the API lists as not yet accepted, with its chat's key
 * record, this process checks, on its OWN records:
 * - the chat is one it attested (`signed_chats`), and the channel is that attestation's;
 * - the key record is signed by the attested identity of the trader it names, for that channel;
 * - the grant is signed by the attested identity of the trader it names, for that channel, and its
 *   tkh is the record's;
 * - the grant's wrap opens with the chat's sealed moderator identity to a key whose fingerprint is
 *   that tkh (`unwrapChatKey`).
 * The key is wiped from memory at once; nothing here keeps it. Then it records the acceptance
 * (`mod_chat_grants`) and reports a `chat-grant-accepted` signed with the chat's moderator identity.
 * Anything that fails is logged by reason and not accepted, so the counterparty's app grants instead
 * (T1 by proxy). Nothing in a grant is believed because the API served it.
 * Review F2: a grant that fails for good (its signatures, its wrap, a chat never attested, or, F4,
 * a key other than the one this process already accepted for the chat) is reported back as
 * `chat-grant-refused` naming exactly that grant, so it leaves the API's queue and can never hold an
 * honest grant back.
 */
export async function grantPass(d: { link: Link; db: Queryable; keystoreKey: Uint8Array; now: () => Date; log: (e: { reason: string }) => void }): Promise<string[]> {
  await sodium.ready;
  let items: ChatGrantItem[];
  try {
    items = await d.link.pullChatGrants();
  } catch {
    d.log({ reason: 'chat-grants-unavailable' });
    return [];
  }
  const done: string[] = [];
  /** Review F2: tells the API this one grant is refused (by its side and signature), best effort. */
  const refuse = async (chat: string, raw: unknown, reason: 'bad' | 'wrong-key' | 'unattested' | 'other-key'): Promise<void> => {
    const g = raw as { by?: unknown; sig?: unknown } | null;
    const grantBy = g?.by;
    const grantSig = g?.sig;
    if ((grantBy !== 'buyer' && grantBy !== 'seller') || typeof grantSig !== 'string' || !/^[0-9a-f]{128}$/.test(grantSig)) return;
    try {
      const status = await d.link.postReport({ kind: 'chat-grant-refused', chat, grantBy, grantSig, reason });
      if (status !== 201) d.log({ reason: `chat-grant-refusal-refused-${status}` });
    } catch {
      d.log({ reason: 'chat-grant-refusal-failed' });
    }
  };
  for (const it of items) {
    const chat = typeof it.chat === 'string' ? normalizeTradeCode(it.chat) : null;
    if (chat === null) {
      d.log({ reason: 'bad-chat-grant' });
      continue;
    }
    try {
      const { rows } = await d.db.query<{ attestation: { participants?: Participants; channels?: { chat?: string } } }>('select attestation from signed_chats where chat = $1', [chat]);
      const att = rows[0]?.attestation;
      const channel = await channelFor(chat, 'chat');
      const mod = await loadChatIdentity(d.db, d.keystoreKey, chat);
      if (!att?.participants || att.channels?.chat !== channel || mod === null) {
        d.log({ reason: 'chat-grant-unattested' });
        await refuse(chat, it.grant, 'unattested');
        continue;
      }
      const participants = att.participants;
      let grant;
      try {
        const record = await verifyChatKeyRecord(it.record, { chat: channel, participants });
        grant = await verifyChatGrant(it.grant, { chat: channel, participants });
        if (grant.tkh !== record.tkh) throw new Error('tkh');
      } catch {
        d.log({ reason: 'chat-grant-bad' });
        await refuse(chat, it.grant, 'bad');
        continue;
      }
      // Review F4: one key per chat. A grant of another key than one this process already accepted
      // for the chat is refused, whatever record the API serves with it.
      const { rows: held } = await d.db.query<{ tkh: string }>('select distinct tkh from mod_chat_grants where chat = $1', [chat]);
      if (held.some((h) => h.tkh !== grant.tkh)) {
        d.log({ reason: 'chat-grant-other-key' });
        await refuse(chat, it.grant, 'other-key');
        continue;
      }
      try {
        const tk = await unwrapChatKey({ boxPublic: mod.boxPublic, boxSecret: mod.boxSecret }, grant.wrap, grant.tkh);
        sodium.memzero(tk);
      } catch {
        d.log({ reason: 'chat-grant-wrong-key' });
        await refuse(chat, it.grant, 'wrong-key');
        continue;
      }
      await d.db.query(
        'insert into mod_chat_grants (chat, grant_by, grant_sig, tkh, accepted_at) values ($1, $2, $3, $4, $5) on conflict do nothing',
        [chat, grant.by, grant.sig, grant.tkh, d.now()],
      );
      const accepted = await makeGrantAccepted({ grant, mod });
      const status = await d.link.postReport({ kind: 'chat-grant-accepted', chat, accepted });
      if (status !== 201) {
        d.log({ reason: `chat-grant-report-refused-${status}` });
        continue;
      }
      d.log({ reason: 'chat-grant-accepted' });
      done.push(chat);
    } catch {
      d.log({ reason: 'chat-grant-failed' });
    }
  }
  return done;
}
