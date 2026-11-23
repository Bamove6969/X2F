/**
 * Owner demo note #108 (17 Nov 2026): "Do not allow spaces in username or passwords or display
 * names". The staff app's name ("Username", the display name staff see) is said to hold no spaces
 * as soon as one is typed, in the trader app's words (apps/web/src/screens/setup/names.ts). The API
 * refuses it too (`assertNewNames`, 400 `display-name-invalid`).
 */

/** Whether a typed name holds a space or other white space inside it (the ends are trimmed off). */
export const hasSpace = (s: string): boolean => /\s/u.test(s.trim());

/** COPY-UNSIGNED (owner demo note #108): the inline line under the display name field. */
export const DISPLAY_NAME_SPACES = 'Remove the spaces. A display name has no spaces.';
