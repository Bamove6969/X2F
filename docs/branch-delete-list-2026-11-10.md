# Branch delete list 2026-11-10 (claude2), ready for the lead

Final list from the proposals in docs/branch-audit-2026-11-09.md (37 proposed: 34 MERGED, 3 SUPERSEDED). Nothing was deleted by claude2; the lead runs the block below.

Re-checked 2026-11-10 ~00:50 UTC after `git fetch origin --prune` against origin/main = `58f3d186` (batch 3) and origin/wip/lead-land-4 = `36458444` (batch 4, landing tonight). A branch is listed only if, against BOTH, `git rev-list --count origin/main..origin/<b>` is 0 or `git cherry` shows only '-' lines.

## Result: 26 branches to delete (of 37 proposed)

| Branch | Head SHA | Last commit | Why it qualifies |
|---|---|---|---|
| `wip/lead-batch4` | `e667c3ce009ca37ab1287652f9a41eaea32a3c6f` | 2026-11-06 | MERGED: head in origin/main (0 ahead); also 0 ahead / all '-' vs wip/lead-land-4 |
| `wip/lead-design-fold` | `e02c1e986f49fdb7b9876ac89ff2d061e2d782bc` | 2026-11-02 | MERGED: head in origin/main (0 ahead); also 0 ahead / all '-' vs wip/lead-land-4 |
| `wip/lead-sonar-action` | `8cfa0d4496692fd628482ad769fa16fda9c25349` | 2026-11-06 | MERGED: head in origin/main (0 ahead); also 0 ahead / all '-' vs wip/lead-land-4 |
| `wip/second-design-offers-v2` | `1e890b1351fbb3bd732fecae5404798c0935e62c` | 2026-11-06 | MERGED: head in origin/main (0 ahead); also 0 ahead / all '-' vs wip/lead-land-4 |
| `wip/second-design-selection` | `67336d491457303252e8bbc18d60da18a6ad8a30` | 2026-11-02 | MERGED: head in origin/main (0 ahead); also 0 ahead / all '-' vs wip/lead-land-4 |
| `wip/second-p3-task10` | `305124b7adef8bba1b63a5491c0c1750a770046b` | 2026-10-30 | MERGED: head in origin/main (0 ahead); also 0 ahead / all '-' vs wip/lead-land-4 |
| `wip/second-p3-task9-view` | `99ba09fc7b3f9367ecf21cae68c3981030b8a644` | 2026-10-30 | MERGED: head in origin/main (0 ahead); also 0 ahead / all '-' vs wip/lead-land-4 |
| `wip/third-design-build` | `7f6cafc044ec509da6865b2b72474b5a3331beee` | 2026-11-07 | MERGED: head in origin/main (0 ahead); also 0 ahead / all '-' vs wip/lead-land-4 |
| `wip/third-feedback-form-limit` | `70821e984ef50e015634e055a97e7c1286921082` | 2026-11-06 | MERGED: head in origin/main (0 ahead); also 0 ahead / all '-' vs wip/lead-land-4 |
| `wip/third-p4-reverify` | `d41c8fb1fd08063d4af47fbdb47c2f3b9cc73cfe` | 2026-11-07 | MERGED: head in origin/main (0 ahead); also 0 ahead / all '-' vs wip/lead-land-4 |
| `wip/third-p4-staff-trader-split` | `b8cdef6bfd2e2e71a061526e789fc2f1ef14ac58` | 2026-11-06 | MERGED: head in origin/main (0 ahead); also 0 ahead / all '-' vs wip/lead-land-4 |
| `wip/third-p4-task10` | `3d678a338c40d6cd55442b6709d6ba5cd3d9c564` | 2026-11-03 | MERGED: head in origin/main (0 ahead); also 0 ahead / all '-' vs wip/lead-land-4 |
| `wip/third-p4-task15` | `5b5a5cbf7f356afd856a7df760d458e4d5f61438` | 2026-11-07 | MERGED: head in origin/main (0 ahead); also 0 ahead / all '-' vs wip/lead-land-4 |
| `wip/third-p4-task4` | `eee547f271ef257d8b126df8a192a8ccc6256643` | 2026-11-06 | MERGED: head in origin/main (0 ahead); also 0 ahead / all '-' vs wip/lead-land-4 |
| `wip/third-p4-task5` | `896b8e47bb134a8d5c16ddf13287a4af4af03adb` | 2026-11-02 | MERGED: head in origin/main (0 ahead); also 0 ahead / all '-' vs wip/lead-land-4 |
| `wip/third-p4-task5-minors` | `5e3020d2fed147cdaf611d12f58152dd28fb6fd4` | 2026-11-06 | MERGED: head in origin/main (0 ahead); also 0 ahead / all '-' vs wip/lead-land-4 |
| `wip/third-p4-task7` | `1d1c65e9ad2f39ffeaa5bb640c4e8ec3dcd8c1ef` | 2026-11-03 | MERGED: head in origin/main (0 ahead); also 0 ahead / all '-' vs wip/lead-land-4 |
| `wip/third-p4-task7-fixes` | `d687cf306a92dad80011070d729d36b11254d616` | 2026-11-07 | MERGED: head in origin/main (0 ahead); also 0 ahead / all '-' vs wip/lead-land-4 |
| `wip/third-p4-task8` | `ac472caf818173ef4eaca4a68558ff132371d1d8` | 2026-11-03 | MERGED: head in origin/main (0 ahead); also 0 ahead / all '-' vs wip/lead-land-4 |
| `wip/third-p5-past-rep` | `4a687f9460b01736bea02b90eec33d151b820379` | 2026-11-02 | MERGED: head in origin/main (0 ahead); also 0 ahead / all '-' vs wip/lead-land-4 |
| `wip/third-p5-proof-core` | `210fdf534abc373783e7ebbe8982217eea8f18a6` | 2026-11-06 | MERGED: head in origin/main (0 ahead); also 0 ahead / all '-' vs wip/lead-land-4 |
| `wip/third-p5-proof-envelope` | `05567436da73f986019b6240898335b9d46200ae` | 2026-11-06 | MERGED: head in origin/main (0 ahead); also 0 ahead / all '-' vs wip/lead-land-4 |
| `wip/third-p5-reviews-api` | `a7a38fdf767f1181a71e02c4e9e4abff50c0b1fc` | 2026-11-03 | MERGED: head in origin/main (0 ahead); also 0 ahead / all '-' vs wip/lead-land-4 |
| `wip/third-p5-smart-check` | `746133a3a30971bec6c30bf2325770812fd25ac9` | 2026-11-06 | MERGED: head in origin/main (0 ahead); also 0 ahead / all '-' vs wip/lead-land-4 |
| `wip/third-p5-traded-pastrep` | `1a99f7b9fe43e880197e53fd5bfbe442f9934043` | 2026-11-06 | MERGED: head in origin/main (0 ahead); also 0 ahead / all '-' vs wip/lead-land-4 |
| `wip/third-p4-task4-split` | `a0cc3766227d683ab9229f785a34c7c47ecbb5f0` | 2026-11-06 | SUPERSEDED: 1 commit(s) ahead of main, git cherry all '-' (patches in main); also 0 ahead / all '-' vs wip/lead-land-4 |

## Proposed but NOT on the list (11)

- Named as held or in-flight in the room docs: `wip/lead-land` (wip/lead-land* excluded), `wip/lead-land-t9io-held` and `wip/second-p3-task9-io` (to-second.log: the hold stands), `pc/lead-land-fixer-wip` (owner-answers-assignments.md: in-flight fixer, partial unchecked edits).
- Commit within the last 2 days (since 2026-11-08 ~00:50 UTC): `wip/lead-exact-send`, `wip/lead-patch-keeping`, `wip/lead-semgrep-cloud`, `wip/lead-vendor`, `wip/lead-watcher-flake`, `wip/lead-watcher-revive`, `pc/stash-finding1-kit`. They all pass the merged check and can go in a later list after 2026-11-10.
- None of the ten live claude2 branches (wip/second-offer-rules, price-feeds, timers-maint, gift-cards, support-tickets, team-limits, staff-pages, api-cap-dispute, p3-task34, p3-task34-web) were on the audit's delete proposals; none is in this list.

## Delete (run from any clone)

```sh
git push origin --delete \
  wip/lead-batch4 \
  wip/lead-design-fold \
  wip/lead-sonar-action \
  wip/second-design-offers-v2 \
  wip/second-design-selection \
  wip/second-p3-task10 \
  wip/second-p3-task9-view \
  wip/third-design-build \
  wip/third-feedback-form-limit \
  wip/third-p4-reverify \
  wip/third-p4-staff-trader-split \
  wip/third-p4-task10 \
  wip/third-p4-task15 \
  wip/third-p4-task4 \
  wip/third-p4-task5 \
  wip/third-p4-task5-minors \
  wip/third-p4-task7 \
  wip/third-p4-task7-fixes \
  wip/third-p4-task8 \
  wip/third-p5-past-rep \
  wip/third-p5-proof-core \
  wip/third-p5-proof-envelope \
  wip/third-p5-reviews-api \
  wip/third-p5-smart-check \
  wip/third-p5-traded-pastrep \
  wip/third-p4-task4-split
```

## Restore (one per branch; undoes the delete)

```sh
git push origin e667c3ce009ca37ab1287652f9a41eaea32a3c6f:refs/heads/wip/lead-batch4
git push origin e02c1e986f49fdb7b9876ac89ff2d061e2d782bc:refs/heads/wip/lead-design-fold
git push origin 8cfa0d4496692fd628482ad769fa16fda9c25349:refs/heads/wip/lead-sonar-action
git push origin 1e890b1351fbb3bd732fecae5404798c0935e62c:refs/heads/wip/second-design-offers-v2
git push origin 67336d491457303252e8bbc18d60da18a6ad8a30:refs/heads/wip/second-design-selection
git push origin 305124b7adef8bba1b63a5491c0c1750a770046b:refs/heads/wip/second-p3-task10
git push origin 99ba09fc7b3f9367ecf21cae68c3981030b8a644:refs/heads/wip/second-p3-task9-view
git push origin 7f6cafc044ec509da6865b2b72474b5a3331beee:refs/heads/wip/third-design-build
git push origin 70821e984ef50e015634e055a97e7c1286921082:refs/heads/wip/third-feedback-form-limit
git push origin d41c8fb1fd08063d4af47fbdb47c2f3b9cc73cfe:refs/heads/wip/third-p4-reverify
git push origin b8cdef6bfd2e2e71a061526e789fc2f1ef14ac58:refs/heads/wip/third-p4-staff-trader-split
git push origin 3d678a338c40d6cd55442b6709d6ba5cd3d9c564:refs/heads/wip/third-p4-task10
git push origin 5b5a5cbf7f356afd856a7df760d458e4d5f61438:refs/heads/wip/third-p4-task15
git push origin eee547f271ef257d8b126df8a192a8ccc6256643:refs/heads/wip/third-p4-task4
git push origin 896b8e47bb134a8d5c16ddf13287a4af4af03adb:refs/heads/wip/third-p4-task5
git push origin 5e3020d2fed147cdaf611d12f58152dd28fb6fd4:refs/heads/wip/third-p4-task5-minors
git push origin 1d1c65e9ad2f39ffeaa5bb640c4e8ec3dcd8c1ef:refs/heads/wip/third-p4-task7
git push origin d687cf306a92dad80011070d729d36b11254d616:refs/heads/wip/third-p4-task7-fixes
git push origin ac472caf818173ef4eaca4a68558ff132371d1d8:refs/heads/wip/third-p4-task8
git push origin 4a687f9460b01736bea02b90eec33d151b820379:refs/heads/wip/third-p5-past-rep
git push origin 210fdf534abc373783e7ebbe8982217eea8f18a6:refs/heads/wip/third-p5-proof-core
git push origin 05567436da73f986019b6240898335b9d46200ae:refs/heads/wip/third-p5-proof-envelope
git push origin a7a38fdf767f1181a71e02c4e9e4abff50c0b1fc:refs/heads/wip/third-p5-reviews-api
git push origin 746133a3a30971bec6c30bf2325770812fd25ac9:refs/heads/wip/third-p5-smart-check
git push origin 1a99f7b9fe43e880197e53fd5bfbe442f9934043:refs/heads/wip/third-p5-traded-pastrep
git push origin a0cc3766227d683ab9229f785a34c7c47ecbb5f0:refs/heads/wip/third-p4-task4-split
```
