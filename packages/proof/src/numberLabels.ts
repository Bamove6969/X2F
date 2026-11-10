// Field labels before a number on payment receipts (owner G17, 2026-11-07; F15, 2026-11-06): "read
// what the field is named prior to the number". A number right after one of these is blurred in
// proofs and refused in review notes, with the label's kind, even when it is short or equal to the
// trade amount. Data only: add labels here as feedback shows them (the owner plans to learn them per
// payment type from kept proofs). Same languages as `nameLabels.ts`.
//
// Each label is lower case, single-spaced; accents are optional when matching (OCR drops them). A
// label may be followed by `number`, `no.`, `nr`, `#`, `ending`, `ending in` and a colon before the
// number (`Account no.: 4821`, `Card ending in 7731`). Amount and trade-code labels, which keep a
// number clear, are in `detect.ts` (`AMOUNT_FIELD`, `TRADE_CODE_LABEL`).

export type NumberLabelKind = 'phone' | 'card' | 'iban' | 'account';

export const NUMBER_LABELS: Readonly<Record<NumberLabelKind, readonly string[]>> = {
  phone: [
    'phone', 'telephone', 'tel', 'mobile', 'mob', 'cell', 'cellphone', 'whatsapp', 'contact',
    'teléfono', 'telefono', 'móvil', 'celular', 'telefone', 'telemóvel', 'téléphone', 'portable', 'telefon', 'handy', 'telefoon', 'mobiel', 'gsm', 'cellulare',
  ],
  card: [
    'card', 'debit card', 'credit card', 'visa', 'mastercard', 'amex', 'maestro',
    'tarjeta', 'cartão', 'carte', 'karte', 'kaart', 'carta',
  ],
  iban: ['iban'],
  account: [
    'account', 'acct', 'acc', 'a/c', 'sort code', 'routing', 'aba', 'bsb', 'swift', 'bic', 'clabe', 'cbu', 'cvu', 'cpf', 'cnpj', 'ifsc', 'customer id', 'member id',
    'cuenta', 'número de cuenta', 'conta', 'número da conta', 'compte', 'numéro de compte', 'konto', 'kontonummer', 'rekening', 'rekeningnummer', 'conto',
  ],
};
