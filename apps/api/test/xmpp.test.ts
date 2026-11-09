// Owner rule p5-7: the XMPP sender against a local fake server. TLS from the first byte, the
// certificate checked against the account's domain, no plaintext path, and only the fixed text.
import { X509Certificate, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { createServer as createTcpServer, type AddressInfo, type Server } from 'node:net';
import { createServer as createTlsServer, type TLSSocket } from 'node:tls';
import { afterEach, describe, expect, it } from 'vitest';
import { ACCOUNT_CHANGE_TEXT } from '../src/jabber/sender.js';
import { xmlEscape, xmppSender } from '../src/jabber/xmpp.js';
import { certificate } from './helpers/der.js';

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

const PASSWORD = 's3cret-pass';
const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise((r) => s.close(r));
});

const STREAM = `<?xml version='1.0'?><stream:stream from='xmpp.test' id='s1' version='1.0' xmlns='jabber:client' xmlns:stream='http://etherx.jabber.org/streams'>`;

/** A fake XMPP server: records everything the client wrote. */
async function fakeServer(o: { host?: string; mechanisms?: string; acceptPassword?: string } = {}) {
  const pki = ca();
  const { key, cert } = pki.leaf(o.host ?? 'xmpp.test');
  const transcript: string[] = [];
  const server = createTlsServer({ key: key.export({ type: 'pkcs8', format: 'pem' }), cert, minVersion: 'TLSv1.2' }, (sock: TLSSocket) => {
    sock.setEncoding('utf8');
    let buf = '';
    let streams = 0;
    sock.on('error', () => undefined);
    sock.on('data', (d: string) => {
      buf += d;
      transcript.push(d);
      for (;;) {
        if (/<stream:stream[^>]*>/.test(buf)) {
          buf = buf.replace(/^[\s\S]*?<stream:stream[^>]*>/, '');
          streams++;
          sock.write(STREAM + (streams === 1
            ? `<stream:features><mechanisms xmlns='urn:ietf:params:xml:ns:xmpp-sasl'>${o.mechanisms ?? '<mechanism>SCRAM-SHA-1</mechanism><mechanism>PLAIN</mechanism>'}</mechanisms></stream:features>`
            : `<stream:features><bind xmlns='urn:ietf:params:xml:ns:xmpp-bind'/></stream:features>`));
          continue;
        }
        const auth = /<auth[^>]*>([^<]*)<\/auth>/.exec(buf);
        if (auth) {
          buf = buf.slice(auth.index + auth[0].length);
          const [, user, pass] = Buffer.from(auth[1]!, 'base64').toString('utf8').split('\0');
          sock.write(user === 'x2f-alerts' && pass === (o.acceptPassword ?? PASSWORD)
            ? `<success xmlns='urn:ietf:params:xml:ns:xmpp-sasl'/>`
            : `<failure xmlns='urn:ietf:params:xml:ns:xmpp-sasl'><not-authorized/></failure>`);
          continue;
        }
        const iq = /<iq[^>]*id='(bind1|ping1)'[\s\S]*?(<\/iq>|\/>)/.exec(buf);
        if (iq) {
          buf = buf.slice(iq.index + iq[0].length);
          sock.write(iq[1] === 'bind1'
            ? `<iq type='result' id='bind1'><bind xmlns='urn:ietf:params:xml:ns:xmpp-bind'><jid>x2f-alerts@xmpp.test/x2f-alerts</jid></bind></iq>`
            : `<iq type='result' id='ping1' from='xmpp.test'/>`);
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

const sender = (port: number, root: string, password = PASSWORD) =>
  xmppSender({ jid: 'x2f-alerts@xmpp.test', password, host: '127.0.0.1', port }, { ca: root });

describe('xmppSender', () => {
  it('sends the fixed sentence over TLS: PLAIN inside TLS, bind, one message from "X2F alerts", a ping, close', async () => {
    const s = await fakeServer();
    await sender(s.port, s.root).send('mira@xmpp.example.org', { kind: 'account-change' });
    const all = s.all();
    const messages = [...all.matchAll(/<message[\s\S]*?<\/message>/g)].map((m) => m[0]);
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
    const s = await fakeServer();
    await sender(s.port, s.root).send('mira@xmpp.example.org', { kind: 'test-code', code: '123456' });
    expect(s.all()).toContain('<body>Your X2F test code is 123456.</body>');
  });

  it('refuses a server that does not speak TLS (no plaintext fallback): nothing is ever written in the clear', async () => {
    const seen: string[] = [];
    const plain = createTcpServer((sock) => {
      sock.on('data', (d) => seen.push(d.toString('latin1')));
      sock.on('error', () => undefined);
      sock.write(STREAM + `<stream:features><starttls xmlns='urn:ietf:params:xml:ns:xmpp-tls'/></stream:features>`);
    });
    servers.push(plain);
    await new Promise<void>((r) => plain.listen(0, '127.0.0.1', r));
    const port = (plain.address() as AddressInfo).port;
    await expect(sender(port, ca().root).send('mira@xmpp.example.org', { kind: 'account-change' })).rejects.toThrow(/^xmpp: tls failed$/);
    const bytes = seen.join('');
    expect(bytes).not.toContain('stream:stream');
    expect(bytes).not.toContain(PASSWORD);
    expect(bytes).not.toContain('mira');
  });

  it('refuses a certificate for another domain or from an unknown CA', async () => {
    const wrongHost = await fakeServer({ host: 'other.test' });
    await expect(sender(wrongHost.port, wrongHost.root).send('mira@xmpp.example.org', { kind: 'account-change' })).rejects.toThrow(/tls/);
    const s = await fakeServer();
    await expect(sender(s.port, ca().root).send('mira@xmpp.example.org', { kind: 'account-change' })).rejects.toThrow(/tls/);
    expect(s.all()).toBe('');
  });

  it('fails without quoting anything on a wrong password or no PLAIN mechanism; sends no message', async () => {
    const s = await fakeServer();
    const e = await sender(s.port, s.root, 'wrong').send('mira@xmpp.example.org', { kind: 'account-change' }).catch((x: Error) => x);
    expect((e as Error).message).toBe('xmpp: sasl failed');
    expect(s.all()).not.toContain('<message');
    const noPlain = await fakeServer({ mechanisms: '<mechanism>SCRAM-SHA-1</mechanism>' });
    await expect(sender(noPlain.port, noPlain.root).send('mira@xmpp.example.org', { kind: 'account-change' })).rejects.toThrow('xmpp: sasl failed');
    expect(noPlain.all()).not.toContain('<auth');
  });

  it('refuses a non-bare address and escapes XML', async () => {
    const s = await fakeServer();
    await expect(sender(s.port, s.root).send("mira@x.org'/><evil", { kind: 'account-change' })).rejects.toThrow('xmpp: address check failed');
    expect(xmlEscape(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt;');
  });
});
