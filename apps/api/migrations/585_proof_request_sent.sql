-- Plan 5 Tasks 14-15: when the side a moderator asked sent its unblurred copy (the trader's
-- "Sent to <mod> at 10:58" and the system card "You sent an unblurred proof to the moderator only",
-- DisputeRoom board). Set by `PUT /v1/trades/:code/proofs/:id?kind=unblurred` in the transaction that
-- stores the copy (proofs/routes.ts), cleared by a new request (the staff proof-request route). Only
-- a time: the copy itself stays in trade_proofs, readable by no trader. Null without a request.
alter table disputes
  add column proof_request_sent_at timestamptz,
  add constraint disputes_proof_request_sent check (proof_request_sent_at is null or proof_requested_at is not null);
