-- Plan 4 Task 19, lead call 18 Nov 2026 (re-review): the training library is review-first. A closed
-- case is listed only once a curator (`training.curate`, the owner) has marked it, with the manual
-- masks they reviewed. Only this curation record is stored, never a scrubbed copy: the texts are
-- read from the dispute and masked on every read (Revision 2026-10-29b), and the row goes with its
-- dispute. A manual mask is a range of the pre-masked text plus an HMAC tag of the text it covers
-- (never the text), or a whole field; a range whose tag no longer matches hides the case until it is
-- curated again. `field_tags` (re-review 3 B1) holds, for every field the curator reviewed, an HMAC
-- tag of the field's whole pre-masked text: a changed, added or removed field hides the case too,
-- whether or not it has a manual mask. `training_id` is the case's opaque id (HMAC under X2F_TRAINING_ID_KEY), stored so
-- a read never computes it for every closed dispute.
create table training_cases (
  code text not null,
  seq smallint not null,
  training_id text not null unique check (training_id ~ '^[0-9a-f]{32}$'),
  manual_masks jsonb not null default '[]'::jsonb check (jsonb_typeof(manual_masks) = 'array'),
  field_tags jsonb not null check (jsonb_typeof(field_tags) = 'object'),
  marked_by uuid not null references accounts (id),
  marked_at timestamptz not null,
  primary key (code, seq),
  foreign key (code, seq) references disputes (code, seq) on delete cascade
);
