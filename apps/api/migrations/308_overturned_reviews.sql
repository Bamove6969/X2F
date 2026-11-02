-- C12 (owner 2026-11-02, via the lead): "if the trade is OVERTURNED like it never happened, then the
-- feedback is ERASED. If all ends well and finishes like a normal trade after the dispute, the
-- feedback remains." `eraseOverturnedReviews` (apps/api/src/reviews/store.ts) deletes the trade's
-- reviews AND its Skip review rows as x2f_purge, inside the transaction that records the overturn.
-- 301's reviews_final trigger already lets x2f_purge delete a review (no trigger change); this
-- grant is the only new allowance: x2f_purge may read and delete review_skips rows.
grant select, delete on review_skips to x2f_purge;
