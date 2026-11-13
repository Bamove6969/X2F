/**
 * The welcome screen shows once per device (owner, 12 Nov 2026, demo note #47; lead reading of "the
 * first screen"): kept in localStorage, never sent anywhere. A store that throws (private mode) falls
 * back to memory for the page's life. Settings keeps a way back to it (`WELCOME_PATH`).
 */
export const WELCOME_SEEN_KEY = 'x2f.welcome.seen';
export const WELCOME_PATH = '/welcome';

let memory = false;

export function welcomeSeen(): boolean {
  if (memory) return true;
  try {
    return window.localStorage.getItem(WELCOME_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markWelcomeSeen(): void {
  memory = true;
  try {
    window.localStorage.setItem(WELCOME_SEEN_KEY, '1');
  } catch {
    // Memory only (private mode).
  }
}

/** Tests only: forget the in-memory fallback. */
export function resetWelcomeMemory(): void {
  memory = false;
}
