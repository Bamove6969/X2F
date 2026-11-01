/**
 * Checks a past-reputation signature (Plan 5 Task 10, "Verification rules (review 2026-10-24)").
 *
 * - The paste is one armored cleartext-signed message, or a detached signature over the issued
 *   text. For cleartext, the text compared is what `openpgp.verify` returns as `data`, and the
 *   paste may hold nothing outside the one signed block (`wrong-text`).
 * - Exactly one signature, by the claimed key: its primary key or a subkey with the sign flag and
 *   a valid, unrevoked, unexpired binding at `now`. Anything else is `wrong-key`.
 * - Verified with `PAST_REP_VERIFY_CONFIG` (RSA 2048 allowed, login's rejected algorithms kept),
 *   `expectSigned: true`, `date: now`; `verified` awaited on every signature (`bad-signature`).
 * - The signed text equals the issued text after `\r\n`→`\n` and trailing-whitespace trimming,
 *   and the signature was made in `[issuedAt − 5 min, now]` (`wrong-text`). openpgp refuses a
 *   signature dated after `now` (`date: now`) as `bad-signature`, so there is no allowance ahead of
 *   the server clock (review round 1 N1; the plan's "+ 5 min" is an open question).
 * - On success, the one verified signature packet re-armored with no armor headers (review round 1
 *   M4: a pasted `Comment:` or `Version:` line is free text and is not kept). It verifies as a
 *   detached signature over the issued text.
 * - A signature carrying a Signer's User ID subpacket (an email, often) is refused
 *   (`bad-signature`): it could not be stored without keeping that user ID (R16). Lead question.
 *
 * Nothing here logs, and nothing it returns holds key material or a user ID.
 */
import { PAST_REP_VERIFY_CONFIG } from '@x2f/accounts';
import * as openpgp from 'openpgp';
import { issuedAtOf } from './challenge.js';

export type PastRepVerifyRefusal = 'bad-signature' | 'wrong-text' | 'wrong-key';
export type PastRepVerifyResult = { ok: true; signature: string } | { ok: false; reason: PastRepVerifyRefusal };

/** How long before `issuedAt` the signature may be dated (a signer's clock running slow). */
export const PAST_REP_CLOCK_SKEW_MS = 5 * 60_000;

const config = PAST_REP_VERIFY_CONFIG;
const refuse = (reason: PastRepVerifyRefusal): PastRepVerifyResult => ({ ok: false, reason });

/** `\r\n`→`\n`, trailing whitespace off every line and off the end. */
export function normalizeSignedText(s: string): string {
  return s.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n').replace(/\s+$/, '');
}

const BEGIN_SIGNED = '-----BEGIN PGP SIGNED MESSAGE-----';
const BEGIN_SIG = '-----BEGIN PGP SIGNATURE-----';
const END_SIG = '-----END PGP SIGNATURE-----';
const count = (s: string, needle: string): number => s.split(needle).length - 1;

/** The armored blocks of the paste: one cleartext message, or one detached signature; else a refusal. */
function shape(paste: string): { kind: 'cleartext' | 'detached'; armored: string } | PastRepVerifyRefusal {
  const p = paste.replace(/\r\n?/g, '\n').trim();
  const begins = count(p, '-----BEGIN PGP ');
  if (count(p, BEGIN_SIGNED) > 0) {
    // One signed block and its one signature, and nothing before or after them.
    if (count(p, BEGIN_SIGNED) !== 1 || count(p, BEGIN_SIG) !== 1 || begins !== 2 || count(p, '-----END PGP ') !== 1) return 'wrong-text';
    if (!p.startsWith(BEGIN_SIGNED) || !p.endsWith(END_SIG)) return 'wrong-text';
    return { kind: 'cleartext', armored: p };
  }
  if (count(p, BEGIN_SIG) > 0) {
    if (begins !== 1 || count(p, '-----END PGP ') !== 1 || !p.startsWith(BEGIN_SIG) || !p.endsWith(END_SIG)) return 'wrong-text';
    return { kind: 'detached', armored: p };
  }
  return 'bad-signature';
}

/** True when the one signature packet's issuer is a key of `key` that may sign at `now`. */
async function byClaimedKey(key: openpgp.Key, sig: openpgp.SignaturePacket, now: Date): Promise<boolean> {
  try {
    const signer = await key.getSigningKey(sig.issuerKeyID, now, undefined, config);
    return signer.getKeyID().equals(sig.issuerKeyID);
  } catch {
    return false;
  }
}

type Verifications = Awaited<ReturnType<typeof openpgp.verify>>['signatures'];

async function allVerified(sigs: Verifications): Promise<boolean> {
  try {
    await Promise.all(sigs.map((s) => s.verified));
    return true;
  } catch {
    return false;
  }
}

/**
 * Accepts an armored cleartext-signed message or a detached signature of `text` (the issued
 * challenge, whose `Issued:` line bounds the signature time), made by `armoredKey` and valid at `now`.
 */
export async function verifyPastRepSignature(signed: string, text: string, armoredKey: string, now: Date): Promise<PastRepVerifyResult> {
  if (typeof signed !== 'string') return refuse('bad-signature');
  const issuedAt = issuedAtOf(text);
  if (issuedAt === null) throw new Error('verifyPastRepSignature: the issued text has no Issued line');
  const s = shape(signed);
  if (typeof s === 'string') return refuse(s);

  let key: openpgp.Key;
  try {
    key = await openpgp.readKey({ armoredKey, config });
  } catch {
    throw new Error('verifyPastRepSignature: the stored key does not parse');
  }

  let packets: openpgp.SignaturePacket[];
  let cleartext: openpgp.CleartextMessage | null = null;
  let detached: openpgp.Signature | null = null;
  try {
    if (s.kind === 'cleartext') {
      cleartext = await openpgp.readCleartextMessage({ cleartextMessage: s.armored, config });
      // `signature` is a public field of CleartextMessage that openpgp's typings leave out.
      packets = [...(cleartext as unknown as { signature: openpgp.Signature }).signature.packets] as openpgp.SignaturePacket[];
    } else {
      detached = await openpgp.readSignature({ armoredSignature: s.armored, config });
      packets = [...detached.packets] as openpgp.SignaturePacket[];
    }
  } catch {
    return refuse('bad-signature');
  }

  // Exactly one signature, by the claimed key (primary, or a signing subkey valid at `now`).
  if (packets.length !== 1) return refuse('wrong-key');
  const packet = packets[0]!;
  if (!(await byClaimedKey(key, packet, now))) return refuse('wrong-key');
  if (packet.signersUserID !== null && packet.signersUserID !== undefined && packet.signersUserID !== '') return refuse('bad-signature');

  const created = packet.created;
  const inWindow = (d: Date | null): boolean =>
    d !== null && d.getTime() >= issuedAt.getTime() - PAST_REP_CLOCK_SKEW_MS && d.getTime() <= now.getTime();
  // Only the one checked packet, re-armored: no armor headers, no cleartext copy (the text is the issued one).
  const canonical = (): string => {
    const list = new openpgp.PacketList<openpgp.SignaturePacket>();
    list.push(packet);
    return new openpgp.Signature(list).armor(config);
  };

  if (cleartext !== null) {
    let result: Awaited<ReturnType<typeof openpgp.verify>>;
    try {
      result = await openpgp.verify({ message: cleartext, verificationKeys: key, expectSigned: true, date: now, config });
    } catch {
      return refuse('bad-signature');
    }
    if (result.signatures.length !== 1 || !(await allVerified(result.signatures))) return refuse('bad-signature');
    if (typeof result.data !== 'string' || normalizeSignedText(result.data) !== normalizeSignedText(text)) return refuse('wrong-text');
    return inWindow(created) ? { ok: true, signature: canonical() } : refuse('wrong-text');
  }

  // Detached: the signer's file may end in a line break or use CRLF; each form of the issued text is
  // tried (a text-mode signature already ignores the line-end style).
  const base = normalizeSignedText(text);
  for (const candidate of [base, `${base}\n`, base.replace(/\n/g, '\r\n'), `${base.replace(/\n/g, '\r\n')}\r\n`]) {
    try {
      const message = await openpgp.createMessage({ text: candidate });
      const result = await openpgp.verify({ message, signature: detached!, verificationKeys: key, expectSigned: true, date: now, config });
      if (result.signatures.length === 1 && (await allVerified(result.signatures))) return inWindow(created) ? { ok: true, signature: canonical() } : refuse('wrong-text');
    } catch {
      // try the next form
    }
  }
  // A good signature by the claimed key over some other text, or a broken one: either way not this text.
  return refuse('wrong-text');
}
