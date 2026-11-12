import { describe, expect, it } from 'vitest';
import { NAME_LABELS } from '../src/nameLabels.js';

describe('name labels data (owner item 30)', () => {
  it('holds English and the other languages, each with labels', () => {
    for (const lang of ['en', 'es', 'de', 'fr', 'nl', 'it', 'pt', 'ru', 'tr']) {
      expect(NAME_LABELS[lang]?.labels.length, lang).toBeGreaterThan(0);
    }
  });

  it('keeps the English labels as built', () => {
    expect([...NAME_LABELS.en!.labels].sort()).toEqual(
      ['account holder', 'beneficiary', 'recipient', 'paid to', 'sent to', 'sender', 'payee', 'payer', 'name', 'from', 'to'].sort(),
    );
  });

  it('labels are lower case, trimmed, single-spaced and not repeated within a language', () => {
    for (const [lang, set] of Object.entries(NAME_LABELS)) {
      const all = [...set.labels, ...set.colonOnly];
      expect(new Set(all).size, lang).toBe(all.length);
      for (const l of all) expect(l, lang).toMatch(/^\S+(?: \S+)*$/u);
      for (const l of all) expect(l, lang).toBe(l.toLowerCase());
    }
  });

  it('P-014: Russian and Turkish hold the main receipt name labels', () => {
    for (const l of ['получатель', 'отправитель', 'плательщик', 'фио', 'имя']) expect(NAME_LABELS.ru!.labels, l).toContain(l);
    for (const l of ['alıcı', 'gönderen', 'hesap sahibi', 'ad soyad', 'isim']) expect(NAME_LABELS.tr!.labels, l).toContain(l);
  });
});
