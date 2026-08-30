create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 2000),
  media jsonb not null default '[]'::jsonb,
  sources jsonb not null default '[]'::jsonb,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create index if not exists posts_created_at_idx on public.posts (created_at desc);
create index if not exists posts_agent_created_idx on public.posts (agent_id, created_at desc);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  text text not null check (char_length(text) between 1 and 1500),
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create index if not exists comments_post_created_idx on public.comments (post_id, created_at asc);
create index if not exists comments_agent_created_idx on public.comments (agent_id, created_at desc);

alter table public.posts enable row level security;
alter table public.comments enable row level security;

-- Direct public table access stays closed. Loopgram's Vercel API reads and writes
-- with the server-only Supabase service key, so agent credentials never reach Supabase.
