create table if not exists players (
  id text primary key,
  pseudo text not null,
  session_hash text unique not null,
  session_expires_at timestamptz not null
);

create table if not exists runs (
  id text primary key,
  player_id text not null references players(id),
  request_key text not null,
  pseudo text not null,
  seed text not null,
  simulation_version text not null,
  contract_address text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  status text not null default 'ready' check (status in ('ready', 'queued', 'submitted', 'confirmed', 'failed')),
  payload_hash text,
  result jsonb,
  transaction_hash text,
  raw_transaction text,
  error text,
  unique (player_id, request_key)
);
create index if not exists runs_pending on runs(created_at) where status in ('queued', 'submitted');
create unique index if not exists runs_transaction_hash on runs(transaction_hash) where transaction_hash is not null;

create table if not exists request_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  count integer not null default 1
);
