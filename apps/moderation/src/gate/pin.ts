import { keyCheckCode } from '@x2f/staff';
import type { GateSource } from './registry.js';
import type { GateState } from './store.js';

/**
 * `pin-owner` (Plan 4 Task 13): roots the gate's chain of trust in the owner's keys, outside the
 * API's database. It reads the owner's attested security keys from the database, prints each key's
 * check code, and pins them only when the operator, having compared every code with the ones on the
 * locked owner setup page, types `yes`. It never runs twice: later owner keys come only through
 * `add-owner-key` taps by both pinned keys (`syncRegistry`).
 */
export type PinResult = 'pinned' | 'declined' | 'already-pinned' | 'no-owner-keys';

export async function pinOwner(o: {
  source: Pick<GateSource, 'ownerKeys'>;
  gate: GateState;
  print: (line: string) => void;
  confirm: (question: string) => Promise<string>;
}): Promise<PinResult> {
  if (o.gate.ownerAccountId !== null || o.gate.ownerCreds.length > 0) return 'already-pinned';
  const owner = await o.source.ownerKeys();
  // The owner always keeps two or more attested keys (Global Constraints); fewer means setup is not done.
  if (owner === null || owner.keys.length < 2) return 'no-owner-keys';
  o.print('The owner\'s security keys in the API database. Compare each check code with the locked setup page:');
  owner.keys.forEach((k, i) => o.print(`  ${i + 1}. ${keyCheckCode(k.publicKey)}`));
  const answer = await o.confirm('Type yes if every code matches, anything else to stop: ');
  if (answer.trim() !== 'yes') return 'declined';
  o.gate.ownerAccountId = owner.accountId;
  o.gate.ownerCreds = owner.keys.map((k) => ({ credentialId: k.credentialId, publicKey: Buffer.from(k.publicKey).toString('base64url'), aaguid: k.aaguid }));
  return 'pinned';
}
