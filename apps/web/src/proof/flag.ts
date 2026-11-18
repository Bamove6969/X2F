/// <reference types="vite/client" />
/**
 * The one proof-upload flag (proof-receive review M4: one flag function). Its own small module, so
 * a screen can ask it (the quote screen's blur-check line, review of the proof stack S-M2) without
 * loading the upload itself.
 */

/** The upload screen is built but stays off unless the build says so (VITE_X2F_PROOF_UPLOAD=1). */
export function proofUploadOn(): boolean {
  // Written as the literal `import.meta.env.VITE_...` so Vite (and Vitest) replace it: a cast around
  // `import.meta` hides it from that, and the flag then reads undefined even when set to 1 (review M6,
  // proofUpload.test.ts).
  return (import.meta.env.VITE_X2F_PROOF_UPLOAD as string | undefined) === '1';
}
