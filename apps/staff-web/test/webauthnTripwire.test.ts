// Re-verify round 3 (X2, X3; lead call 12 Nov 2026): every WebAuthn ceremony on the staff site
// signs a challenge the staff site derives itself, in its own domain, so a compromised API can
// never get a login or a setup assertion that is also a tap. This pins where each one may live.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const files = readdirSync(SRC, { recursive: true, withFileTypes: true })
  .filter((e) => e.isFile() && /\.(tsx?|jsx?)$/.test(e.name))
  .map((e) => ({ path: join(e.parentPath, e.name).slice(SRC.length).replaceAll('\\', '/'), text: readFileSync(join(e.parentPath, e.name), 'utf8') }));
const uses = (re: RegExp) => files.filter((f) => re.test(f.text)).map((f) => f.path).sort();

/**
 * X3: the screens that open KeyTapDialog. Each one builds its intent from what the person typed or
 * sees, computes the intent's hashes itself (tokenHash, reasonSha256, evidenceSha256,
 * publicKeySha256) and shows names next to ids, with a test of its own. A new caller is added here
 * only together with that test (docs/coordination.md, mod-gate merge requirement).
 */
// Plan 4 Task 17 (test/ownerPages.test.tsx): StaffList makes the invite token and hashes it itself
// (inviteTokenHash) and names the person next to each account id; StaffOverview's stop and resume
// carry no id; StaffSettings signs the numbers the fields show.
// Review p4t22 m2: NewsEditor taps the owner's key to publish (news-publish).
// Review p4t22 N2: PlannedMaintenance taps `maintenance-planned`, its start, end and message built from the fields (ownerPages.test.tsx).
// Spec 6.6 "Settings" (test/settingsSections.test.tsx): StarterLimitsSection signs the seven numbers the
// fields show, FeeSweepSection the threshold, float and cold address as typed (each labelled); MySecurity
// (test/mySecurity.test.tsx) signs the method it removes by its listed id, and a PGP key by the
// fingerprint it shows before the tap (the owner taps both keys, owner G4).
const KEY_TAP_CALLERS: string[] = [
  'screens/AccountActions.tsx', 'screens/LimitRecommendations.tsx', 'screens/ModCase.tsx', 'screens/MySecurity.tsx', 'screens/NewsEditor.tsx', 'screens/PlannedMaintenance.tsx', 'screens/StaffGrants.tsx',
  'screens/StaffList.tsx', 'screens/StaffOverview.tsx', 'screens/StaffSettings.tsx', 'screens/settings/FeeSweepSection.tsx', 'screens/settings/StaffPaySection.tsx', 'screens/settings/StarterLimitsSection.tsx',
  'ui/ClockOut.tsx', 'ui/DeviceCard.tsx',
];
// Chat membership design task 8: DeviceCard taps `certify-device` with every signed field labelled (X3).
// Plan 4 Task 26: LimitRecommendations taps `account-limit` (approve or decline), every field shown; reviewed in
// comms review-lead-p4t26-limits-2026-11-20.md (tap binding, rounds 1-3).
// Spec 6.6 account actions (wip/lead-staff-actions, for its security review): AccountActions taps
// `ban-account` (account, ban id, kind, rule and end labelled) and `lift-ban` (account, ban id).

describe('WebAuthn on the staff site (re-verify X2, X3)', () => {
  it('startAuthentication only in KeyTapDialog (the checked tap) and Login (the derived login challenge)', () => {
    expect(uses(/\bstartAuthentication\s*\(/)).toEqual(['screens/Login.tsx', 'ui/KeyTapDialog.tsx']);
    // Login's challenge is challenges.ts loginOptions: staffLoginChallenge(loginNonce), never the server's.
    expect(files.find((f) => f.path === 'screens/Login.tsx')!.text).toMatch(/startAuthentication\(\{ optionsJSON: loginOptions\(/);
    expect(files.find((f) => f.path === 'challenges.ts')!.text).toMatch(/staffLoginChallenge\(/);
  });

  it('startRegistration only in Invite (the invite token\'s challenge) and OwnerSetup (the derived setup challenge)', () => {
    expect(uses(/\bstartRegistration\s*\(/)).toEqual(['screens/Invite.tsx', 'screens/OwnerSetup.tsx']);
    expect(files.find((f) => f.path === 'screens/Invite.tsx')!.text).toMatch(/startRegistration\(\{ optionsJSON: inviteOptions\(/);
    expect(files.find((f) => f.path === 'screens/OwnerSetup.tsx')!.text).toMatch(/startRegistration\(\{ optionsJSON: setupOptions\(/);
    const c = files.find((f) => f.path === 'challenges.ts')!.text;
    expect(c).toMatch(/inviteRegistrationChallenge\(inviteTokenHash\(token\)\)/);
    expect(c).toMatch(/ownerSetupChallenge\(/);
  });

  it('nothing on the staff site touches navigator.credentials directly (round 4)', () => {
    expect(uses(/\bcredentials\s*\.\s*(get|create)\b|navigator\s*(\.|\[)\s*['"`]?credentials/)).toEqual([]);
  });

  it('@simplewebauthn/browser is imported only by name, and only in the five allowed files (round 4)', () => {
    expect(uses(/@simplewebauthn\/browser/)).toEqual(['api.ts', 'screens/Invite.tsx', 'screens/Login.tsx', 'screens/OwnerSetup.tsx', 'ui/KeyTapDialog.tsx']);
    const allowed: Record<string, RegExp> = {
      'api.ts': /^import type \{[\w\s,]+\} from '@simplewebauthn\/browser';$/m,
      'screens/Invite.tsx': /^import \{ startRegistration \} from '@simplewebauthn\/browser';$/m,
      'screens/OwnerSetup.tsx': /^import \{ startRegistration \} from '@simplewebauthn\/browser';$/m,
      'screens/Login.tsx': /^import \{ startAuthentication \} from '@simplewebauthn\/browser';$/m,
      'ui/KeyTapDialog.tsx': /^import \{ startAuthentication \} from '@simplewebauthn\/browser';$/m,
    };
    for (const f of files.filter((x) => /@simplewebauthn\/browser/.test(x.text))) {
      // Exactly one mention, and it is the allowed named import (no namespace, default or dynamic import, no re-export).
      expect(f.text.match(/@simplewebauthn\/browser/g), f.path).toHaveLength(1);
      expect(f.text, f.path).toMatch(allowed[f.path]!);
    }
  });

  it('tapStart is called only from KeyTapDialog', () => {
    expect(uses(/\btapStart\s*\(/).filter((p) => p !== 'api.ts')).toEqual(['ui/KeyTapDialog.tsx']);
  });

  it('KeyTapDialog is opened only by the reviewed callers (X3)', () => {
    expect(uses(/<KeyTapDialog\b/)).toEqual(KEY_TAP_CALLERS);
  });
});
