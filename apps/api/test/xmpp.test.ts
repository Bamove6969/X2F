// Owner rule p5-7: the XMPP sender against a local fake server, reached through a fake SOCKS5 proxy
// (owner ruling p11-31: Tor is mandatory). TLS from the first byte, the certificate checked against
// the account's domain, no plaintext path, and only the fixed text.
import { X509Certificate, createHash, createHmac, generateKeyPairSync, pbkdf2Sync, randomBytes, timingSafeEqual, type KeyObject } from 'node:crypto';
import dns from 'node:dns';
import { connect as tcpConnect, createServer as createTcpServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { createServer as createTlsServer, type TLSSocket } from 'node:tls';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { ACCOUNT_CHANGE_TEXT } from '../src/jabber/sender.js';
import { xmlEscape, xmppSender, type XmppSenderOptions } from '../src/jabber/xmpp.js';

const OMEMO_NS = 'eu.siacs.conversations.axolotl';
import { certificate } from './helpers/der.js';
import { VAPID_ENV } from './helpers/vapid.js';

const YEAR = 365 * 86_400_000;
const p256 = () => generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pem = (der: Buffer) => new X509Certificate(der).toString();

function ca() {
  const root = p256();
  const name = { C: 'XX', O: 'X2F Test', CN: 'X2F Test TLS Root' };
  const now = Date.now();
  const rootCert = certificate({
    serial: 1, issuer: name, subject: name, publicKey: root.publicKey, signingKey: root.privateKey, ca: true,
    notBefore: new Date(now - YEAR), notAfter: new Date(now + YEAR),
  });
  const leaf = (host: string): { key: KeyObject; cert: string } => {
    const k = p256();
    const der = certificate({
      serial: 2, issuer: name, subject: { C: 'XX', O: 'X2F Test', CN: host }, publicKey: k.publicKey, signingKey: root.privateKey,
      ca: false, dnsNames: [host], notBefore: new Date(now - YEAR), notAfter: new Date(now + YEAR),
    });
    return { key: k.privateKey, cert: pem(der) };
  };
  return { root: pem(rootCert), leaf };
}

// ---------------------------------------------------------------------------------------------
// The fake server, and a fake SOCKS5 proxy in front of it.

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

const PASSWORD = 's3cret-pass';
const servers: Server[] = [];
const sockets: Socket[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const s of sockets.splice(0)) s.destroy();
  for (const s of servers.splice(0)) await new Promise((r) => s.close(r));
});

const STREAM = `<?xml version='1.0'?><stream:stream from='xmpp.test' id='s1' version='1.0' xmlns='jabber:client' xmlns:stream='http://etherx.jabber.org/streams'>`;
const SASL = "xmlns='urn:ietf:params:xml:ns:xmpp-sasl'";
const ALL_MECHANISMS = ['SCRAM-SHA-1', 'PLAIN', 'SCRAM-SHA-256'];

type Devices = 'item-not-found' | Array<{ id: number; bundle: string | null }>;

interface FakeOptions {
  host?: string;
  mechanisms?: string[];
  acceptPassword?: string;
  /** SCRAM: answer with a wrong server signature. */
  badServerSignature?: boolean;
  /** The recipient's OMEMO devices as PEP shows them (default: one valid device). */
  devices?: Devices;
  /** Answer the message with an error stanza before the ping result, or after it. */
  bounce?: 'early' | 'late';
}

async function fakeServer(o: FakeOptions = {}) {
  const pki = ca();
  const { key, cert } = pki.leaf(o.host ?? 'xmpp.test');
  const transcript: string[] = [];
  const mechanisms = o.mechanisms ?? ALL_MECHANISMS;
  const devices: Devices = o.devices ?? [];
  const pubsub = (node: string, inner: string) =>
    `<pubsub xmlns='http://jabber.org/protocol/pubsub'><items node='${node}'><item id='current'>${inner}</item></items></pubsub>`;
  const server = createTlsServer({ key: key.export({ type: 'pkcs8', format: 'pem' }), cert, minVersion: 'TLSv1.2' }, (sock: TLSSocket) => {
    sock.setEncoding('utf8');
    let buf = '';
    let streams = 0;
    let scram: { hash: 'sha256' | 'sha1'; bare: string; serverFirst: string; nonce: string; salt: Buffer } | null = null;
    sock.on('error', () => undefined);
    sock.on('data', (d: string) => {
      buf += d;
      transcript.push(d);
      for (;;) {
        if (/<stream:stream[^>]*>/.test(buf)) {
          buf = buf.replace(/^[\s\S]*?<stream:stream[^>]*>/, '');
          streams++;
          sock.write(STREAM + (streams === 1
            ? `<stream:features><mechanisms ${SASL}>${mechanisms.map((m) => `<mechanism>${m}</mechanism>`).join('')}</mechanisms></stream:features>`
            : `<stream:features><bind xmlns='urn:ietf:params:xml:ns:xmpp-bind'/></stream:features>`));
          continue;
        }
        const auth = /<auth[^>]*mechanism='([A-Z0-9-]+)'[^>]*>([^<]*)<\/auth>/.exec(buf);
        if (auth) {
          buf = buf.slice(auth.index + auth[0].length);
          const data = Buffer.from(auth[2]!, 'base64').toString('utf8');
          if (auth[1] === 'PLAIN') {
            const [, user, pass] = data.split('\0');
            sock.write(user === 'x2f-alerts' && pass === (o.acceptPassword ?? PASSWORD)
              ? `<success ${SASL}/>` : `<failure ${SASL}><not-authorized/></failure>`);
          } else {
            const hash = auth[1] === 'SCRAM-SHA-256' ? 'sha256' : 'sha1';
            const bare = data.slice(data.indexOf('n=', 3));
            const cnonce = /,r=([^,]+)/.exec(bare)![1]!;
            const salt = randomBytes(16);
            const nonce = `${cnonce}srvnonce`;
            const serverFirst = `r=${nonce},s=${b64(salt)},i=4096`;
            scram = { hash, bare, serverFirst, nonce, salt };
            sock.write(`<challenge ${SASL}>${b64(Buffer.from(serverFirst))}</challenge>`);
          }
          continue;
        }
        const response = /<response[^>]*>([^<]*)<\/response>/.exec(buf);
        if (response && scram) {
          buf = buf.slice(response.index + response[0].length);
          const final = Buffer.from(response[1]!, 'base64').toString('utf8');
          const withoutProof = final.slice(0, final.indexOf(',p='));
          const proof = Buffer.from(final.slice(final.indexOf(',p=') + 3), 'base64');
          const salted = pbkdf2Sync(o.acceptPassword ?? PASSWORD, scram.salt, 4096, scram.hash === 'sha256' ? 32 : 20, scram.hash);
          const clientKey = createHmac(scram.hash, salted).update('Client Key').digest();
          const authMessage = `${scram.bare},${scram.serverFirst},${withoutProof}`;
          const clientSig = createHmac(scram.hash, createHash(scram.hash).update(clientKey).digest()).update(authMessage).digest();
          const expected = Buffer.from(clientKey.map((b, i) => b ^ clientSig[i]!));
          const okNonce = withoutProof === `c=${b64(Buffer.from('n,,'))},r=${scram.nonce}`;
          if (!okNonce || proof.length !== expected.length || !timingSafeEqual(proof, expected)) {
            sock.write(`<failure ${SASL}><not-authorized/></failure>`);
          } else {
            const serverSig = createHmac(scram.hash, createHmac(scram.hash, salted).update('Server Key').digest()).update(authMessage).digest();
            if (o.badServerSignature) serverSig[0] = serverSig[0]! ^ 1;
            sock.write(`<success ${SASL}>${b64(Buffer.from(`v=${b64(serverSig)}`))}</success>`);
          }
          scram = null;
          continue;
        }
        const message = /<message\b[^>]*\bid='([^']+)'[^>]*>[\s\S]*?<\/message>/.exec(buf);
        if (message) {
          buf = buf.slice(message.index + message[0].length);
          if (o.bounce === 'early') sock.write(`<message type='error' id='${message[1]}' from='mira@xmpp.example.org'><error type='cancel'><service-unavailable xmlns='urn:ietf:params:xml:ns:xmpp-stanzas'/></error></message>`);
          if (o.bounce === 'late') {
            const id = message[1];
            setTimeout(() => sock.write(`<message type='error' id='${id}' from='mira@xmpp.example.org'><error type='cancel'><item-not-found xmlns='urn:ietf:params:xml:ns:xmpp-stanzas'/></error></message>`), 30);
          }
          continue;
        }
        const iq = /<iq\b[^>]*\bid='([^']+)'[^>]*>([\s\S]*?)<\/iq>/.exec(buf);
        if (iq) {
          buf = buf.slice(iq.index + iq[0].length);
          const [, id, inner] = iq;
          const node = /<items node='([^']+)'/.exec(inner!)?.[1];
          if (/<bind /.test(inner!)) {
            sock.write(`<iq type='result' id='${id}'><bind xmlns='urn:ietf:params:xml:ns:xmpp-bind'><jid>x2f-alerts@xmpp.test/x2f-alerts</jid></bind></iq>`);
          } else if (/<ping /.test(inner!)) {
            sock.write(`<iq type='result' id='${id}' from='xmpp.test'/>`);
          } else if (node === `${OMEMO_NS}.devicelist`) {
            sock.write(devices === 'item-not-found'
              ? `<iq type='error' id='${id}' from='mira@xmpp.example.org'><error type='cancel'><item-not-found xmlns='urn:ietf:params:xml:ns:xmpp-stanzas'/></error></iq>`
              : `<iq type='result' id='${id}' from='mira@xmpp.example.org'>${pubsub(node, `<list xmlns='${OMEMO_NS}'>${devices.map((x) => `<device id='${x.id}'/>`).join('')}</list>`)}</iq>`);
          } else if (node?.startsWith(`${OMEMO_NS}.bundles:`)) {
            const bundle = devices === 'item-not-found' ? null : devices.find((x) => `${OMEMO_NS}.bundles:${x.id}` === node)?.bundle ?? null;
            sock.write(bundle === null
              ? `<iq type='error' id='${id}' from='mira@xmpp.example.org'><error type='cancel'><item-not-found xmlns='urn:ietf:params:xml:ns:xmpp-stanzas'/></error></iq>`
              : `<iq type='result' id='${id}' from='mira@xmpp.example.org'>${pubsub(node, bundle)}</iq>`);
          } else {
            sock.write(`<iq type='error' id='${id}'><error type='cancel'><feature-not-implemented xmlns='urn:ietf:params:xml:ns:xmpp-stanzas'/></error></iq>`);
          }
          continue;
        }
        break;
      }
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return { port, root: pki.root, transcript, all: () => transcript.join('') };
}

/**
 * A fake SOCKS5 proxy (RFC 1928): no authentication, CONNECT only. Records each CONNECT's address
 * type, host name and port, then pipes the stream to `targetPort` on 127.0.0.1 (or answers `reply`).
 */
async function fakeSocks(targetPort: number, o: { reply?: number | undefined } = {}) {
  const requests: Array<{ atyp: number; host: string; port: number }> = [];
  const server = createTcpServer((client) => {
    sockets.push(client);
    client.on('error', () => undefined);
    let buf = Buffer.alloc(0);
    let stage: 'greeting' | 'request' | 'piped' = 'greeting';
    client.on('data', (d: Buffer) => {
      if (stage === 'piped') return;
      buf = Buffer.concat([buf, d]);
      if (stage === 'greeting') {
        if (buf.length < 2 || buf.length < 2 + buf[1]!) return;
        if (buf[0] !== 5 || !buf.subarray(2, 2 + buf[1]!).includes(0)) return void client.end(Buffer.from([5, 0xff]));
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
        const port = buf.readUInt16BE(4 + hostLen);
        requests.push({ atyp, host, port });
        const rest = buf.subarray(4 + hostLen + 2);
        const reply = o.reply ?? 0;
        if (reply !== 0) return void client.end(Buffer.from([5, reply, 0, 1, 0, 0, 0, 0, 0, 0]));
        stage = 'piped';
        const upstream = tcpConnect(targetPort, '127.0.0.1', () => {
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
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { port: (server.address() as AddressInfo).port, requests };
}

const ONION = 'x2falertsxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxd.onion';

async function setup(o: FakeOptions & { password?: string; socksReply?: number; opts?: Partial<XmppSenderOptions> } = {}) {
  const s = await fakeServer(o);
  const socks = await fakeSocks(s.port, { reply: o.socksReply });
  const sender = xmppSender(
    { jid: 'x2f-alerts@xmpp.test', password: o.password ?? PASSWORD, host: ONION, port: 5223, socks: { host: '127.0.0.1', port: socks.port } },
    { ca: s.root, ...o.opts },
  );
  return { ...s, socks, sender };
}

const messagesIn = (all: string) => [...all.matchAll(/<message[\s\S]*?<\/message>/g)].map((m) => m[0]);

describe('xmppSender: through SOCKS5 only (Tor, owner ruling p11-31)', () => {
  it('connects only through the proxy, handing it the host name to resolve; no DNS lookup before connecting', async () => {
    const s = await setup();
    // (After the fake servers' own listen(), which resolves its address.)
    const lookup = vi.spyOn(dns, 'lookup');
    await s.sender.send('mira@xmpp.example.org', { kind: 'account-change' });
    expect(s.socks.requests).toEqual([{ atyp: 3, host: ONION, port: 5223 }]);
    expect(lookup.mock.calls.map((c) => String(c[0]))).toEqual([]);
    expect(s.all()).toContain('<stream:stream');
  });

  it('fails when the proxy refuses the connection; nothing reaches the server', async () => {
    const s = await setup({ socksReply: 4 });
    await expect(s.sender.send('mira@xmpp.example.org', { kind: 'account-change' })).rejects.toThrow(/^xmpp: socks failed$/);
    expect(s.all()).toBe('');
  });

  it('fails when nothing listens at the proxy address', async () => {
    const free = createTcpServer();
    await new Promise<void>((r) => free.listen(0, '127.0.0.1', r));
    const port = (free.address() as AddressInfo).port;
    await new Promise((r) => free.close(r));
    const sender = xmppSender({ jid: 'x2f-alerts@xmpp.test', password: PASSWORD, host: ONION, port: 5223, socks: { host: '127.0.0.1', port } }, { ca: ca().root });
    await expect(sender.send('mira@xmpp.example.org', { kind: 'account-change' })).rejects.toThrow(/^xmpp: socks failed$/);
  });

  it('refuses to be built without a proxy, or with a proxy that is not an IP address', () => {
    const base = { jid: 'x2f-alerts@xmpp.test', password: PASSWORD, host: ONION, port: 5223 };
    expect(() => xmppSender(base as never)).toThrow(/X2F_XMPP_SOCKS/);
    expect(() => xmppSender({ ...base, socks: { host: 'tor.example', port: 9050 } })).toThrow(/X2F_XMPP_SOCKS/);
  });
});

describe('xmppSender: TLS, SASL', () => {
  it('sends the fixed sentence over TLS: PLAIN inside TLS, bind, one message from "X2F alerts", a ping, close', async () => {
    const s = await setup();
    await s.sender.send('mira@xmpp.example.org', { kind: 'account-change' });
    const all = s.all();
    const messages = messagesIn(all);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/^<message to='mira@xmpp\.example\.org' type='chat' id='x2f[0-9a-z]+'>/);
    expect(messages[0]!.replace(/ id='[^']*'/, '')).toBe(
      `<message to='mira@xmpp.example.org' type='chat'><body>${ACCOUNT_CHANGE_TEXT}</body><nick xmlns='http://jabber.org/protocol/nick'>X2F alerts</nick></message>`,
    );
    expect(all).toContain("mechanism='PLAIN'");
    expect(all).toContain("<ping xmlns='urn:xmpp:ping'/>");
    await expect.poll(() => s.all()).toContain('</stream:stream>');
  });

  it('a test code message carries only the code', async () => {
    const s = await setup();
    await s.sender.send('mira@xmpp.example.org', { kind: 'test-code', code: '123456' });
    expect(s.all()).toContain('<body>Your X2F test code is 123456.</body>');
  });

  it('refuses a server that does not speak TLS (no plaintext fallback): nothing is ever written in the clear', async () => {
    const seen: string[] = [];
    const plain = createTcpServer((sock) => {
      sockets.push(sock);
      sock.on('data', (d) => seen.push(d.toString('latin1')));
      sock.on('error', () => undefined);
      sock.write(STREAM + `<stream:features><starttls xmlns='urn:ietf:params:xml:ns:xmpp-tls'/></stream:features>`);
    });
    servers.push(plain);
    await new Promise<void>((r) => plain.listen(0, '127.0.0.1', r));
    const socks = await fakeSocks((plain.address() as AddressInfo).port);
    const sender = xmppSender({ jid: 'x2f-alerts@xmpp.test', password: PASSWORD, host: ONION, port: 5223, socks: { host: '127.0.0.1', port: socks.port } }, { ca: ca().root });
    await expect(sender.send('mira@xmpp.example.org', { kind: 'account-change' })).rejects.toThrow(/^xmpp: tls failed$/);
    const bytes = seen.join('');
    expect(bytes).not.toContain('stream:stream');
    expect(bytes).not.toContain(PASSWORD);
    expect(bytes).not.toContain('mira');
  });

  it('refuses a certificate for another domain or from an unknown CA', async () => {
    const wrongHost = await setup({ host: 'other.test' });
    await expect(wrongHost.sender.send('mira@xmpp.example.org', { kind: 'account-change' })).rejects.toThrow(/tls/);
    const s = await setup({ opts: { ca: ca().root } });
    await expect(s.sender.send('mira@xmpp.example.org', { kind: 'account-change' })).rejects.toThrow(/tls/);
    expect(s.all()).toBe('');
  });

  it('fails without quoting anything on a wrong password or no PLAIN mechanism; sends no message', async () => {
    const s = await setup({ password: 'wrong' });
    const e = await s.sender.send('mira@xmpp.example.org', { kind: 'account-change' }).catch((x: Error) => x);
    expect((e as Error).message).toBe('xmpp: sasl failed');
    expect(s.all()).not.toContain('<message');
    const noPlain = await setup({ mechanisms: ['SCRAM-SHA-1'] });
    await expect(noPlain.sender.send('mira@xmpp.example.org', { kind: 'account-change' })).rejects.toThrow('xmpp: sasl failed');
    expect(noPlain.all()).not.toContain('<auth');
  });

  it('refuses a non-bare address and escapes XML', async () => {
    const s = await setup();
    await expect(s.sender.send("mira@x.org'/><evil", { kind: 'account-change' })).rejects.toThrow('xmpp: address check failed');
    expect(xmlEscape(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;');
  });
});

describe('config: X2F_JABBER_KEYS and X2F_XMPP_* (both optional; the production account is a GAP)', () => {
  const k = (fill: number) => `1:${Buffer.alloc(32, fill).toString('base64')}`;
  const BASE = {
    X2F_ORIGINS: 'https://x2f.test', X2F_RP_ID: 'x2f.test', DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/x2f',
    X2F_LEAKED_LIST_PATH: '/srv/x2f/leaked.bin', X2F_SERVER_KEY: Buffer.alloc(32, 7).toString('base64'), X2F_MONERO_NETWORK: 'stagenet',
    X2F_TERMS_VERSION: '2026-10-17', X2F_PGP_SIGNING_KEY_PATH: '/srv/x2f/signing.asc', X2F_PGP_SIGNING_FINGERPRINT: 'a'.repeat(40),
    X2F_PASSWORD_PEPPERS: k(1), X2F_RECOVERY_CODE_KEYS: k(2), X2F_TOTP_KEYS: k(3), X2F_LOGIN_NAME_KEYS: k(4), ...VAPID_ENV,
  };
  const ON = { X2F_JABBER_KEYS: k(9), X2F_XMPP_JID: 'x2f-alerts@xmpp.example.org', X2F_XMPP_PASSWORD: 'pw', X2F_XMPP_SOCKS: '127.0.0.1:9050' };

  it('off by default: no ring, no sending account, no credential anywhere', () => {
    const c = loadConfig(BASE);
    expect(c.jabberKeys).toBeNull();
    expect(c.xmpp).toBeNull();
  });

  it('reads the account with defaults (host = the domain, direct-TLS port 5223) and the SOCKS5 proxy', () => {
    const c = loadConfig({ ...BASE, ...ON });
    expect(c.jabberKeys?.current).toBe(1);
    expect(c.xmpp).toEqual({ jid: 'x2f-alerts@xmpp.example.org', password: 'pw', host: 'xmpp.example.org', port: 5223, socks: { host: '127.0.0.1', port: 9050 } });
    expect(loadConfig({ ...BASE, ...ON, X2F_XMPP_SOCKS: 'socks5h://[::1]:9150', X2F_XMPP_HOST: ONION }).xmpp).toMatchObject({ host: ONION, socks: { host: '::1', port: 9150 } });
  });

  it('refuses half a set-up, no proxy or a proxy by name, a bad address or port, and a ring that shares a key; errors never quote values', () => {
    const bad: Array<[Record<string, string | undefined>, RegExp]> = [
      [{ ...ON, X2F_JABBER_KEYS: undefined }, /X2F_JABBER_KEYS is missing/],
      [{ ...ON, X2F_XMPP_PASSWORD: undefined }, /X2F_XMPP_PASSWORD is missing/],
      [{ ...ON, X2F_XMPP_SOCKS: undefined }, /X2F_XMPP_SOCKS is missing/],
      [{ ...ON, X2F_XMPP_SOCKS: 'tor.internal:9050' }, /X2F_XMPP_SOCKS is malformed/],
      [{ ...ON, X2F_XMPP_SOCKS: 'socks5://127.0.0.1:9050' }, /X2F_XMPP_SOCKS is malformed/],
      [{ ...ON, X2F_XMPP_SOCKS: '127.0.0.1' }, /X2F_XMPP_SOCKS is malformed/],
      [{ X2F_JABBER_KEYS: k(9), X2F_XMPP_PASSWORD: 'secret-pw' }, /X2F_XMPP_PASSWORD .*X2F_XMPP_JID/],
      [{ X2F_JABBER_KEYS: k(9), X2F_XMPP_SOCKS: '127.0.0.1:9050' }, /X2F_XMPP_SOCKS .*X2F_XMPP_JID/],
      [{ ...ON, X2F_XMPP_JID: 'X2F@Example' }, /X2F_XMPP_JID is malformed/],
      [{ ...ON, X2F_XMPP_PORT: '0' }, /X2F_XMPP_PORT/],
      [{ X2F_JABBER_KEYS: k(4) }, /X2F_JABBER_KEYS .*separate/],
    ];
    for (const [over, re] of bad) {
      let message = '';
      try {
        loadConfig({ ...BASE, ...over });
      } catch (e) {
        message = (e as Error).message;
      }
      expect(message, JSON.stringify(over)).toMatch(re);
      expect(message).not.toContain('secret-pw');
    }
  });
});
