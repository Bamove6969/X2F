/**
 * The real `JabberSender` (owner rule p5-7): X2F's own XMPP account sends one message per
 * connection. Deliberately small, with no XMPP library:
 *
 * - **TLS only.** Direct TLS (XEP-0368, RFC 7590) from the first byte, TLS 1.2 or newer, the
 *   server certificate checked against the account's domain. There is no plaintext stream and no
 *   STARTTLS, so there is nothing to downgrade: a server that does not speak TLS on the port fails
 *   the handshake and the send fails.
 * - SASL PLAIN, only ever inside that TLS session, then resource binding (RFC 6120).
 * - The message is one of the two fixed texts (`messageText`), type `chat`, with the nickname
 *   "X2F alerts" (XEP-0172) and no other element. A ping (XEP-0199) after it confirms the server
 *   took it before the stream is closed.
 *
 * Errors never quote the address, the password or anything the server said.
 *
 * GAP (owner p5-7 build, 2026-11-08): X2F's production Jabber account and server are not set up,
 * so `X2F_XMPP_*` are unset and the set-up answers `jabber-unavailable`. Not built yet: sending
 * over Tor (the 2026-10-29 Plan 7 note says "OMEMO Jabber over Tor"; the p5-7 board says OMEMO is
 * recommended, not required, because the text gives nothing away), OMEMO encryption, SCRAM.
 */
import { connect, type ConnectionOptions, type TLSSocket } from 'node:tls';
import type { XmppConfig } from '../config.js';
import { BARE_JID } from '../config.js';
import { messageText, SENDER_NAME, type JabberMessage, type JabberSender } from './sender.js';

/** A server that sends more than this before we have what we wait for is refused. */
const MAX_BUFFER = 64 * 1024;
const STEP_TIMEOUT_MS = 20_000;

/** XML character data and attribute values. */
export function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

class XmppError extends Error {
  constructor(step: string) {
    super(`xmpp: ${step} failed`);
    this.name = 'XmppError';
  }
}

/** Reads the TLS stream until a pattern shows up, refusing stream errors and oversize input. */
class Reader {
  private buf = '';
  private waiter: (() => void) | null = null;
  private closed = false;

  constructor(socket: TLSSocket) {
    socket.setEncoding('utf8');
    socket.on('data', (d: string) => {
      this.buf += d;
      this.waiter?.();
    });
    const end = () => {
      this.closed = true;
      this.waiter?.();
    };
    socket.on('close', end);
    socket.on('error', end);
  }

  /** Resolves with the first match of `re` (and drops the text up to its end). */
  async until(re: RegExp, step: string): Promise<RegExpExecArray> {
    const deadline = Date.now() + STEP_TIMEOUT_MS;
    for (;;) {
      if (/<stream:error[\s>]|<failure[\s>]/.test(this.buf)) throw new XmppError(step);
      const m = re.exec(this.buf);
      if (m) {
        this.buf = this.buf.slice(m.index + m[0].length);
        return m;
      }
      if (this.closed || this.buf.length > MAX_BUFFER) throw new XmppError(step);
      const left = deadline - Date.now();
      if (left <= 0) throw new XmppError(step);
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, left);
        this.waiter = () => {
          clearTimeout(t);
          resolve();
        };
      });
      this.waiter = null;
    }
  }
}

const openStream = (domain: string) =>
  `<?xml version='1.0'?><stream:stream to='${xmlEscape(domain)}' version='1.0' xml:lang='en' xmlns='jabber:client' xmlns:stream='http://etherx.jabber.org/streams'>`;

export interface XmppSenderOptions {
  /** Extra trust anchors (tests use their own CA); production uses the system's. */
  ca?: ConnectionOptions['ca'];
}

export function xmppSender(cfg: XmppConfig, opts: XmppSenderOptions = {}): JabberSender {
  if (!BARE_JID.test(cfg.jid)) throw new Error('config: X2F_XMPP_JID is malformed');
  const at = cfg.jid.indexOf('@');
  const local = cfg.jid.slice(0, at);
  const domain = cfg.jid.slice(at + 1);
  return {
    async send(to: string, message: JabberMessage): Promise<void> {
      if (!BARE_JID.test(to)) throw new XmppError('address check');
      const text = messageText(message);
      const socket = connect({
        host: cfg.host, port: cfg.port, servername: domain, minVersion: 'TLSv1.2', rejectUnauthorized: true,
        ...(opts.ca ? { ca: opts.ca } : {}),
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(() => reject(new XmppError('tls')), STEP_TIMEOUT_MS);
          socket.once('secureConnect', () => {
            clearTimeout(t);
            resolve();
          });
          socket.once('error', () => {
            clearTimeout(t);
            reject(new XmppError('tls'));
          });
        });
        // `rejectUnauthorized` already refused a bad certificate; checked again so no option can loosen it.
        if (!socket.authorized) throw new XmppError('tls');
        const read = new Reader(socket);
        const write = (s: string) => socket.write(s);

        write(openStream(domain));
        const features = await read.until(/<stream:features[\s\S]*?<\/stream:features>/, 'features');
        if (!/<mechanism>PLAIN<\/mechanism>/.test(features[0])) throw new XmppError('sasl');
        const creds = Buffer.from(`\0${local}\0${cfg.password}`, 'utf8').toString('base64');
        write(`<auth xmlns='urn:ietf:params:xml:ns:xmpp-sasl' mechanism='PLAIN'>${creds}</auth>`);
        await read.until(/<success[\s/>]/, 'sasl');

        write(openStream(domain));
        await read.until(/<stream:features[\s\S]*?<\/stream:features>/, 'features');
        write(`<iq type='set' id='bind1'><bind xmlns='urn:ietf:params:xml:ns:xmpp-bind'><resource>x2f-alerts</resource></bind></iq>`);
        const bound = await read.until(/<iq\b[^>]*\bid=['"]bind1['"][^>]*>/, 'bind');
        if (!/\btype=['"]result['"]/.test(bound[0])) throw new XmppError('bind');

        write(
          `<message to='${xmlEscape(to)}' type='chat' id='x2f${Date.now().toString(36)}'><body>${xmlEscape(text)}</body>` +
            `<nick xmlns='http://jabber.org/protocol/nick'>${xmlEscape(SENDER_NAME)}</nick></message>`,
        );
        write(`<iq type='get' id='ping1' to='${xmlEscape(domain)}'><ping xmlns='urn:xmpp:ping'/></iq>`);
        await read.until(/<iq\b[^>]*\bid=['"]ping1['"][^>]*>/, 'ping');
        write('</stream:stream>');
      } finally {
        socket.end();
        setTimeout(() => socket.destroy(), 1_000).unref();
      }
    },
  };
}
