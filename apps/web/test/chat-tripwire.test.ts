// TRIPWIRES for Task 20's wiring (only the pure parts are built: apps/web/src/chat/chatCrypto.ts
// and packages/trade/src/chat.ts). Task 20's routes, migration and panel are unblocked: Task 4's
// offers table (102_offers.sql) and Task 6's trades and startRetention exist; the chat's mod identity can now use Task 8's
// attestation; the device store for Task 12. Each check fails once its dependency lands: then
// build that part against the real module and delete it.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const has = (p: string): boolean => existsSync(ROOT + p);

describe('Task 20 wiring still waits for its dependencies', () => {
  it('NEEDS_TASK_20_API: the chat API (106_chat.sql, routes, retention) is not built yet (its offers table is)', () => {
    // When building it (POST /v1/chats { offerId } needs the offers table): the envelopes route
    // runs checkChatEnvelope(body, channel, sessionRole) with a 16 KiB bodyLimit (413); the
    // identity route verifies chatIdentityProofBytes; purgeChats follows chatPurgeDue and is
    // registered with the merged startRetention (apps/api/src/retention.ts).
    // Review I1: the envelopes route refuses a (chat, from, seq) that is not above that sender's
    // last stored seq with 409, backed by a unique index on (chat, from, seq).
    expect(has('apps/api/migrations/106_chat.sql')).toBe(false);
    expect(has('apps/api/src/chat/routes.ts')).toBe(false);
    expect(has('apps/api/src/chat/retention.ts')).toBe(false);
  });

  it('NEEDS_TASK_20_ATTEST: the chat does not verify the chat attestation yet (Task 8 is on the line)', () => {
    // Task 8's verifyAttestation(..., { context: 'chat' }) is in @x2f/trade. Then: verify the chat
    // attestation (channels.chat === chatChannel(chat)) before the first sealChatMessage, and pass
    // its participants; never participants straight from the API. Review M4: apps/moderation
    // verifies chat identities with chatIdentityProofBytes (the x2f/chat-identity/v1 domain), never
    // the trade identity domain. Delete this check when the chat code calls verifyAttestation.
    const chat = readdirSync(`${ROOT}apps/web/src/chat`).map((f) => readFileSync(`${ROOT}apps/web/src/chat/${f}`, 'utf8')).join('\n');
    expect(chat, 'the chat verifies its attestation now: delete this check').not.toMatch(/\bverifyAttestation\b/);
  });

  it('NEEDS_TASK_12: ChatState and the chat identity are not stored on the device yet', () => {
    // Then: keep the chat identity (wrapped) and ChatState per chat in the device store; save
    // after sealing before posting, and after opening before showing. A second device of the
    // account has no identity: show "This conversation is open on another device" read-only.
    // Review I1: ChatPanel opens every pending envelope before sealing, and sends posts one at a
    // time. Review I2: it sets modMayPost only while a dispute is open on the trade. Review M5:
    // it shows "a message is missing" when a sender's seq skips.
    expect(has('apps/web/src/chat/ChatPanel.tsx'), 'ChatPanel landed: wire chatCrypto through the device store').toBe(false);
  });
});
