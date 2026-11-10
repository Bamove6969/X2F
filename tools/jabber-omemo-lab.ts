/**
 * Lab driver for the Jabber OMEMO sender (docs/jabber/omemo-interop-2026-11-10.md). NOT part of
 * the API, not run by any test: it points the production `xmppSender` and the production encryptor
 * (`omemoEncryptorFrom`, what `omemoEncryptor` builds from the database rows) at a local XMPP server
 * so that a real OMEMO 0.3 client that is not ours can receive what X2F sends.
 *
 * What differs from production, and only this: (1) the SOCKS5 proxy is a loopback passthrough in
 * this process instead of Tor (the sender still speaks SOCKS5 and hands the proxy the host name);
 * (2) the TLS trust anchor is the lab CA (`X2F_LAB_CA`), as the tests do; (3) X2F's identity seed
 * and bundle live in a JSON file (`X2F_LAB_IDENTITY`) instead of the sealed `jabber_omemo_identity`
 * row. The wire protocol, the stanzas and the cryptography are the production code, untouched.
 *
 *   X2F_XMPP_JID=x2f-alerts@x2f.lab X2F_XMPP_PASSWORD=... X2F_XMPP_HOST=x2f.lab X2F_XMPP_PORT=5223 \
 *   X2F_LAB_TARGET=127.0.0.1:5223 X2F_LAB_CA=ca.crt X2F_LAB_IDENTITY=x2f-identity.json \
 *     npx tsx tools/jabber-omemo-lab.ts send --to mira@x2f.lab --kind account-change [--count 3] [--ledger] [--save-element f] [--log f]
 *     npx tsx tools/jabber-omemo-lab.ts replay --to mira@x2f.lab --element f      (the same <encrypted> element again)
 *     npx tsx tools/jabber-omemo-lab.ts bad-bundle --device-id 12 --out f           (a bundle that verifies but cannot be agreed with)
 *     npx tsx tools/jabber-omemo-lab.ts identity                                    (our device id and public identity key)
 *
 * Records carry public data only: device ids, key ids, the public base key, lengths. Never a private key.
 */
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { connect as tcpConnect, createServer, type AddressInfo, type Socket } from 'node:net';
import {
  OmemoDevice, PreKeyLedger, generateBundleSecrets, identityFromSeed, newIdentitySeed, parseBundleSecrets, parseEncryptedElement, parsePreKeyMessage,
  serializeBundleSecrets, wireKey, type BundleSecrets, type SeedIdentity,
} from '@x2f/omemo';
import { omemoEncryptorFrom, type OmemoEncryptor } from '../apps/api/src/jabber/omemo.js';
import type { JabberMessage } from '../apps/api/src/jabber/sender.js';
import { xmppSender } from '../apps/api/src/jabber/xmpp.js';

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1] !== undefined) return process.argv[i + 1]!;
  if (fallback !== undefined) return fallback;
  throw new Error(`missing --${name}`);
}
const flag = (name: string) => process.argv.includes(`--${name}`);
const env = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`missing ${name}`);
  return v;
};

/** A loopback SOCKS5 passthrough (RFC 1928, CONNECT, no auth): what stands in for Tor in the lab. */
async function socksPassthrough(targetHost: string, targetPort: number): Promise<{ port: number; close: () => void; seen: string[] }> {
  const seen: string[] = [];
  const sockets: Socket[] = [];
  const server = createServer((client) => {
    sockets.push(client);
    client.on('error', () => undefined);
    let buf = Buffer.alloc(0);
    let stage: 'greeting' | 'request' | 'piped' = 'greeting';
    client.on('data', (d: Buffer) => {
      if (stage === 'piped') return;
      buf = Buffer.concat([buf, d]);
      if (stage === 'greeting') {
        if (buf.length < 2 || buf.length < 2 + buf[1]!) return;
        buf = buf.subarray(2 + buf[1]!);
        stage = 'request';
        client.write(Buffer.from([5, 0]));
      }
      if (stage === 'request') {
        if (buf.length < 5) return;
        const atyp = buf[3]!;
        const hostLen = atyp === 3 ? 1 + buf[4]! : atyp === 1 ? 4 : 16;
        if (buf.length < 4 + hostLen + 2) return;
        const host = atyp === 3 ? buf.subarray(5, 5 + buf[4]!).toString('latin1') : buf.subarray(4, 4 + hostLen).toString('hex');
        seen.push(`atyp=${atyp} host=${host} port=${buf.readUInt16BE(4 + hostLen)}`);
        const rest = buf.subarray(4 + hostLen + 2);
        stage = 'piped';
        const upstream = tcpConnect(targetPort, targetHost, () => {
          client.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
          if (rest.length > 0) upstream.write(rest);
          client.pipe(upstream);
          upstream.pipe(client);
        });
        sockets.push(upstream);
        upstream.on('error', () => client.destroy());
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: (server.address() as AddressInfo).port,
    seen,
    close: () => {
      for (const s of sockets) s.destroy();
      server.close();
    },
  };
}

interface LabIdentity {
  deviceId: number;
  identity: SeedIdentity;
  bundle: BundleSecrets;
}

/** X2F's lab identity: created once, kept in a JSON file so the published keys are stable across runs (as the sealed row is). */
function loadIdentity(path: string): LabIdentity {
  if (!existsSync(path)) {
    const seed = newIdentitySeed();
    const id = identityFromSeed(seed);
    const bundle = generateBundleSecrets(id);
    writeFileSync(path, JSON.stringify({
      deviceId: Math.floor(Math.random() * 0x7ffffffe) + 1, seed: Buffer.from(seed).toString('hex'), bundle: serializeBundleSecrets(bundle).toString('base64'),
    }), { mode: 0o600 });
  }
  const j = JSON.parse(readFileSync(path, 'utf8')) as { deviceId: number; seed: string; bundle: string };
  const identity = identityFromSeed(Buffer.from(j.seed, 'hex'));
  return { deviceId: j.deviceId, identity, bundle: parseBundleSecrets(Buffer.from(j.bundle, 'base64'), identity.privateKey) };
}

/** Public facts about an `<encrypted>` element, for the record. */
function describe(element: string) {
  const e = parseEncryptedElement(element);
  return {
    sid: e.sid, ivBytes: e.iv.length, payloadBytes: e.payload?.length ?? null,
    keys: e.keys.map((k) => {
      if (!k.prekey) return { rid: k.rid, prekey: false, bytes: k.data.length };
      const m = parsePreKeyMessage(k.data);
      return {
        rid: k.rid, prekey: true, bytes: k.data.length, registrationId: m.registrationId, preKeyId: m.preKeyId ?? null, signedPreKeyId: m.signedPreKeyId,
        baseKey: Buffer.from(m.baseKey).toString('base64'), innerBytes: m.message.length,
      };
    }),
  };
}

const record = (file: string | undefined, rec: Record<string, unknown>) => {
  const line = JSON.stringify({ t: Date.now() / 1000, ...rec });
  console.log(line);
  if (file) appendFileSync(file, `${line}\n`);
};

async function main(): Promise<void> {
  const cmd = process.argv[2];
  if (cmd === 'bad-bundle') {
    // Signature verifies (the sender's parseBundle takes it); every prekey is u = 0, which OpenSSL's X25519 refuses (review L2).
    const d = new OmemoDevice(Number(arg('device-id')), 3);
    const zero = wireKey(Buffer.alloc(32)).toString('base64');
    const xml = d.bundleXml().replace(/<preKeyPublic preKeyId='(\d+)'>[^<]*<\/preKeyPublic>/g, (_, id: string) => `<preKeyPublic preKeyId='${id}'>${zero}</preKeyPublic>`);
    writeFileSync(arg('out'), xml);
    console.log(`wrote ${arg('out')} (device ${d.deviceId}, 3 all-zero prekeys)`);
    return;
  }
  const lab = loadIdentity(env('X2F_LAB_IDENTITY'));
  if (cmd === 'identity') {
    console.log(JSON.stringify({ deviceId: lab.deviceId, identityKey: wireKey(lab.identity.publicKey).toString('base64'), signedPreKeyId: lab.bundle.signedPreKeyId, preKeys: lab.bundle.preKeys.length }));
    return;
  }
  if (cmd !== 'send' && cmd !== 'replay') throw new Error('usage: send | replay | bad-bundle | identity');

  const [targetHost, targetPort] = env('X2F_LAB_TARGET').split(':') as [string, string];
  const socks = await socksPassthrough(targetHost, Number(targetPort));
  const logFile = process.argv.includes('--log') ? arg('log') : undefined;
  const skipped: number[] = [];
  const production: OmemoEncryptor = omemoEncryptorFrom({ deviceId: lab.deviceId, ...lab.identity }, lab.bundle, (e) => skipped.push(e.skippedDevice));
  const elements: string[] = [];
  const encryptor: OmemoEncryptor = cmd === 'replay'
    ? { announce: production.announce, encrypt: async () => readFileSync(arg('element'), 'utf8') }
    : {
      announce: production.announce,
      encrypt: async (input) => {
        const el = await production.encrypt(input);
        elements.push(el);
        return el;
      },
    };
  const sender = xmppSender(
    { jid: env('X2F_XMPP_JID'), password: env('X2F_XMPP_PASSWORD'), host: process.env.X2F_XMPP_HOST || env('X2F_XMPP_JID').split('@')[1]!, port: Number(process.env.X2F_XMPP_PORT || '5223'), socks: { host: '127.0.0.1', port: socks.port } },
    { ca: readFileSync(env('X2F_LAB_CA')), ...encryptor, bounceWaitMs: Number(process.env.X2F_LAB_BOUNCE_MS || '1500') },
  );
  const to = arg('to');
  const count = Number(arg('count', '1'));
  const ledger = flag('ledger') ? new PreKeyLedger() : undefined;
  const kind = arg('kind', 'account-change');
  const message: JabberMessage = kind === 'test-code' ? { kind, code: arg('code', '123456') } : { kind: kind as 'account-change' | 'trade-attention' };
  try {
    for (let i = 0; i < count; i++) {
      const started = Date.now();
      skipped.length = 0;
      elements.length = 0;
      try {
        await sender.send(to, cmd === 'replay' ? { kind: 'account-change' } : message, ledger ? { preKeys: ledger } : {});
        record(logFile, { cmd, i, to, kind, ok: true, ms: Date.now() - started, skipped: [...skipped], element: elements[0] ? describe(elements[0]) : null, socks: socks.seen.at(-1) });
      } catch (e) {
        record(logFile, { cmd, i, to, kind, ok: false, ms: Date.now() - started, error: (e as Error).message, skipped: [...skipped], element: elements[0] ? describe(elements[0]) : null });
      }
      if (i === 0 && elements[0] && process.argv.includes('--save-element')) writeFileSync(arg('save-element'), elements[0]);
    }
  } finally {
    socks.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
