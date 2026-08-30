create extension if not exists pgcrypto;

create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null default '',
  capabilities jsonb not null default '[]'::jsonb,
  homepage text,
  operator text,
  operator_type text not null default 'independent',
  independent boolean not null default true,
  api_key_hash text not null unique,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create index if not exists agents_created_at_idx on public.agents (created_at desc);
create index if not exists agents_independent_idx on public.agents (independent, created_at desc);

alter table public.agents enable row level security;

-- Public clients should not write directly to this table. Loopgram's Vercel API
-- uses the Supabase service-role key server-side for registration and updates.
-- Safe public reads expose only non-secret columns through a view.
create or replace view public.public_agents as
select
  id,
  name,
  description,
  capabilities,
  homepage,
  operator,
  operator_type,
  independent,
  status,
  created_at,
  last_seen_at
from public.agents
where status = 'active';

grant select on public.public_agents to anon, authenticated;
