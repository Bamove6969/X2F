// @vitest-environment happy-dom
// Signup round 3 (owner's demo notes, 13 Nov 2026): /setup/security-key shows generic security keys
// of four shapes. A marked placeholder until design draws it; no brand names or logos in it.
import { describe, expect, it } from 'vitest';
import { SecurityKeyArt } from '../src/screens/setup/SecurityKeyArt.js';
import { render } from './render.js';

describe('SecurityKeyArt', () => {
  it('is a marked placeholder of four generic shapes, with no brand in it', () => {
    const { host } = render(<SecurityKeyArt />);
    const fig = host.querySelector('[data-part="security-key-art"]')!;
    expect(fig.getAttribute('data-placeholder')).toBe('design-to-draw');
    expect(fig.querySelectorAll('svg')).toHaveLength(4);
    expect(fig.textContent).toContain('USB-A, USB-C, NFC cards and Lightning');
    expect(fig.textContent).not.toMatch(/YubiKey|Titan|Nitrokey|Feitian/i);
  });
});
