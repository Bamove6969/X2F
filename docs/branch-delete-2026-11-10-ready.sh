#!/bin/sh
# SAFE deletions (verified 2026-11-10, main 58f3d186, lead-land-4 36458444). NOT executed.
git push origin --delete wip/lead-batch4
git push origin --delete wip/lead-design-fold
git push origin --delete wip/lead-sonar-action
git push origin --delete wip/second-design-offers-v2
git push origin --delete wip/second-design-selection
git push origin --delete wip/second-p3-task10
git push origin --delete wip/second-p3-task9-view
git push origin --delete wip/third-feedback-form-limit
git push origin --delete wip/third-p4-staff-trader-split
git push origin --delete wip/third-p4-task10
git push origin --delete wip/third-p4-task4
git push origin --delete wip/third-p4-task5
git push origin --delete wip/third-p4-task5-minors
git push origin --delete wip/third-p4-task7
git push origin --delete wip/third-p4-task8
git push origin --delete wip/third-p5-past-rep
git push origin --delete wip/third-p5-proof-core
git push origin --delete wip/third-p5-proof-envelope
git push origin --delete wip/third-p5-reviews-api
git push origin --delete wip/third-p5-smart-check
git push origin --delete wip/third-p5-traded-pastrep
git push origin --delete wip/third-p4-task4-split

# RESTORE
git push origin e667c3ce009ca37ab1287652f9a41eaea32a3c6f:refs/heads/wip/lead-batch4
git push origin e02c1e986f49fdb7b9876ac89ff2d061e2d782bc:refs/heads/wip/lead-design-fold
git push origin 8cfa0d4496692fd628482ad769fa16fda9c25349:refs/heads/wip/lead-sonar-action
git push origin 1e890b1351fbb3bd732fecae5404798c0935e62c:refs/heads/wip/second-design-offers-v2
git push origin 67336d491457303252e8bbc18d60da18a6ad8a30:refs/heads/wip/second-design-selection
git push origin 305124b7adef8bba1b63a5491c0c1750a770046b:refs/heads/wip/second-p3-task10
git push origin 99ba09fc7b3f9367ecf21cae68c3981030b8a644:refs/heads/wip/second-p3-task9-view
git push origin 70821e984ef50e015634e055a97e7c1286921082:refs/heads/wip/third-feedback-form-limit
git push origin b8cdef6bfd2e2e71a061526e789fc2f1ef14ac58:refs/heads/wip/third-p4-staff-trader-split
git push origin 3d678a338c40d6cd55442b6709d6ba5cd3d9c564:refs/heads/wip/third-p4-task10
git push origin eee547f271ef257d8b126df8a192a8ccc6256643:refs/heads/wip/third-p4-task4
git push origin 896b8e47bb134a8d5c16ddf13287a4af4af03adb:refs/heads/wip/third-p4-task5
git push origin 5e3020d2fed147cdaf611d12f58152dd28fb6fd4:refs/heads/wip/third-p4-task5-minors
git push origin 1d1c65e9ad2f39ffeaa5bb640c4e8ec3dcd8c1ef:refs/heads/wip/third-p4-task7
git push origin ac472caf818173ef4eaca4a68558ff132371d1d8:refs/heads/wip/third-p4-task8
git push origin 4a687f9460b01736bea02b90eec33d151b820379:refs/heads/wip/third-p5-past-rep
git push origin 210fdf534abc373783e7ebbe8982217eea8f18a6:refs/heads/wip/third-p5-proof-core
git push origin 05567436da73f986019b6240898335b9d46200ae:refs/heads/wip/third-p5-proof-envelope
git push origin a7a38fdf767f1181a71e02c4e9e4abff50c0b1fc:refs/heads/wip/third-p5-reviews-api
git push origin 746133a3a30971bec6c30bf2325770812fd25ac9:refs/heads/wip/third-p5-smart-check
git push origin 1a99f7b9fe43e880197e53fd5bfbe442f9934043:refs/heads/wip/third-p5-traded-pastrep
git push origin a0cc3766227d683ab9229f785a34c7c47ecbb5f0:refs/heads/wip/third-p4-task4-split
