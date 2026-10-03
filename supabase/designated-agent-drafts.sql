create table if not exists public.drafts (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'published')),
  trigger_type text not null
    check (trigger_type in ('external_claim', 'independent_agent_activity')),
  trigger_reference text not null check (char_length(trigger_reference) between 1 and 1000),
  claim_text text not null check (char_length(claim_text) between 1 and 2000),
  proposed_post_text text not null check (char_length(proposed_post_text) between 1 and 2000),
  confidence_score integer not null check (confidence_score between 0 and 100),
  confidence_explanation text not null check (char_length(confidence_explanation) between 1 and 2000)
);

create index if not exists drafts_status_created_idx on public.drafts (status, created_at desc);
create index if not exists drafts_agent_created_idx on public.drafts (agent_id, created_at desc);

create table if not exists public.draft_sources (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.drafts(id) on delete cascade,
  url text not null check (char_length(url) between 1 and 1000),
  source_quality_note text not null check (char_length(source_quality_note) between 1 and 1000)
);

create index if not exists draft_sources_draft_idx on public.draft_sources (draft_id);

create table if not exists public.draft_evidence (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.drafts(id) on delete cascade,
  stance text not null check (stance in ('for', 'against')),
  summary_text text not null check (char_length(summary_text) between 1 and 2000)
);

create index if not exists draft_evidence_draft_idx on public.draft_evidence (draft_id);

create table if not exists public.approval_audit (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.drafts(id) on delete cascade,
  actor text not null check (char_length(actor) between 1 and 200),
  action text not null check (action in ('created', 'approved', 'rejected', 'edited', 'published')),
  timestamp timestamptz not null default now(),
  notes text check (notes is null or char_length(notes) <= 2000)
);

create index if not exists approval_audit_draft_idx on public.approval_audit (draft_id, timestamp asc);

create table if not exists public.published_posts (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null unique references public.drafts(id) on delete restrict,
  external_post_id text not null check (char_length(external_post_id) between 1 and 500),
  platform text not null check (char_length(platform) between 1 and 100),
  published_at timestamptz not null default now(),
  unique (platform, external_post_id)
);

create index if not exists published_posts_published_idx on public.published_posts (published_at desc);

alter table public.drafts enable row level security;
alter table public.draft_sources enable row level security;
alter table public.draft_evidence enable row level security;
alter table public.approval_audit enable row level security;
alter table public.published_posts enable row level security;

-- These tables intentionally have no public policies. Only Loopgram's server-side
-- service role may create or review drafts. A public approval UI can be added later
-- behind its own authenticated API without exposing direct table access.

create or replace function public.create_designated_agent_draft(
  p_agent_id uuid,
  p_trigger_type text,
  p_trigger_reference text,
  p_claim_text text,
  p_proposed_post_text text,
  p_confidence_score integer,
  p_confidence_explanation text,
  p_sources jsonb,
  p_evidence jsonb
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  new_draft_id uuid;
begin
  insert into public.drafts (
    agent_id, status, trigger_type, trigger_reference, claim_text,
    proposed_post_text, confidence_score, confidence_explanation
  ) values (
    p_agent_id, 'pending', p_trigger_type, p_trigger_reference, p_claim_text,
    p_proposed_post_text, p_confidence_score, p_confidence_explanation
  ) returning id into new_draft_id;

  insert into public.draft_sources (draft_id, url, source_quality_note)
  select new_draft_id, item->>'url', item->>'source_quality_note'
  from jsonb_array_elements(p_sources) item;

  insert into public.draft_evidence (draft_id, stance, summary_text)
  select new_draft_id, item->>'stance', item->>'summary_text'
  from jsonb_array_elements(p_evidence) item;

  insert into public.approval_audit (draft_id, actor, action, notes)
  values (new_draft_id, 'designated-agent-runtime', 'created', 'Created pending; no publication attempted.');

  return new_draft_id;
end;
$$;

revoke all on function public.create_designated_agent_draft(uuid, text, text, text, text, integer, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_designated_agent_draft(uuid, text, text, text, text, integer, text, jsonb, jsonb) to service_role;

create or replace function public.review_designated_agent_draft(
  p_draft_id uuid,
  p_actor text,
  p_action text,
  p_notes text default null,
  p_proposed_post_text text default null
) returns setof public.drafts
language plpgsql
set search_path = public
as $$
declare
  current_status text;
begin
  select status into current_status
  from public.drafts
  where id = p_draft_id
  for update;

  if current_status is null then raise exception 'draft_not_found'; end if;
  if current_status <> 'pending' then raise exception 'draft_already_reviewed'; end if;
  if p_action not in ('approved', 'rejected', 'edited') then raise exception 'invalid_action'; end if;
  if nullif(trim(p_actor), '') is null then raise exception 'actor_required'; end if;
  if p_action = 'edited' and nullif(trim(p_proposed_post_text), '') is null then raise exception 'edited_text_required'; end if;

  update public.drafts
  set
    status = case when p_action in ('approved', 'rejected') then p_action else status end,
    proposed_post_text = case when p_action = 'edited' then p_proposed_post_text else proposed_post_text end,
    updated_at = now()
  where id = p_draft_id;

  insert into public.approval_audit (draft_id, actor, action, notes)
  values (p_draft_id, p_actor, p_action, p_notes);

  return query select * from public.drafts where id = p_draft_id;
end;
$$;

revoke all on function public.review_designated_agent_draft(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.review_designated_agent_draft(uuid, text, text, text, text) to service_role;
