// Name labels on payment receipts, per language (Plan 5 Task 7, owner item 30, 2026-11-02): the
// detector masks the name after any of them. Data only: add labels here as feedback shows them.
// Best effort: the owner asked for "a database of foreign-language name labels as best we can";
// the detector is a safety net (owner item 35), the sender always sees the blur and can add more.
//
// The app ships no other language yet (no locales in apps/web), so the languages are those of the
// countries the plans name (US UK CA DE FR NL ES IT BE PT; Belgium is Dutch and French).
//
// Each label is lower case, single-spaced; accents are optional when matching (OCR drops them).
// `labels` count at the start of a line with or without a colon (`Empfänger Max`), and later in a
// line with a colon. `colonOnly` are short words that are also everyday prepositions (`De nada`,
// `Van harte`, `Para su seguridad`, review RV4-M3): they count only when a colon follows them.

export interface LabelSet {
  readonly labels: readonly string[];
  readonly colonOnly: readonly string[];
}

export const NAME_LABELS: Readonly<Record<string, LabelSet>> = {
  en: {
    labels: ['account holder', 'beneficiary', 'recipient', 'paid to', 'sent to', 'sender', 'payee', 'payer', 'name', 'from', 'to'],
    colonOnly: [],
  },
  es: {
    labels: ['titular de la cuenta', 'titular', 'beneficiario', 'destinatario', 'ordenante', 'remitente', 'emisor', 'receptor', 'nombre', 'enviado a', 'pagado a'],
    colonOnly: ['de', 'a', 'para'],
  },
  de: {
    labels: ['kontoinhaber', 'inhaber', 'zahlungsempfänger', 'empfänger', 'begünstigter', 'auftraggeber', 'absender', 'zahler', 'überwiesen an', 'gesendet an', 'bezahlt an'],
    colonOnly: ['an', 'von'],
  },
  fr: {
    labels: ['titulaire du compte', 'titulaire', 'bénéficiaire', 'destinataire', 'émetteur', 'expéditeur', "donneur d'ordre", 'payeur', 'nom', 'payé à', 'envoyé à'],
    colonOnly: ['de', 'à'],
  },
  nl: {
    labels: ['rekeninghouder', 'tenaamstelling', 'begunstigde', 'ontvanger', 'afzender', 'opdrachtgever', 'betaler', 'naam', 'betaald aan', 'verzonden naar'],
    colonOnly: ['van', 'aan', 'naar'],
  },
  it: {
    labels: ['intestatario', 'titolare', 'beneficiario', 'destinatario', 'ordinante', 'mittente', 'nominativo', 'nome', 'pagato a', 'inviato a'],
    colonOnly: ['da', 'a'],
  },
  pt: {
    labels: ['titular', 'beneficiário', 'destinatário', 'favorecido', 'remetente', 'ordenante', 'pagador', 'recebedor', 'nome', 'pago a', 'enviado para'],
    colonOnly: ['de', 'para'],
  },
};
