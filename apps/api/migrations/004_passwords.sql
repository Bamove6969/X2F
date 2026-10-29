-- Plan 2, Task 6: password hashes (Argon2id, m=65536 t=3 p=1, on the NFC form). Never the password.
create table passwords (
  account_id uuid primary key references accounts (id) on delete cascade,
  hash text not null,
  updated_at timestamptz not null
);
