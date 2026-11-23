// @vitest-environment happy-dom
// Owner demo note #98 (16 Nov 2026): "When I click in the box with the pgp message to copy and i do
// a ctrl-a it should limit the highlighting of text to only that in the message box". Every PGP
// message box is a MessageBox: focusable, and its Ctrl-A / Cmd-A selects only its own text.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MessageBox } from '../src/ui/MessageBox.js';
import { fire, render } from './render.js';

const SRC = join(import.meta.dirname, '../src/');
const MESSAGE = '-----BEGIN PGP MESSAGE-----\nhQEMA0xyz\n-----END PGP MESSAGE-----';

function key(el: Element, init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  fire(el, e);
  return e;
}

describe('note #98: Ctrl-A inside a PGP message box selects only the box', () => {
  it('is focusable, keeps the x2f-pre look and its own attributes', () => {
    const { host } = render(
      <MessageBox id="pgp-message" data-part="pgp-message">
        {MESSAGE}
      </MessageBox>,
    );
    const box = host.querySelector('pre')!;
    expect(box.id).toBe('pgp-message');
    expect(box.className).toBe('x2f-pre');
    expect(box.getAttribute('data-part')).toBe('pgp-message');
    expect(box.tabIndex).toBe(0);
  });

  it.each([
    ['Ctrl-A', { key: 'a', ctrlKey: true }],
    ['Cmd-A', { key: 'a', metaKey: true }],
    ['Ctrl-A with Caps Lock', { key: 'A', ctrlKey: true }],
  ])('%s selects the message and nothing else on the page', (_what, init) => {
    const { host } = render(
      <div>
        <p>Decrypt this message in your PGP app, then paste the code</p>
        <MessageBox>{MESSAGE}</MessageBox>
        <p>Text after the box</p>
      </div>,
    );
    const box = host.querySelector('pre')!;
    box.focus();
    const e = key(box, init);
    expect(e.defaultPrevented).toBe(true);
    expect(window.getSelection()!.toString()).toBe(MESSAGE);
  });

  it('leaves other keys alone (plain A, Ctrl-C, Ctrl-Shift-A)', () => {
    const { host } = render(<MessageBox>{MESSAGE}</MessageBox>);
    const box = host.querySelector('pre')!;
    for (const init of [{ key: 'a' }, { key: 'c', ctrlKey: true }, { key: 'a', ctrlKey: true, shiftKey: true }]) {
      expect(key(box, init).defaultPrevented, JSON.stringify(init)).toBe(false);
    }
  });

  it('every screen that shows an encrypted PGP message uses MessageBox (never a bare <pre>)', () => {
    const screens = ['screens/auth/Login.tsx', 'screens/auth/MemberInvite.tsx', 'screens/auth/ConfirmSheet.tsx', 'screens/settings/Methods.tsx', 'screens/setup/PgpChallenge.tsx'];
    for (const f of screens) {
      const src = readFileSync(SRC + f, 'utf8');
      expect(src, f).toMatch(/<MessageBox[^>]*>\s*\{[^}]*encryptedMessage\}\s*<\/MessageBox>/);
      expect(src, f).not.toMatch(/<pre[^>]*>\s*\{[^}]*encryptedMessage\}/);
    }
  });
});
