/**
 * PLACEHOLDER ILLUSTRATION (signup round 3; owner's demo notes, 13 Nov 2026: "maybe a picture of ...
 * 4 or 5 different ones side by side ... as examples of what they can look like"). Design draws
 * the real one; until then, plain outlines of generic security keys in four shapes: USB-A, USB-C,
 * an NFC card and Lightning. No brand logos or trademarks: brands are named in text only (the
 * login step). Marked `data-placeholder` so it is easy to find and replace.
 */
import type { ReactElement } from 'react';

const SHAPES: { label: string; body: ReactElement }[] = [
  {
    label: 'USB-A',
    body: (
      <>
        <rect x="14" y="30" width="32" height="56" rx="8" />
        <rect x="20" y="10" width="20" height="20" rx="2" />
        <circle cx="30" cy="58" r="7" />
      </>
    ),
  },
  {
    label: 'USB-C',
    body: (
      <>
        <rect x="16" y="30" width="28" height="56" rx="8" />
        <rect x="23" y="16" width="14" height="14" rx="4" />
        <circle cx="30" cy="58" r="7" />
      </>
    ),
  },
  {
    label: 'NFC card',
    body: (
      <>
        <rect x="6" y="28" width="48" height="58" rx="6" />
        <path d="M24 50a8 8 0 010 14M29 46a14 14 0 010 22M34 42a20 20 0 010 30" />
      </>
    ),
  },
  {
    label: 'Lightning',
    body: (
      <>
        <rect x="16" y="30" width="28" height="56" rx="8" />
        <rect x="25" y="12" width="10" height="18" rx="3" />
        <circle cx="30" cy="58" r="7" />
      </>
    ),
  },
];

export function SecurityKeyArt() {
  return (
    <figure className="x2f-keyart" data-placeholder="design-to-draw" data-part="security-key-art">
      <div className="x2f-keyart__row" aria-hidden="true">
        {SHAPES.map((s) => (
          <svg key={s.label} className="x2f-keyart__key" viewBox="0 0 60 96" fill="none" stroke="currentColor" strokeWidth={2.5}>
            {s.body}
          </svg>
        ))}
      </div>
      {/* COPY-UNSIGNED */}
      <figcaption className="x2f-keyart__caption">Security keys come in many shapes: USB-A, USB-C, NFC cards and Lightning.</figcaption>
    </figure>
  );
}
