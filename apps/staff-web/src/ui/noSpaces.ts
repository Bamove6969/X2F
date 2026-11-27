/**
 * Owner demo note #108 (17 Nov 2026): "Do not allow spaces in username or passwords or Trade
 * Tags". The staff app's name ("Username", the Trade Tag staff see) is said to hold no spaces
 * as soon as one is typed, in the trader app's words (apps/web/src/screens/setup/names.ts). The API
 * refuses it too (`assertNewNames`, 400 `trade-tag-invalid`).
 */

/** Whether a typed name holds a space or other white space inside it (the ends are trimmed off). */
export const hasSpace = (s: string): boolean => /\s/u.test(s.trim());

/** COPY-UNSIGNED (owner demo note #108): the inline line under the Trade Tag field. */
export const TRADE_TAG_SPACES = 'Remove the spaces. A Trade Tag has no spaces.';
