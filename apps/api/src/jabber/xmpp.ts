/**
 * The real `JabberSender` (owner rule p5-7): X2F's own XMPP account sends one message per
 * connection. Deliberately small, with no XMPP library:
 *
 * - **Tor only** (owner ruling p11-31). The connection goes through a SOCKS5 proxy (`X2F_XMPP_SOCKS`,
 *   the local Tor daemon), which is handed the server's host name to resolve: a `.onion` name never
 *   reaches a DNS resolver and nothing is looked up before connecting (socks.ts).
 * - **TLS only.** Direct TLS (XEP-0368, RFC 7590) from the first byte inside that stream, TLS 1.2 or
 *   newer, the server certificate checked against the account's domain. There is no plaintext stream
 *   and no STARTTLS, so there is nothing to downgrade.
 * - SASL SCRAM-SHA-256, else SCRAM-SHA-1, else PLAIN (review L1; scram.ts), only ever inside that
 *   TLS session, then resource binding (RFC 6120).
 * - **OMEMO only** (owner ruling p11-31; omemo.ts, @x2f/omemo; docs/jabber/omemo-plan.md). After
 *   bind, X2F's own device list and bundle are published to its PEP nodes (open access); then the
 *   recipient's device list and bundles are fetched; with no bundle that checks out the send fails
 *   before any message is written. The message is the `<encrypted>` element the encryptor returns
 *   (OMEMO 0.3: a fresh session and PreKeySignalMessage per device), with no `<body>` at all: never
 *   plaintext.
 * - A ping (XEP-0199) after the message confirms the server took it; an error stanza for the
 *   message before the ping result or within `bounceWaitMs` after it fails the send (review L2), so a
 *   bounce never counts as sent.
 *
 * Errors never quote the address, the password or anything the server said.
 *
 * GAP (owner p5-7 build, 2026-11-08): X2F's production Jabber account and server are not set up,
 * so `X2F_XMPP_*` are unset and the set-up answers `jabber-unavailable`. Not built yet: SCRAM's
 * -PLUS channel binding, ALPN, interop tests against real clients (plan, section 4).
 */
import { isIP } from 'node:net';
import { connect, type ConnectionOptions, type TLSSocket } from 'node:tls';
import type { XmppConfig } from '../config.js';
import { BARE_JID } from '../config.js';
import {
  DEVICELIST_NODE, bundleNode, isEncryptedElement, isResultIq, itemsRequest, parseBundle, parseDeviceList, publishRequest, type OmemoAnnounce, type OmemoBundle,
  type OmemoEncrypt,
} from './omemo.js';
import { SCRAM_MECHANISMS, scramClient } from './scram.js';
import { messageText, SENDER_NAME, type JabberMessage, type JabberSender } from './sender.js';
import { socksConnect } from './socks.js';

/** A server that sends more than this before we have what we wait for is refused. */
const MAX_BUFFER = 64 * 1024;
const STEP_TIMEOUT_MS = 20_000;
/** How long after the ping result an error stanza for the message still fails the send. */
const BOUNCE_WAIT_MS = 1_500;

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

  /**
   * Resolves with the first match of `re` and the text before it (dropping both). With `soft`, a
   * timeout or a closed stream resolves null instead of failing.
   */
  async until(re: RegExp, step: string, o: { ms?: number; soft?: boolean } = {}): Promise<{ m: RegExpExecArray; before: string } | null> {
    const deadline = Date.now() + (o.ms ?? STEP_TIMEOUT_MS);
    for (;;) {
      if (/<stream:error[\s>]|<failure[\s>]/.test(this.buf)) throw new XmppError(step);
      const m = re.exec(this.buf);
      if (m) {
        const before = this.buf.slice(0, m.index);
        this.buf = this.buf.slice(m.index + m[0].length);
        return { m, before };
      }
      if (this.buf.length > MAX_BUFFER) throw new XmppError(step);
      const left = deadline - Date.now();
      if (this.closed || left <= 0) {
        if (o.soft) return null;
        throw new XmppError(step);
      }
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

  async must(re: RegExp, step: string): Promise<{ m: RegExpExecArray; before: string }> {
    return (await this.until(re, step))!;
  }

  /** The whole `<iq>` with this id (self-closing or not). */
  async iq(id: string, step: string): Promise<string> {
    return (await this.must(new RegExp(`<iq\\b[^>]*\\bid=['"]${id}['"][^>]*(?:/>|>[\\s\\S]*?</iq>)`), step)).m[0];
  }
}

const openStream = (domain: string) =>
  `<?xml version='1.0'?><stream:stream to='${xmlEscape(domain)}' version='1.0' xml:lang='en' xmlns='jabber:client' xmlns:stream='http://etherx.jabber.org/streams'>`;

const SASL_NS = 'urn:ietf:params:xml:ns:xmpp-sasl';

export interface XmppSenderOptions {
  /** Extra trust anchors (tests use their own CA); production uses the system's. */
  ca?: ConnectionOptions['ca'];
  /** Encrypts the message to the recipient's OMEMO devices (omemo.ts `omemoEncryptor`). Without one, every send fails at that step. */
  encrypt?: OmemoEncrypt;
  /** X2F's own device list and bundle, published after bind on every connection; without it nothing is published. */
  announce?: OmemoAnnounce;
  /** How long to wait for a bounce after the ping result (default `BOUNCE_WAIT_MS`). */
  bounceWaitMs?: number;
}

/** The opening tag of an error stanza for message `id` (RFC 6120 8.3). */
const bounceOf = (id: string) => new RegExp(`<message\\b(?=[^>]*\\btype=['"]error['"])(?=[^>]*\\bid=['"]${id}['"])[^>]*>`);

export function xmppSender(cfg: XmppConfig, opts: XmppSenderOptions = {}): JabberSender {
  if (!BARE_JID.test(cfg.jid)) throw new Error('config: X2F_XMPP_JID is malformed');
  // Tor is mandatory (owner ruling p11-31): there is no direct connection.
  if (!cfg.socks || isIP(cfg.socks.host) === 0) throw new Error('config: X2F_XMPP_SOCKS (a SOCKS5 proxy at an IP address) is required');
  const at = cfg.jid.indexOf('@');
  const local = cfg.jid.slice(0, at);
  const domain = cfg.jid.slice(at + 1);
  const encrypt: OmemoEncrypt = opts.encrypt ?? (async () => {
    throw new XmppError('omemo');
  });
  const bounceWaitMs = opts.bounceWaitMs ?? BOUNCE_WAIT_MS;
  return {
    async send(to: string, message: JabberMessage): Promise<void> {
      if (!BARE_JID.test(to)) throw new XmppError('address check');
      const text = messageText(message);
      const tunnel = await socksConnect(cfg.socks, cfg.host, cfg.port, STEP_TIMEOUT_MS);
      const socket = connect({
        socket: tunnel, servername: domain, minVersion: 'TLSv1.2', rejectUnauthorized: true,
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
        const features = (await read.must(/<stream:features[\s\S]*?<\/stream:features>/, 'features')).m[0];
        const offered = new Set([...features.matchAll(/<mechanism>([A-Z0-9-]+)<\/mechanism>/g)].map((m) => m[1]!));
        const scram = SCRAM_MECHANISMS.find(([name]) => offered.has(name));
        if (scram) {
          const client = scramClient(scram[1], local, cfg.password);
          write(`<auth xmlns='${SASL_NS}' mechanism='${scram[0]}'>${client.first()}</auth>`);
          const challenge = (await read.must(/<challenge\b[^>]*>([^<]*)<\/challenge>/, 'sasl')).m[1]!;
          let answer: string;
          try {
            answer = client.final(challenge);
          } catch {
            throw new XmppError('sasl');
          }
          write(`<response xmlns='${SASL_NS}'>${answer}</response>`);
          const success = (await read.must(/<success\b[^>]*(?:\/>|>([^<]*)<\/success>)/, 'sasl')).m[1] ?? '';
          // The server must prove it knows the password before anything else is sent.
          if (!client.verify(success)) throw new XmppError('sasl');
        } else if (offered.has('PLAIN')) {
          const creds = Buffer.from(`\0${local}\0${cfg.password}`, 'utf8').toString('base64');
          write(`<auth xmlns='${SASL_NS}' mechanism='PLAIN'>${creds}</auth>`);
          await read.must(/<success[\s/>]/, 'sasl');
        } else {
          throw new XmppError('sasl');
        }

        write(openStream(domain));
        await read.must(/<stream:features[\s\S]*?<\/stream:features>/, 'features');
        write(`<iq type='set' id='bind1'><bind xmlns='urn:ietf:params:xml:ns:xmpp-bind'><resource>x2f-alerts</resource></bind></iq>`);
        const bound = await read.iq('bind1', 'bind');
        if (!/^<iq\b[^>]*\btype=['"]result['"]/.test(bound)) throw new XmppError('bind');

        // OMEMO (owner ruling p11-31). Our own device list and bundle first, so the recipient's client can read our keys.
        if (opts.announce) {
          const ours = await opts.announce();
          write(publishRequest('omemo-pub-dl', DEVICELIST_NODE, ours.deviceList, xmlEscape));
          if (!isResultIq(await read.iq('omemo-pub-dl', 'publish'))) throw new XmppError('publish');
          write(publishRequest('omemo-pub-b', bundleNode(ours.deviceId), ours.bundle, xmlEscape));
          if (!isResultIq(await read.iq('omemo-pub-b', 'publish'))) throw new XmppError('publish');
        }
        // Then the recipient's devices and their bundles, or no message.
        write(itemsRequest(to, 'omemo-dl', DEVICELIST_NODE, xmlEscape));
        const devices = parseDeviceList(await read.iq('omemo-dl', 'omemo'));
        const bundles: OmemoBundle[] = [];
        for (const [i, deviceId] of devices.entries()) {
          write(itemsRequest(to, `omemo-b${i}`, bundleNode(deviceId), xmlEscape));
          const b = parseBundle(deviceId, await read.iq(`omemo-b${i}`, 'omemo'));
          if (b) bundles.push(b);
        }
        if (bundles.length === 0) throw new XmppError('omemo');
        let encrypted: string;
        try {
          encrypted = await encrypt({ to, plaintext: text, bundles });
        } catch {
          throw new XmppError('omemo'); // never the encryptor's own words
        }
        if (!isEncryptedElement(encrypted)) throw new XmppError('omemo');

        const id = `x2f${Date.now().toString(36)}`;
        write(
          `<message to='${xmlEscape(to)}' type='chat' id='${id}'>${encrypted}` +
            `<nick xmlns='http://jabber.org/protocol/nick'>${xmlEscape(SENDER_NAME)}</nick><store xmlns='urn:xmpp:hints'/></message>`,
        );
        write(`<iq type='get' id='ping1' to='${xmlEscape(domain)}'><ping xmlns='urn:xmpp:ping'/></iq>`);
        const ping = await read.must(/<iq\b[^>]*\bid=['"]ping1['"][^>]*>/, 'ping');
        if (bounceOf(id).test(ping.before)) throw new XmppError('delivery');
        // A bounce from the recipient's server can follow the ping result: wait briefly for one.
        if ((await read.until(bounceOf(id), 'delivery', { ms: bounceWaitMs, soft: true })) !== null) throw new XmppError('delivery');
        write('</stream:stream>');
      } finally {
        socket.end();
        setTimeout(() => socket.destroy(), 1_000).unref();
      }
    },
  };
}
