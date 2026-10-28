// TRIPWIRE NEEDS_SPEND_EVIDENCE (Plan 3 Task 9 I/O, lead decision pending). The watcher may count a
// sweep only once the mod's OWN wallet shows it spending the escrow (`Outgoing` from
// `PartyHandle.funds()`): it co-signed it, or holds the key images after an export round. In a
// seller–buyer release the mod takes no part, so its wallet never shows that spend and the trade's
// `settled` is never reported (it stays `settling`). The fix needs a protocol decision (e.g. the
// builder sends the mod its post-release multisig info, or a key-image proof the mod checks), which
// must change `packages/escrow` and the seam `spendEvidence` in apps/moderation/src/watcher.ts.
// When either of those changes, this fails: re-check the seam, then delete or update this tripwire.
// Checks the local tree only.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** The seam's body, from its marker to the end of the function. */
function seam(): string {
  const src = read('../src/watcher.ts');
  const start = src.indexOf('export function spendEvidence(');
  return src.slice(start, src.indexOf('\n}\n', start));
}

describe('a seller-buyer release is not shown to the mod yet', () => {
  it('NEEDS_SPEND_EVIDENCE: the spend evidence is the mod wallet\'s own outgoing txs only, and escrow has no way to show the mod another spend', () => {
    const msg = 'spend evidence changed: re-check the seam and coordination.md (Task 9 I/O), then update NEEDS_SPEND_EVIDENCE';
    expect(read('../src/watcher.ts'), msg).toContain('SEAM(NEEDS_SPEND_EVIDENCE)');
    expect(createHash('sha256').update(seam()).digest('hex').slice(0, 16), msg).toBe(SEAM_HASH);
    expect(read('../../../packages/escrow/src/engine.ts'), msg).not.toMatch(/keyImage|spendProof|importSpend/i);
  });
});

const SEAM_HASH = 'b22efcf77d8ef985';
