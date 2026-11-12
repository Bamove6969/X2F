-- S-093 (owner p7-6, 8 Nov 2026): "a blocked list with optional notes and the date/time blocked".
-- The time is 107's `created_at`. `note` is the blocker's own private text about the person they
-- blocked: read only by the blocker (GET /v1/account/blocks), never by the blocked person, never by
-- staff (traders/blocks.ts `blocksBetween` does not read it). Stored as plain text, like 361's
-- trader notes (S-094); it goes with the block row (an unblock deletes it) and with either account.
-- At most 500 characters; null when there is none (the API stores blank text as null).
alter table account_blocks add column note text check (note is null or char_length(note) between 1 and 500);
