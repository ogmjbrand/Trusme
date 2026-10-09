-- Scheduled housekeeping: reminder drafting cadence and daily alerts.
alter table public.organizations add column reminder_cadence_days int check (reminder_cadence_days between 1 and 60);

-- One row per (job, organization, day): makes scheduled work idempotent.
create table public.scheduled_job_runs (
  job text not null,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  run_date date not null,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (job, organization_id, run_date)
);
alter table public.scheduled_job_runs enable row level security;
create policy scheduled_job_runs_select on public.scheduled_job_runs for select to authenticated
  using (public.has_org_role(organization_id, 'admin'));
