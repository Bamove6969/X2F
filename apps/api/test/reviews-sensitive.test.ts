import { describe, expect, it } from 'vitest';
import { hasPersonalDetails } from '../src/reviews/sensitive.js';

// Plan 5 Task 3 + Task 7: review notes are checked with @x2f/proof's detectSensitiveText, so notes
// follow the owner's rules as built there (owner answers 2026-10-30 line 85, 2026-11-02 items 29, 34,
// 36, 37 and Q13-Q16). The route-level refusal is in reviews.test.ts.
describe('review notes refuse personal details (detectSensitiveText)', () => {
  it('refuses every personal-detail kind, UPI IDs included (owner 2026-11-02 07:10: notes refuse all, incl. UPI)', () => {
    for (const note of [
      'mail me at bob@example.com',
      'call +1 555 123 4567',
      '+34 612 345 678',
      'IBAN DE89 3704 0044 0532 0130 00',
      '4111-1111-1111-1111',
      `4${'A'.repeat(94)}`,
      'pay jane@okaxis',
      'call 6123456789',
    ]) {
      expect(hasPersonalDetails(note), note).toBe(true);
    }
  });

  it('allows what is not a detail: amounts with separators (item 29, Q13-Q15), decimals, dates, year ranges', () => {
    for (const note of [
      'Smooth one',
      'paid 1,250,000 COP',
      'paid 1.250.000',
      'paid 1 250 000',
      "paid 1'250'000",
      'paid 0.12345678 XMR',
      'paid on 2026-11-05',
      'trading with them 2023 - 2026',
    ]) {
      expect(hasPersonalDetails(note), note).toBe(false);
    }
  });

  it('leaves handles, street addresses and names to the person reviewed to report (owner Q16)', () => {
    for (const note of ['@janedoe on telegram', 'met at 12 Main St', 'name: Jane Doe']) {
      expect(hasPersonalDetails(note), note).toBe(false);
    }
  });
});
