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
        continue;
      }
      try {
        const tk = await unwrapChatKey({ boxPublic: mod.boxPublic, boxSecret: mod.boxSecret }, grant.wrap, grant.tkh);
        sodium.memzero(tk);
      } catch {
        d.log({ reason: 'chat-grant-wrong-key' });
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
