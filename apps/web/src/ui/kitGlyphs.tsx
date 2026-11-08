// Stroke glyphs for the design kit components (design kit handoff 8 Nov 2026; single-path data
// from docs/design-tools/gen/badge_parts.py `D`, `STORE` and craftkit on wip/design-brief). 24 view
// box, round caps and joins, stroke 1.75 unless the kit says otherwise. Always decorative: the text
// next to a glyph names what it stands for.
const D = {
  // Badges (kit 3.1).
  trusted: 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6zM9 12l2 2 4-4',
  clean: 'M3 12a9 9 0 1018 0a9 9 0 10-18 0M8 12.5l2.8 2.8L16.5 9',
  veteran: 'M7 9a5 5 0 1010 0a5 5 0 10-10 0M9 13.5L7.5 21l4.5-2.5 4.5 2.5L15 13.5',
  fast: 'M13 2L4 14h7l-1 8 9-12h-7z',
  pgp: 'M4 15a4 4 0 108 0a4 4 0 10-8 0M11 12l9-9M17 6l3 3',
  hw: 'M9.5 2.5h5A1.5 1.5 0 0116 4v5a1.5 1.5 0 01-1.5 1.5h-5A1.5 1.5 0 018 9V4a1.5 1.5 0 011.5-1.5zM6.5 10.5h11V15a5.5 5.5 0 01-11 0zM12 14v2.5',
  sprout: 'M12 21v-8M12 13c0-4 3-6 7-6 0 4-3 6-7 6zM12 15c0-3-2.5-5-6-5 0 3 2.5 5 6 5z',
  // Role tags and tiles (kit 2.2, 2.3).
  store: 'M4 9l1.5-5h13L20 9M4 9h16v2a3 3 0 01-5.3 1.9A3 3 0 0112 14a3 3 0 01-2.7-1.1A3 3 0 014 11zM5.5 14v6h13v-6',
  users: 'M5 20a4 4 0 018 0M6 11a3 3 0 106 0a3 3 0 10-6 0M14 20a4 4 0 016-3.5M15 9a2.5 2.5 0 105 0a2.5 2.5 0 10-5 0',
  'shield-outline': 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z',
  cpu: 'M7 7h10v10H7zM10 10h4v4h-4zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4',
  ban: 'M3 12a9 9 0 1018 0a9 9 0 10-18 0M6 6l12 12',
  // Controls.
  'chevron-down': 'M6 9l6 6 6-6',
  close: 'M6 6l12 12M18 6L6 18',
} as const;

export type KitGlyphName = keyof typeof D;

export function KitGlyph({ name, size, stroke = 1.75 }: { name: KitGlyphName; size: number; stroke?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={D[name]} />
    </svg>
  );
}
