// @vitest-environment happy-dom
// Plan 5 Task 15: SendUnblurred on DisputeRoom (DisputeRoom board, "Unblurred copy · moderator only").
// After a moderator asks THIS trader (the dispute view's `proofRequest`, Plan 4 Task 11), the trader
// picks the screenshot again (Review Focus 4: no original is kept on the device), it is stripped,
// never blurred (proof/upload.ts prepareUnblurred and sendUnblurred: the privacy of the send itself
// is proofUpload.test.ts's), uploaded as kind=unblurred and its key sealed to the moderator only.
// Then the board's "Sent to <mod> at 10:58", and the system card "You sent an unblurred proof to the
// moderator only" from the server's own record (`proofRequest.sentAt`).
import { act } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatFailed } from '../src/chat/client.js';
import { parseDispute, type DisputeTrade, type DisputeView } from '../src/screens/dispute/api.js';
import { systemCardsFor, UnblurredRequest } from '../src/screens/dispute/seams.js';
import { DisputeRoom } from '../src/screens/dispute/DisputeRoom.js';
import { PROOF_CANT_USE, ProofInputError, type UnblurredPicture } from '../src/proof/upload.js';
import { PROOF_SEND_FAILED, PROOF_SEND_UNCERTAIN } from '../src/screens/proof/AddProof.js';
import { SendUnblurred, UNBLURRED_PICK_AGAIN, UNBLURRED_SENT_CARD, unblurredAsk } from '../src/screens/proof/SendUnblurred.js';
import { fire, render } from './render.js';

const CODE = 'K7M2-9QXA-4FTR-8WPN';
const ASKED = '2026-10-15T10:53:00.000Z';
const SENT = '2026-10-15T10:58:00.000Z';
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); });
const click = (el: Element | null) => fire(el!, new MouseEvent('click', { bubbles: true }));
const file = () => new File([new Uint8Array([1, 2, 3])], 'IMG_2041 bank.png', { type: 'image/png' });
const picture = (): UnblurredPicture => ({ rgba: new Uint8ClampedArray(4 * 4 * 4).fill(9), width: 4, height: 4 });
function pickIn(host: HTMLElement) {
  const input = host.querySelector<HTMLInputElement>('input[type=file]')!;
  Object.defineProperty(input, 'files', { value: [file()] });
  fire(input, new Event('change', { bubbles: true }));
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('SendUnblurred', () => {
  it('says who asked and that the other side never sees it; the board button picks the file again', () => {
    const r = render(<SendUnblurred code={CODE} request={{ username: 'sarah.v', at: ASKED, sentAt: null }} counterparty="satoshi_ghost" />);
    expect(r.host.textContent).toContain(unblurredAsk('sarah.v', 'satoshi_ghost'));
    expect(r.host.textContent).toContain('satoshi_ghost won');
    expect(r.host.textContent).toContain(UNBLURRED_PICK_AGAIN);
    const label = [...r.host.querySelectorAll('label')].find((l) => l.textContent?.includes('Send unblurred proof to sarah.v'))!;
    expect(label).toBeTruthy();
    const input = r.host.querySelector<HTMLInputElement>('input[type=file]')!;
    expect(label.htmlFor).toBe(input.id);
    expect(input.accept).toBe('image/*');
    // Exactly one primary action on the card.
    expect(r.host.querySelectorAll('[data-primary]').length).toBeLessThanOrEqual(1);
  });

  it('pick, strip, send: the picture goes to the send once, then "Sent to sarah.v at" and no picker', async () => {
    const prepare = vi.fn(async () => picture());
    const send = vi.fn(async () => ({ proofId: 'X' }));
    const onSent = vi.fn();
    const r = render(<SendUnblurred code={CODE} request={{ username: 'sarah.v', at: ASKED, sentAt: null }} counterparty="satoshi_ghost" prepare={prepare} send={send} onSent={onSent} now={() => new Date(SENT)} />);
    pickIn(r.host);
    await flush();
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toMatchObject({ code: CODE });
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(r.host.textContent).toContain('Sent to sarah.v at 10:58');
    expect(r.host.querySelector('input[type=file]')).toBeNull();
    // The file's name is never shown.
    expect(r.host.textContent).not.toContain('IMG_2041');
  });

  it("an image that can't be used, a failed send and an uncertain one each say so; the picker stays", async () => {
    const cases: [unknown, string][] = [
      [new ProofInputError('undecodable'), PROOF_CANT_USE],
      [new Error('offline'), PROOF_SEND_FAILED],
      [new ChatFailed('uncertain'), PROOF_SEND_UNCERTAIN],
    ];
    for (const [err, line] of cases) {
      const r = render(
        <SendUnblurred
          code={CODE}
          request={{ username: 'sarah.v', at: ASKED, sentAt: null }}
          counterparty="satoshi_ghost"
          prepare={async () => (err instanceof ProofInputError ? Promise.reject(err) : picture())}
          send={async () => Promise.reject(err)}
        />,
      );
      pickIn(r.host);
      await flush();
      expect(r.host.textContent).toContain(line);
      expect(r.host.querySelector('input[type=file]')).not.toBeNull();
      expect(r.host.textContent).not.toContain('Sent to');
      r.unmount();
    }
  });

  it('a request already answered (sentAt from the server) shows only the sent line', () => {
    const r = render(<SendUnblurred code={CODE} request={{ username: 'sarah.v', at: ASKED, sentAt: SENT }} counterparty="satoshi_ghost" />);
    expect(r.host.textContent).toContain('Sent to sarah.v at 10:58');
    expect(r.host.querySelector('input[type=file]')).toBeNull();
  });
});

function trade(over: Partial<DisputeTrade> = {}): DisputeTrade {
  return {
    code: CODE,
    role: 'buyer',
    state: 'disputed',
    counterparty: 'satoshi_ghost',
    methodId: 'ZELLE',
    whatItIs: 'Zelle: a US bank-to-bank instant transfer built into most US banking apps.',
    amountAtomic: '1250000000000',
    poster: 'seller',
    currency: 'USD',
    paidAt: '2026-10-15T10:00:00.000Z',
    confirmBy: '2026-10-15T11:30:00.000Z',
    confirmWindowMin: 90,
    settleBy: null,
    closedAt: null,
    dispute: null,
    serverNow: '2026-10-15T11:00:00.000Z',
    ...over,
  };
}
function dispute(over: Partial<DisputeView> = {}): DisputeView {
  return {
    openedBy: 'buyer',
    reason: 'paid',
    openedAt: '2026-10-15T10:14:00.000Z',
    afterRefund: false,
    dueAt: '2026-10-16T10:14:00.000Z',
    status: 'open',
    moderator: { name: 'sarah.v', joinedAt: '2026-10-15T10:52:00.000Z' },
    ruling: null,
    appeal: null,
    serverNow: '2026-10-15T11:00:00.000Z',
    ...over,
  };
}

describe('the dispute room wiring (seams.tsx, DisputeRoom)', () => {
  it('parseDispute reads proofRequest.sentAt; an older view without it reads null', () => {
    const base = { ...dispute(), incidentId: null };
    expect(parseDispute({ ...base, proofRequest: { username: 'sarah.v', at: ASKED, sentAt: SENT } }).proofRequest).toEqual({ username: 'sarah.v', at: ASKED, sentAt: SENT });
    expect(parseDispute({ ...base, proofRequest: { username: 'sarah.v', at: ASKED } }).proofRequest).toEqual({ username: 'sarah.v', at: ASKED, sentAt: null });
    expect(() => parseDispute({ ...base, proofRequest: { username: 'sarah.v', at: ASKED, sentAt: 'soon' } })).toThrow();
  });

  it('UnblurredRequest shows SendUnblurred only with the upload flag, for a request on an open dispute', () => {
    const asked = dispute({ proofRequest: { username: 'sarah.v', at: ASKED, sentAt: null } });
    expect(render(<UnblurredRequest trade={trade()} dispute={asked} />).host.textContent).toBe('');
    vi.stubEnv('VITE_X2F_PROOF_UPLOAD', '1');
    expect(render(<UnblurredRequest trade={trade()} dispute={asked} />).host.textContent).toContain('Send unblurred proof to sarah.v');
    expect(render(<UnblurredRequest trade={trade()} dispute={dispute()} />).host.textContent).toBe('');
    expect(render(<UnblurredRequest trade={trade()} dispute={{ ...asked, status: 'closed' }} />).host.textContent).toBe('');
  });

  it('the system card and the evidence chip come from the server record (sentAt), for the side that sent it', () => {
    const sent = dispute({ proofRequest: { username: 'sarah.v', at: ASKED, sentAt: SENT } });
    expect(systemCardsFor(trade(), sent)).toContainEqual({ at: SENT, text: UNBLURRED_SENT_CARD });
    expect(UNBLURRED_SENT_CARD).toBe('You sent an unblurred proof to the moderator only');
    expect(systemCardsFor(trade(), dispute({ proofRequest: { username: 'sarah.v', at: ASKED, sentAt: null } }))).not.toContainEqual(expect.objectContaining({ text: UNBLURRED_SENT_CARD }));
    const room = render(<MemoryRouter><DisputeRoom trade={trade()} methodName="Zelle" dispute={sent} serverClock={() => new Date('2026-10-15T11:00:00Z')} chat={<div />} unblurred={<div />} /></MemoryRouter>);
    expect([...room.host.querySelectorAll('.dispute-evidence-chip')].map((c) => c.textContent)).toContain('Unblurred copy · moderator only');
    const before = render(<MemoryRouter><DisputeRoom trade={trade()} methodName="Zelle" dispute={dispute()} serverClock={() => new Date('2026-10-15T11:00:00Z')} chat={<div />} unblurred={<div />} /></MemoryRouter>);
    expect(before.host.textContent).not.toContain('Unblurred copy');
  });
});
