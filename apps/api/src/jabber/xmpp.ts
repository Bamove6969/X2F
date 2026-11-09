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
 * - Anyone who knows our full JID can put stanzas on this stream while it is open (RFC 6121
 *   8.5.3.1: no presence needed), so (OMEMO review M1) every request carries a random id, an answer
 *   counts only when its `from` is the party asked, a bounce only when it is from the recipient or
 *   their server, and `<failure>` is an answer during SASL alone.
 *
 * Errors never quote the address, the password or anything the server said.
 *
 * GAP (owner p5-7 build, 2026-11-08): X2F's production Jabber account and server are not set up,
 * so `X2F_XMPP_*` are unset and the set-up answers `jabber-unavailable`. Not built yet: SCRAM's
 * -PLUS channel binding, ALPN, interop tests against real clients (plan, section 4).
 */
import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { connect, type ConnectionOptions, type TLSSocket } from 'node:tls';
import type { XmppConfig } from '../config.js';
import { BARE_JID } from '../config.js';
import {
  DEVICELIST_NODE, bundleNode, isEncryptedElement, isResultIq, itemsRequest, parseBundle, parseDeviceList, publishRequest, type OmemoAnnounce, type OmemoBundle,
  type OmemoEncrypt,
} from './omemo.js';
import { SCRAM_MECHANISMS, scramClient } from './scram.js';
import { messageText, SENDER_NAME, type JabberMessage, type JabberSender, type SendOptions } from './sender.js';
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

/**
 * A stream error, where a top-level element lands: at the head of what is still unread (after the
 * stream header). Never anywhere else in the buffer: a stanza anyone sends us may carry the same
 * bytes inside (review M1), and a real stream error also closes the stream, which fails the step.
 */
const STREAM_ERROR = /^(?:\s|<\?xml\b[^>]*\?>|<stream:stream\b[^>]*>)*<stream:error[\s>]/;

/** A stanza's `from`, from its opening tag (undefined when it has none). */
const fromOf = (stanza: string): string | undefined => /^<[a-z:]+\b[^>]*?\sfrom=['"]([^'"]*)['"]/.exec(stanza)?.[1];

/** A fresh stanza id: nobody but the server we asked can know it (review M1). */
const newId = () => randomBytes(8).toString('hex');

type Accept = (m: RegExpExecArray) => boolean;

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
   * Resolves with the first match of `re` that `accept` takes (a refused match is dropped from the
   * stream and the wait goes on) and the text before it (dropping both). With `soft`, a timeout or
   * a closed stream resolves null instead of failing.
   */
  async until(re: RegExp, step: string, o: { ms?: number; soft?: boolean; accept?: Accept } = {}): Promise<{ m: RegExpExecArray; before: string } | null> {
    const deadline = Date.now() + (o.ms ?? STEP_TIMEOUT_MS);
    for (;;) {
      if (STREAM_ERROR.test(this.buf)) throw new XmppError(step);
      let m = re.exec(this.buf);
      while (m && o.accept && !o.accept(m)) {
        this.buf = this.buf.slice(0, m.index) + this.buf.slice(m.index + m[0].length);
        m = re.exec(this.buf);
      }
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

  async must(re: RegExp, step: string, accept?: Accept): Promise<{ m: RegExpExecArray; before: string }> {
    return (await this.until(re, step, accept ? { accept } : {}))!;
  }

  /** A SASL answer: the match, or `<failure>`, which is an answer only here and fails the step. */
  async sasl(re: RegExp): Promise<RegExpExecArray> {
    const { m } = await this.must(new RegExp(`${re.source}|<failure[\\s>]`), 'sasl');
    if (m[0].startsWith('<failure')) throw new XmppError('sasl');
    return m;
  }

  /** The whole `<iq>` with this id (self-closing or not) whose `from` passes `from` (RFC 6120 8.1.2.1). */
  async iq(id: string, step: string, from: (from: string | undefined) => boolean): Promise<string> {
    const re = new RegExp(`<iq\\b[^>]*\\bid=['"]${id}['"][^>]*(?:/>|>[\\s\\S]*?</iq>)`);
    return (await this.must(re, step, (m) => from(fromOf(m[0])))).m[0];
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
const bounceOf = (id: string, flags = '') => new RegExp(`<message\\b(?=[^>]*\\btype=['"]error['"])(?=[^>]*\\bid=['"]${id}['"])[^>]*>`, flags);

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
  /**
   * Who may answer a request to our own account or our server (bind, publish, ping): the server,
   * which writes no `from`, our bare JID or its own domain (RFC 6120 8.1.2.1). Anything else on the
   * stream with our id is someone else's stanza (review M1).
   */
  const ownAnswer = (from: string | undefined) => from === undefined || from === cfg.jid || from === domain;
  /** Who may answer a request to another party: exactly the JID it was addressed to. */
  const answerFrom = (to: string) => (from: string | undefined) => from === to;
  return {
    async send(to: string, message: JabberMessage, o: SendOptions = {}): Promise<void> {
      if (!BARE_JID.test(to)) throw new XmppError('address check');
      const text = messageText(message);
      /** A bounce comes from the recipient (bare or full JID) or their server; anyone else's error stanza is noise (review M1). */
      const recipientDomain = to.slice(to.indexOf('@') + 1);
      const fromRecipient = (from: string | undefined) => from === to || from === recipientDomain || (from !== undefined && from.startsWith(`${to}/`));
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
          const challenge = (await read.sasl(/<challenge\b[^>]*>([^<]*)<\/challenge>/))[1]!;
          let answer: string;
          try {
            answer = client.final(challenge);
          } catch {
            throw new XmppError('sasl');
          }
          write(`<response xmlns='${SASL_NS}'>${answer}</response>`);
          const success = (await read.sasl(/<success\b[^>]*(?:\/>|>([^<]*)<\/success>)/))[1] ?? '';
          // The server must prove it knows the password before anything else is sent.
          if (!client.verify(success)) throw new XmppError('sasl');
        } else if (offered.has('PLAIN')) {
          const creds = Buffer.from(`\0${local}\0${cfg.password}`, 'utf8').toString('base64');
          write(`<auth xmlns='${SASL_NS}' mechanism='PLAIN'>${creds}</auth>`);
          await read.sasl(/<success[\s/>]/);
        } else {
          throw new XmppError('sasl');
        }

        write(openStream(domain));
        await read.must(/<stream:features[\s\S]*?<\/stream:features>/, 'features');
        const bindId = newId();
        write(`<iq type='set' id='${bindId}'><bind xmlns='urn:ietf:params:xml:ns:xmpp-bind'><resource>x2f-alerts</resource></bind></iq>`);
        const bound = await read.iq(bindId, 'bind', ownAnswer);
        if (!/^<iq\b[^>]*\btype=['"]result['"]/.test(bound)) throw new XmppError('bind');

        // OMEMO (owner ruling p11-31). Our own device list and bundle first, so the recipient's client can read our keys.
        if (opts.announce) {
          const ours = await opts.announce();
          for (const [node, item] of [[DEVICELIST_NODE, ours.deviceList], [bundleNode(ours.deviceId), ours.bundle]] as const) {
            const id = newId();
            write(publishRequest(id, node, item, xmlEscape));
            if (!isResultIq(await read.iq(id, 'publish', ownAnswer))) throw new XmppError('publish');
          }
        }
        // Then the recipient's devices and their bundles, or no message.
        const listId = newId();
        write(itemsRequest(to, listId, DEVICELIST_NODE, xmlEscape));
        const devices = parseDeviceList(await read.iq(listId, 'omemo', answerFrom(to)));
        const bundles: OmemoBundle[] = [];
        for (const deviceId of devices) {
          const id = newId();
          write(itemsRequest(to, id, bundleNode(deviceId), xmlEscape));
          const b = parseBundle(deviceId, await read.iq(id, 'omemo', answerFrom(to)));
          if (b) bundles.push(b);
        }
        if (bundles.length === 0) throw new XmppError('omemo');
        let encrypted: string;
        try {
          encrypted = await encrypt({ to, plaintext: text, bundles, ...(o.preKeys ? { preKeys: o.preKeys } : {}) });
        } catch {
          throw new XmppError('omemo'); // never the encryptor's own words
        }
        if (!isEncryptedElement(encrypted)) throw new XmppError('omemo');

        const id = `x2f${newId()}`;
        write(
          `<message to='${xmlEscape(to)}' type='chat' id='${id}'>${encrypted}` +
            `<nick xmlns='http://jabber.org/protocol/nick'>${xmlEscape(SENDER_NAME)}</nick><store xmlns='urn:xmpp:hints'/></message>`,
        );
        const pingId = newId();
        write(`<iq type='get' id='${pingId}' to='${xmlEscape(domain)}'><ping xmlns='urn:xmpp:ping'/></iq>`);
        const ping = await read.must(new RegExp(`<iq\\b[^>]*\\bid=['"]${pingId}['"][^>]*>`), 'ping', (m) => ownAnswer(fromOf(m[0])));
        const isBounce: Accept = (m) => fromRecipient(fromOf(m[0]));
        if ([...ping.before.matchAll(bounceOf(id, 'g'))].some(isBounce)) throw new XmppError('delivery');
        // A bounce from the recipient's server can follow the ping result: wait briefly for one.
        if ((await read.until(bounceOf(id), 'delivery', { ms: bounceWaitMs, soft: true, accept: isBounce })) !== null) throw new XmppError('delivery');
        write('</stream:stream>');
      } finally {
        socket.end();
        setTimeout(() => socket.destroy(), 1_000).unref();
      }
    },
  };
}
