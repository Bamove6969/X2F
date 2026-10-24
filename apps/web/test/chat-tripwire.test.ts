// TRIPWIRES for Task 20's wiring (only the pure parts are built: apps/web/src/chat/chatCrypto.ts
// and packages/trade/src/chat.ts). Task 20's routes, migration and panel wait for Task 4's offers
// table and Task 6's trades; the chat's mod identity waits for Task 8's attestation. Each check
// fails once its dependency lands: then build that part against the real module and delete it.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as trade from '@x2f/trade';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const has = (p: string): boolean => existsSync(ROOT + p);

describe('Task 20 wiring still waits for its dependencies', () => {
  it('NEEDS_TASK_4_6: the chat API (106_chat.sql, routes, retention) is not built yet', () => {
    // When building it: POST /v1/chats/:chat/envelopes runs checkChatEnvelope(body, channel,
    // sessionRole) with a 16 KiB bodyLimit (413); the identity route verifies
    // chatIdentityProofBytes; purgeChats follows chatPurgeDue; startRetention (Task 6) calls it.
    expect(has('apps/api/migrations/106_chat.sql')).toBe(false);
    expect(has('apps/api/src/chat/routes.ts')).toBe(false);
    expect(has('apps/api/src/chat/retention.ts')).toBe(false);
  });

  it('NEEDS_TASK_8: the chat mod identity comes from the attestation (channels.chat)', () => {
    // Then: verify the chat attestation (channels.chat === chatChannel(chat)) before the first
    // sealChatMessage, and pass its participants; never participants straight from the API.
    expect(has('packages/trade/src/attestation.ts'), 'Task 8 landed: wire the chat attestation').toBe(false);
    expect('verifyAttestation' in trade).toBe(false);
  });

  it('NEEDS_TASK_12: ChatState and the chat identity are not stored on the device yet', () => {
    // Then: keep the chat identity (wrapped) and ChatState per chat in the device store; save
    // after sealing before posting, and after opening before showing. A second device of the
    // account has no identity: show "This conversation is open on another device" read-only.
    expect(has('apps/web/src/chat/ChatPanel.tsx'), 'ChatPanel landed: wire chatCrypto through the device store').toBe(false);
  });
});
