# Landing and trader tour: decisions (owner note #47, confirmed 26 Nov)

The owner confirmed the recommended answers to the questions raised on `wip/agy-landing`. What was built:

- **R1. Diagonal "Welcome to":** shown on `/welcome`, stepping from the top-left down-right into the big centred logo, with the letter intro kept. It slides in as design's `front.md:61` says (420 ms, from (-24, -9) px and opacity 0; shown at once with reduced motion). The heading below still reads "Welcome to X2F" for screen readers, with "Welcome to" visually hidden so the words don't show twice.
- **R2. "Next screen" in the trader tour:** Next reads "Next screen" on the last stop of each page of the story tour, and "Done" on the last stop. This replaces `tour-stops.md:91`.
- **R3. Links on short screens:** FAQ, Getting started, Support and Settings stay visible under 760 px tall; the spacing and hero compact to fit them. This replaces `tour-motion.md` §2 item 6.
- **Font sizes:** unchanged; the owner decides those.
- **"Take the tour":** kept.
- **Support:** still goes to `/feedback`.
