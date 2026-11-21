/**
 * Plan 4 Task 21: the dispute steps the end-to-end specs share (disputes.e2e.spec.ts), each as a
 * trader or a staff member does it in their browser: the trader's Open dispute, the moderator's
 * take, device check, chat and ruling with a key tap on the case page, and the checks of where the
 * coins landed (the receiving wallets themselves, in exact atomic amounts).
 */
import { expect, type Page } from '@playwright/test';
import { feeWallet, mine, sql, type Trader } from '../../web/e2e/regtestKit.js';
import { incomingTxs, LONG, receivedIn, shows, untilState, type Open, type TradeView } from '../../web/e2e/tradeFlow.js';
import { owner, type Staffer } from './staffKit.js';

/** A dispute's room on the trader side. */
export const disputeUrl = (code: string) => `/trade/${encodeURIComponent(code)}/dispute`;
/** A case on the staff side. */
export const caseUrl = (code: string) => `/disputes/${encodeURIComponent(code)}`;

/**
 * The payment method's wait after "I've paid" is over (the seller stayed silent past confirmBy):
 * one update in this run's throwaway database, as the trade specs shorten fund_by.
 */
export async function pastConfirmBy(code: string): Promise<void> {
  const rows = await sql("update trades set confirm_by = now() - interval '1 second' where code = $1 and state = 'paid' returning code", [code]);
  if (rows.length !== 1) throw new Error(`trade ${code} is not paid`);
}

/** The buyer's room: Open dispute, the reason, a note, Open dispute. Ends on the dispute room. */
export async function openDispute(page: Page, code: string, o: { reason: RegExp; note: string }): Promise<void> {
  await page.goto(`/trade/${encodeURIComponent(code)}`);
  const open = page.getByRole('button', { name: 'Open dispute', exact: true });
  await expect(open).toBeEnabled({ timeout: LONG });
  await open.click();
  await page.waitForURL(/\/dispute$/);
  await page.getByRole('radio', { name: o.reason }).check();
  await page.getByLabel('Tell the moderator what happened').fill(o.note);
  await page.locator('.dispute-footer').getByRole('button', { name: 'Open dispute' }).click();
  await expect(page.locator('.dispute-footer')).toHaveCount(0, { timeout: LONG });
}

/** The staff page shows the case; the moderator takes it when it is not theirs yet. */
export async function takeCase(page: Page, code: string): Promise<void> {
  await page.goto(caseUrl(code));
  await expect(page.locator('[data-part="case-chips"]')).toBeVisible({ timeout: LONG });
  const take = page.getByRole('button', { name: 'Take this case' });
  if (await take.isVisible()) {
    await take.click();
    await expect(page.locator('[data-part="case-chips"]')).toContainText('Assigned to you');
  }
}

/** Taps the security key in the open KeyTapDialog (the virtual authenticator answers). */
export async function tapKey(page: Page): Promise<void> {
  const dialog = page.locator('[data-part="key-tap"]');
  await expect(dialog).toBeVisible();
  // The dialog's first button is its tap ("Tap security key", or the screen's own words such as "Tap key and pause").
  await dialog.getByRole('button').first().click();
  await expect(dialog).toHaveCount(0, { timeout: 60_000 });
}

/** The moderator confirms this device with a tap (once per browser) and opens the full chat. */
export async function openChat(page: Page): Promise<void> {
  const chat = page.locator('[data-part="chat"]');
  const confirm = chat.getByRole('button', { name: 'Confirm this device' });
  await expect(confirm.or(chat.locator('[data-part="device-certified"]'))).toBeVisible({ timeout: LONG });
  if (await confirm.isVisible()) {
    await confirm.click();
    await tapKey(page);
  }
  await expect(chat.locator('[data-part="device-certified"]')).toBeVisible({ timeout: LONG });
  const open = chat.getByRole('button', { name: 'Open the full chat' });
  await expect(open).toBeEnabled({ timeout: LONG });
  await open.click();
  await expect(chat.locator('[data-part="chat-lines"]')).toBeVisible({ timeout: LONG });
}

/** "Message both traders": the text, Send, "Sent and logged." */
export async function messageBoth(page: Page, text: string): Promise<void> {
  const card = page.locator('[data-part="message"]');
  await card.getByLabel('Message both traders').fill(text);
  await card.getByRole('button', { name: 'Send' }).click();
  await expect(card.getByText('Sent and logged.')).toBeVisible({ timeout: LONG });
}

export const REASON = 'The buyer showed the payment and the seller never answered in the chat.';

/** "Your ruling": the outcome, a reason, Send ruling (or Send ruling for approval), and the tap. */
export async function proposeRuling(page: Page, outcome: string, reason = REASON): Promise<void> {
  const card = page.locator('[data-part="ruling"]');
  await expect(card).toBeVisible({ timeout: LONG });
  await card.locator('[data-part="ruling-outcome"]').getByText(outcome, { exact: true }).click();
  await card.getByLabel('Reason (required, both traders see it)').fill(reason);
  await card.getByRole('button', { name: /^Send ruling/ }).click();
  await tapKey(page);
}

/** A senior moderator or the owner approves the waiting ruling with a tap. */
export async function approveRuling(page: Page): Promise<void> {
  const approve = page.getByRole('button', { name: 'Approve ruling' });
  await expect(approve).toBeVisible({ timeout: LONG });
  await approve.click();
  await tapKey(page);
}

/** The trade's settlement tx once the API records the ruling's payout (mining meanwhile). */
export async function settled(t: Trader, code: string, state: 'released' | 'refunded', timeoutMs = 2 * LONG): Promise<string> {
  const v = await untilState(t, code, [state], timeoutMs);
  expect(v.txHash).toMatch(/^[0-9a-f]{64}$/);
  return v.txHash!;
}

/** The network fee a transaction paid, from the node itself (atomic). */
export { txFee } from '../../web/e2e/regtestKit.js';

/** Exactly what the fee wallet received in `txHash`. */
export async function feeIn(txHash: string): Promise<bigint> {
  const fw = await feeWallet();
  try {
    return await receivedIn(fw, txHash);
  } finally {
    await fw.close();
  }
}

/**
 * Every transaction the trade's three receiving wallets saw after `before` (their incoming tx
 * hashes then): one settlement only, never a second broadcast.
 */
export async function newTxs(o: Open, before: { buyer: Set<string>; seller: Set<string> }): Promise<Set<string>> {
  await mine(1);
  const now = { buyer: await incomingTxs(o.buyer.wallet), seller: await incomingTxs(o.seller.wallet) };
  const out = new Set<string>();
  for (const side of ['buyer', 'seller'] as const) for (const h of now[side]) if (!before[side].has(h)) out.add(h);
  return out;
}

export interface LogLine {
  action: string;
  at: string;
}

/** The activity log for `code`, oldest first, as the owner reads it (GET /staff/v1/log?code=). */
export async function logFor(code: string): Promise<string[]> {
  const o = await owner();
  const r = await o.client.ok<{ entries: Array<{ action: string; at: string }> }>('GET', `/staff/v1/log?code=${encodeURIComponent(code)}&limit=200`);
  return r.entries.map((e) => e.action).reverse();
}

/** `steps` appear in `log` in this order (other entries may come between). */
export function inOrder(log: string[], steps: string[]): boolean {
  let i = 0;
  for (const a of log) if (a === steps[i]) i++;
  return i === steps.length;
}

/** Waits until the page's text shows `re` (no mining). */
export const sees = (page: Page, re: RegExp, timeout = LONG) => shows(page, re, timeout);

export type { Staffer, TradeView };

/** The trader's ruling card: Appeal this ruling, the reason, Send appeal. */
export async function appeal(page: Page, why: string): Promise<void> {
  const card = page.getByRole('region', { name: 'Appeal' });
  await card.getByRole('button', { name: 'Appeal this ruling' }).click();
  await card.getByLabel('Why should it be looked at again?').fill(why);
  await card.getByRole('button', { name: 'Send appeal' }).click();
  await expect(card.getByRole('button', { name: 'Send appeal' })).toHaveCount(0, { timeout: LONG });
}

/** The case's status as the owner's staff API reports it. */
export async function caseOf(code: string): Promise<{ status: string; assignee: string | null; round: number }> {
  const o = await owner();
  return o.client.ok('GET', `/staff/v1/disputes/${encodeURIComponent(code)}`);
}
