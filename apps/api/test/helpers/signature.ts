import type { TermsSignature } from '../../src/termsSignature.js';

/** A Terms signature every sign-up in the tests sends (owner, 8 Nov 2026): an X on the pad. */
export const SIG: TermsSignature = { kind: 'drawn', width: 320, height: 120, path: 'M10 10L60 60M60 10L10 60' };
