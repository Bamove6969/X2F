# Lead review: proof core fix round @210fdf53 (RV4 I1, M1-M3)
Verdict: APPROVED. Read the detect.ts diff; ran 22 attack inputs against detectSensitive in a throwaway worktree.
- I1 fixed: spaced dash, slash, dot, double dash and wide-space card and phone forms all fully masked when a group equals the amount, including the review's three failing rows.
- Amounts stay clear: "Amount 1111", "Total $1,111.00", "Paid 1111 USD", "1,111.00", "Sent 412.50 to John", "Sent $412 to bob", bare "412".
- Known residual, accepted: "4111 1111 1111 1111.00" at 1111.00 leaves the last group visible as the amount; the other groups are masked, and a card number does not end in .00.
- Not separately reviewed: M4 and the re-merges; they ride the landing's full check.
