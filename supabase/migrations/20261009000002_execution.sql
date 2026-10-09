-- TrustOS execution engine: conversations, executions, steps, events, approvals.

create type public.execution_status as enum (
  'draft', 'pending_approval', 'queued', 'running', 'waiting',
  'completed', 'partially_completed', 'failed', 'cancelled'
);

create type public.step_status as enum (
  'pending', 'awaiting_approval', 'approved', 'running', 'retry_scheduled',
  'succeeded', 'failed', 'skipped', 'rejected', 'cancelled'
);

create type public.side_effect_class as enum ('read', 'reversible_write', 'consequential');

create type public.verification_status as enum ('not_applicable', 'pending', 'verified', 'unverified', 'failed');

create type public.approval_status as enum ('pending', 'approved', 'rejected', 'cancelled', 'expired', 'superseded');

-- ---------------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'New conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index conversations_org_user_idx on public.conversations (organization_id, user_id, updated_at desc);
create trigger conversations_updated_at before update on public.conversations
  for each row execute function public.set_updated_at();

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  role text not null check (role in ('user', 'assistant', 'tool', 'system')),
  content text not null default '',
  tool_calls jsonb,
  execution_id uuid,
  created_at timestamptz not null default now()
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);

-- ---------------------------------------------------------------------------
create table public.executions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  goal text not null,
  originating_request text not null,
  plan_summary text,
  plan jsonb not null default '{}'::jsonb,
  plan_version int not null default 1,
  planner text not null default 'deterministic',
  status public.execution_status not null default 'draft',
  current_step int not null default 0,
  retry_count int not null default 0,
  result_summary text,
  error_summary text,
  idempotency_key text,
  cancel_requested boolean not null default false,
  cancelled_by uuid references auth.users (id) on delete set null,
  cancelled_at timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  next_run_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);
create index executions_org_status_idx on public.executions (organization_id, status, created_at desc);
create index executions_runnable_idx on public.executions (next_run_at)
  where status in ('queued', 'running', 'waiting');
create trigger executions_updated_at before update on public.executions
  for each row execute function public.set_updated_at();

alter table public.messages
  add constraint messages_execution_fk foreign key (execution_id) references public.executions (id) on delete set null;

create table public.execution_steps (
  id uuid primary key default gen_random_uuid(),
  execution_id uuid not null references public.executions (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  position int not null,
  tool_id text not null,
  title text not null,
  rationale text,
  input jsonb not null default '{}'::jsonb,
  depends_on int[] not null default '{}',
  side_effect public.side_effect_class not null,
  requires_approval boolean not null default false,
  status public.step_status not null default 'pending',
  permission_check jsonb,
  attempt_count int not null default 0,
  max_attempts int not null default 3,
  idempotency_key text not null,
  next_attempt_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  output jsonb,
  result_refs jsonb not null default '[]'::jsonb,
  error jsonb,
  verification public.verification_status not null default 'not_applicable',
  verification_detail text,
  outcome_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (execution_id, position),
  unique (organization_id, idempotency_key)
);
create index execution_steps_execution_idx on public.execution_steps (execution_id, position);
create trigger execution_steps_updated_at before update on public.execution_steps
  for each row execute function public.set_updated_at();

create table public.execution_events (
  id bigint generated always as identity primary key,
  execution_id uuid not null references public.executions (id) on delete cascade,
  step_id uuid references public.execution_steps (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  actor_type public.actor_type not null default 'system',
  event_type text not null,
  message text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index execution_events_execution_idx on public.execution_events (execution_id, id);
create trigger execution_events_immutable before update or delete on public.execution_events
  for each row execute function public.prevent_mutation();

create table public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  execution_id uuid not null references public.executions (id) on delete cascade,
  step_id uuid not null references public.execution_steps (id) on delete cascade,
  requested_by uuid references auth.users (id) on delete set null,
  tool_id text not null,
  summary text not null,
  action_details jsonb not null default '{}'::jsonb,
  -- sha256 of the canonical tool input. Approval only authorizes this exact input.
  action_hash text not null,
  approver_min_role public.org_role not null default 'member',
  status public.approval_status not null default 'pending',
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now()
);
create index approval_requests_org_status_idx on public.approval_requests (organization_id, status, created_at desc);
create unique index approval_requests_one_pending_per_step on public.approval_requests (step_id)
  where status = 'pending';
