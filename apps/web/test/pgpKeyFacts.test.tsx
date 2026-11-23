// @vitest-environment happy-dom
// Signup round 3 (owner's demo notes, 13 Nov 2026): /setup/pgp-key shows the key's user ID name,
// if it has one (never the email address: @x2f/accounts drops it), and its creation and expiry
// dates, in UTC.
import { describe, expect, it } from 'vitest';
import { KeyFacts } from '../src/screens/setup/PgpKey.js';
import { render } from './render.js';

const base = {
  ok: true as const,
  fingerprint: '3f2a9c417b0ed5a261c80e4b92d71f6ac3b80d15',
  algorithm: 'ed25519' as const,
  bits: null,
  expiresAt: new Date('2027-03-04T23:30:00Z'),
  createdAt: new Date('2026-03-04T23:30:00Z'),
  hasEmail: false,
};

describe('KeyFacts', () => {
  it('shows the name, the type, the creation and expiry dates (UTC) and the fingerprint', () => {
    const { host } = render(<KeyFacts check={{ ...base, name: 'Alice Example' }} />);
    expect(host.querySelector('[data-part="key-name"]')!.textContent).toBe('Name on the keyAlice Example');
    expect(host.querySelector('[data-part="key-created"]')!.textContent).toBe('Created4 Mar 2026');
    expect(host.textContent).toContain('Expires4 Mar 2027');
    expect(host.textContent).toContain('3F2A 9C41');
  });

  it('a key without a name shows no name row', () => {
    const { host } = render(<KeyFacts check={{ ...base, name: null, expiresAt: null }} />);
    expect(host.querySelector('[data-part="key-name"]')).toBeNull();
    expect(host.textContent).toContain('ExpiresNever');
  });
});
