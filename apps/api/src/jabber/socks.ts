/**
 * A SOCKS5 client (RFC 1928), CONNECT only and no authentication: how the Jabber sender reaches
 * X2F's XMPP server through the local Tor daemon (owner ruling p11-31: Tor is mandatory).
 *
 * The target is always sent as a host name (address type 3, "socks5h"), so the proxy resolves it:
 * a `.onion` name never goes to a DNS resolver, and nothing on this machine looks a name up. The
 * proxy itself must be an IP address, and the connection to it is made with a `lookup` that refuses,
 * so there is no DNS lookup before the connection at all.
 */
import { isIP, connect as tcpConnect, type Socket } from 'node:net';

export interface SocksProxy {
  /** An IPv4 or IPv6 address (never a name), e.g. 127.0.0.1 for the local Tor daemon. */
  host: string;
  port: number;
}

class SocksError extends Error {
  constructor() {
    super('xmpp: socks failed');
    this.name = 'SocksError';
  }
}

const refuseLookup = (_host: string, _opts: unknown, cb: (e: Error) => void) => cb(new SocksError());

/** Opens a stream to `host:port` through the proxy; resolves once the proxy reports it connected. */
export function socksConnect(proxy: SocksProxy, host: string, port: number, timeoutMs: number): Promise<Socket> {
  if (isIP(proxy.host) === 0) return Promise.reject(new SocksError());
  const name = Buffer.from(host, 'ascii');
  if (name.length < 1 || name.length > 255 || !Number.isInteger(port) || port < 1 || port > 65_535) return Promise.reject(new SocksError());
  return new Promise<Socket>((resolve, reject) => {
    const socket = tcpConnect({ host: proxy.host, port: proxy.port, lookup: refuseLookup as never });
    let buf = Buffer.alloc(0);
    let stage: 'greeting' | 'reply' = 'greeting';
    const fail = () => {
      clearTimeout(timer);
      socket.removeListener('data', onData);
      socket.destroy();
      reject(new SocksError());
    };
    const timer = setTimeout(fail, timeoutMs);
    const onData = (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      if (stage === 'greeting') {
        if (buf.length < 2) return;
        if (buf[0] !== 0x05 || buf[1] !== 0x00) return fail();
        buf = buf.subarray(2);
        stage = 'reply';
        const p = Buffer.alloc(2);
        p.writeUInt16BE(port);
        socket.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00, 0x03, name.length]), name, p]));
      }
      if (buf.length < 5) return;
      if (buf[0] !== 0x05 || buf[1] !== 0x00 || buf[2] !== 0x00) return fail();
      const addrLen = buf[3] === 0x01 ? 4 : buf[3] === 0x04 ? 16 : buf[3] === 0x03 ? 1 + buf[4]! : -1;
      if (addrLen < 0) return fail();
      const total = 4 + addrLen + 2;
      if (buf.length < total) return;
      clearTimeout(timer);
      socket.removeListener('data', onData);
      socket.removeListener('error', fail);
      socket.removeListener('close', fail);
      socket.on('error', () => undefined); // the TLS socket wrapping it reports errors from here on
      socket.pause();
      // Bytes after the reply belong to the tunnelled stream (TLS refuses them if they are not TLS).
      if (buf.length > total) socket.unshift(buf.subarray(total));
      resolve(socket);
    };
    socket.on('data', onData);
    socket.once('error', fail);
    socket.once('close', fail);
    socket.once('connect', () => socket.write(Buffer.from([0x05, 0x01, 0x00])));
  });
}
