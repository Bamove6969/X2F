import { describe, expect, it } from 'vitest';
import { isPrivateIpv4, phoneIp, type PhoneProbe } from '../demo/phone.js';

const probe = (androidVm: boolean, hostnameI: string): PhoneProbe => ({ androidVm: () => androidVm, hostnameI: () => hostnameI });

describe('the demo on the Android Terminal VM (X2F_DEMO_PHONE)', () => {
  it('is off by default outside the VM, and with X2F_DEMO_PHONE=0', () => {
    expect(phoneIp({}, probe(false, '192.168.0.2 '))).toBe('');
    expect(phoneIp({ X2F_DEMO_PHONE: '0' }, probe(true, '192.168.0.2'))).toBe('');
  });

  it('turns on with X2F_DEMO_PHONE=1 or inside the VM, on the first private IPv4 address', () => {
    expect(phoneIp({ X2F_DEMO_PHONE: '1' }, probe(false, 'fe80::1 203.0.113.7 10.0.2.15 192.168.1.4\n'))).toBe('10.0.2.15');
    expect(phoneIp({}, probe(true, '192.168.0.2 fd00::2'))).toBe('192.168.0.2');
  });

  it('refuses to start with no private IPv4 address (never 0.0.0.0 or a public one)', () => {
    expect(() => phoneIp({ X2F_DEMO_PHONE: '1' }, probe(false, '0.0.0.0 203.0.113.7 127.0.0.1'))).toThrow(/no private IPv4/);
  });

  it('knows the private ranges', () => {
    for (const ip of ['10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.0.2']) expect(isPrivateIpv4(ip)).toBe(true);
    for (const ip of ['0.0.0.0', '127.0.0.1', '172.15.0.1', '172.32.0.1', '100.64.0.1', '8.8.8.8', '192.168.0.256', '10.0.0', 'x']) expect(isPrivateIpv4(ip)).toBe(false);
  });
});
