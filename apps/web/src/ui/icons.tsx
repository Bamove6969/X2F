import type { ReactElement } from 'react';

// Icon shapes copied from the X2F App boards (design/x2f-app/*.dc.html): 24×24 view box, stroked
// with currentColor, so each icon takes the state colour of its context (design-system README).
const SHIELD = 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z';

const SHAPES = {
  'chevron-left': <path d="M15 18l-6-6 6-6" />,
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  // Main board: the search box; BuyQuote board: the Chat button.
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4-4" />
    </>
  ),
  chat: <path d="M4 5h16v11H9l-5 4z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </>
  ),
  check: <path d="M5 12l4 4 10-10" />,
  // Refunded board: the XMR went back.
  undo: (
    <>
      <path d="M9 14l-5-5 5-5" />
      <path d="M4 9h11a5 5 0 010 10h-3" />
    </>
  ),
  shield: <path d={SHIELD} />,
  // LoginApprove board: a blocked login.
  'shield-x': (
    <>
      <path d={SHIELD} />
      <path d="M9.5 9.5l5 5M14.5 9.5l-5 5" />
    </>
  ),
  // LoginApprove board: a login let in.
  'check-circle': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12l3 3 5-6" />
    </>
  ),
  // Devices board: a phone and a computer in the device list, the team members card.
  phone: (
    <>
      <rect x="7" y="3" width="10" height="18" rx="2" />
      <path d="M11 18h2" />
    </>
  ),
  computer: (
    <>
      <rect x="4" y="5" width="16" height="11" rx="1.5" />
      <path d="M2 19h20" />
    </>
  ),
  team: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M17 14c2.8 0 4.5 1.9 4.5 4.5" />
    </>
  ),
  'shield-check': (
    <>
      <path d={SHIELD} />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  'shield-clock': (
    <>
      <path d={SHIELD} />
      <path d="M12 8v4l2 2" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3l9 16H3z" />
      <path d="M12 10v4" />
      <path d="M12 17h.01" />
    </>
  ),
  bolt: <path d="M13 3L5 13h6l-1 8 8-10h-6z" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 018 0v3" />
    </>
  ),
  star: <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />,
  'security-key': (
    <>
      <rect x="7" y="9" width="10" height="12" rx="2" />
      <path d="M10 9V4h4v5" />
      <path d="M12 14v2" />
    </>
  ),
  'pgp-key': (
    <>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l9-9" />
      <path d="M17 6l3 3" />
    </>
  ),
  sprout: (
    <>
      <path d="M12 21v-8" />
      <path d="M12 13c0-4 3-6 7-6 0 4-3 6-7 6z" />
      <path d="M12 15c0-3-2-5-6-5 0 3 2 5 6 5z" />
    </>
  ),
  bell: (
    <>
      <path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 003.4 0" />
    </>
  ),
  // Two ticks (News board "Mark all as read").
  'check-double': (
    <>
      <path d="M2 12l5 5L18 6" />
      <path d="M12 16l1 1 9-11" />
    </>
  ),
  // The ringing bell (SellerRefund board "Nudge mira.k").
  'bell-ring': (
    <>
      <path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 003.4 0" />
      <path d="M2 4l2 2" />
      <path d="M22 4l-2 2" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4l-9 9" />
      <path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" />
    </>
  ),
  trade: (
    <>
      <path d="M7 7h13l-3-3" />
      <path d="M17 17H4l3 3" />
    </>
  ),
  'plus-circle': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
  wallet: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M16 12h2" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1-4 4-6 8-6s7 2 8 6" />
    </>
  ),
} satisfies Record<string, ReactElement>;

export type IconName = keyof typeof SHAPES;

export function Icon({ name, size = 24, stroke = 1.5 }: { name: IconName; size?: number; stroke?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      aria-hidden="true"
      focusable="false"
    >
      {SHAPES[name]}
    </svg>
  );
}

export type IconTone = 'escrow' | 'danger' | 'caution' | 'muted';

/**
 * A state icon above a heading (LoginApprove board: the escrow check for a login let in, the danger
 * shield for a blocked one): visual system v2, a 28 px icon at stroke 1.75 in a 56 px tinted tile
 * (ui.css). Decorative: the heading says what happened.
 */
export function StatusIcon({ name, tone, size = 28 }: { name: IconName; tone: IconTone; size?: number }) {
  return (
    <span className="x2f-status-icon" data-icon-tone={tone}>
      <Icon name={name} size={size} stroke={1.75} />
    </span>
  );
}
