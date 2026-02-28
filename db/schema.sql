-- MarketRank schema (initial)
create table if not exists users (
  id text primary key,
  email text unique not null,
  password_hash text not null,
  created_at text not null,
  trust_score real not null default 50
);

create table if not exists predictions (
  id text primary key,
  user_id text not null,
  ticker text not null,
  direction text not null check(direction in ('bull','bear')),
  target_price real not null,
  horizon_date text not null,
  confidence real not null,
  created_at text not null,
  status text not null default 'open'
);
