// Icons the dispute boards use that the UI kit has no shape for (copied from the boards). Kept here
// so the shared kit's icons.tsx is not touched by this task.
import type { ReactElement } from 'react';

const SHAPES = {
  eye: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 018 0v4" />
    </>
  ),
  doc: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h5" />
    </>
  ),
  chat: <path d="M4 5h16v11H8l-4 4z" />,
  send: <path d="M4 12l16-8-6 16-2-7z" />,
} satisfies Record<string, ReactElement>;

export function DisputeIcon({ name, size = 24, stroke = 1.5 }: { name: keyof typeof SHAPES; size?: number; stroke?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} aria-hidden="true" focusable="false">
      {SHAPES[name]}
    </svg>
  );
}
