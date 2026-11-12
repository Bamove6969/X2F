/**
 * DEMO ONLY: running the demo inside the Android "Linux Terminal" Debian VM, opened from Chrome on
 * the same phone. The Terminal app forwards to the phone only ports the VM listens on at its own
 * network interface, so with X2F_DEMO_PHONE=1 (or auto-detected: /dev/vsock and a `droid` user)
 * the gateway's web port 4400, and nothing else, also listens on the VM's private address. Chrome
 * still opens http://localhost:4400 (the Terminal app forwards it), so the origin, cookies and
 * origin checks are unchanged. Every other service stays on 127.0.0.1.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { userInfo } from 'node:os';

/** 10/8, 172.16/12, 192.168/16: the only addresses the phone option binds (never 0.0.0.0 or a public one). */
export function isPrivateIpv4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (m === null) return false;
  const [a, b, c, d] = m.slice(1).map(Number) as [number, number, number, number];
  if ([a, b, c, d].some((n) => n > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export interface PhoneProbe {
  /** True when /dev/vsock exists and the user is `droid` (the Android Terminal VM). */
  androidVm: () => boolean;
  /** `hostname -I`'s output. */
  hostnameI: () => string;
}

export const realProbe: PhoneProbe = {
  androidVm: () => {
    let user = '';
    try {
      user = userInfo().username;
    } catch {
      // no user name
    }
    return existsSync('/dev/vsock') && (user === 'droid' || existsSync('/home/droid'));
  },
  hostnameI: () => spawnSync('hostname', ['-I'], { encoding: 'utf8' }).stdout ?? '',
};

/**
 * The VM address the gateway's web port should also listen on, or '' when the phone option is off.
 * X2F_DEMO_PHONE=1 turns it on, =0 off; unset, it is on inside the Android Terminal VM.
 * Throws when it is on and the VM has no private IPv4 address.
 */
export function phoneIp(env: Record<string, string | undefined>, probe: PhoneProbe = realProbe): string {
  const flag = env.X2F_DEMO_PHONE;
  const on = flag === '1' || (flag !== '0' && probe.androidVm());
  if (!on) return '';
  const ip = probe.hostnameI().split(/\s+/).find(isPrivateIpv4);
  if (ip === undefined) throw new Error('demo: X2F_DEMO_PHONE: this machine has no private IPv4 address (hostname -I)');
  return ip;
}
