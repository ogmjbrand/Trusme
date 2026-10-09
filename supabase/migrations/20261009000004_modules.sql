-- TrustOS module tables: BeforeYouPay, JobProof, CareerVault, IncomePilot, LaunchReady.

-- ===========================================================================
-- BeforeYouPay — trust & safety
-- ===========================================================================
create table public.risk_assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  subject_type text not null check (subject_type in ('url', 'message', 'seller', 'transaction', 'phone', 'account')),
  title text not null,
  subject_text text,
  url text,
  counterparty_name text,
  counterparty_contact text,
  amount_minor public.money_minor check (amount_minor >= 0),
  currency public.currency_code,
  payment_method_requested text,
  status text not null default 'draft' check (status in ('draft', 'assessed', 'closed')),
  -- Heuristic indicator level. Never a determination of fraud.
  risk_level text not null default 'unknown' check (risk_level in ('low', 'elevated', 'high', 'unknown')),
  risk_score int check (risk_score between 0 and 100),
  summary text,
  method text,
  assessed_at timestamptz,
  user_feedback text check (user_feedback in ('accurate', 'partly_accurate', 'inaccurate')),
  user_feedback_note text,
  outcome text check (outcome in ('did_not_pay', 'paid_ok', 'paid_lost_money', 'unknown')),
  is_sample boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index risk_assessments_org_idx on public.risk_assessments (organization_id, created_at desc);
create trigger risk_assessments_updated_at before update on public.risk_assessments
  for each row execute function public.set_updated_at();

create table public.risk_signals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  assessment_id uuid not null references public.risk_assessments (id) on delete cascade,
  code text not null,
  label text not null,
  severity text not null check (severity in ('info', 'low', 'medium', 'high')),
  evidence_class text not null check (evidence_class in
    ('verified_evidence', 'user_claim', 'third_party_report', 'ai_hypothesis', 'heuristic_observation')),
  detail text,
  source_name text,
  source_url text,
  retrieved_at timestamptz,
  created_at timestamptz not null default now()
);
create index risk_signals_assessment_idx on public.risk_signals (assessment_id);

create table public.scam_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  assessment_id uuid references public.risk_assessments (id) on delete set null,
  intended_recipient text,
  title text not null,
  body text not null,
  status text not null default 'draft' check (status in ('draft', 'ready', 'submitted_by_user', 'withdrawn')),
  submitted_at timestamptz,
  submission_reference text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger scam_reports_updated_at before update on public.scam_reports
  for each row execute function public.set_updated_at();

-- ===========================================================================
-- JobProof — service agreements & work records
-- ===========================================================================
create table public.service_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,
  title text not null,
  description text,
  location text,
  currency public.currency_code not null default 'NGN',
  price_minor public.money_minor not null default 0 check (price_minor >= 0),
  deadline date,
  status text not null default 'draft' check (status in
    ('draft', 'proposed', 'agreed', 'in_progress', 'awaiting_confirmation', 'completed', 'disputed', 'cancelled')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'partially_paid', 'paid')),
  invoice_id uuid references public.invoices (id) on delete set null,
  warranty_terms text,
  warranty_until date,
  share_token_hash text unique,
  customer_confirmed_at timestamptz,
  customer_confirmed_name text,
  is_sample boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index service_jobs_org_idx on public.service_jobs (organization_id, created_at desc);
create trigger service_jobs_updated_at before update on public.service_jobs
  for each row execute function public.set_updated_at();

alter table public.invoices
  add constraint invoices_service_job_fk foreign key (service_job_id) references public.service_jobs (id) on delete set null;

create table public.service_agreements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  job_id uuid not null references public.service_jobs (id) on delete cascade,
  version int not null,
  scope text not null,
  materials text,
  currency public.currency_code not null,
  price_minor public.money_minor not null check (price_minor >= 0),
  deadline date,
  terms text,
  -- sha256 of the canonical agreement content; acceptance applies to this hash.
  content_hash text not null,
  provider_accepted_by uuid references auth.users (id) on delete set null,
  provider_accepted_at timestamptz,
  customer_accepted_name text,
  customer_accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (job_id, version)
);

create table public.job_change_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  job_id uuid not null references public.service_jobs (id) on delete cascade,
  description text not null,
  price_delta_minor public.money_minor not null default 0,
  new_deadline date,
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected', 'withdrawn')),
  requested_by_party text not null check (requested_by_party in ('provider', 'customer')),
  requested_by uuid references auth.users (id) on delete set null,
  decided_by_party text check (decided_by_party in ('provider', 'customer')),
  decided_by_name text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index job_change_requests_job_idx on public.job_change_requests (job_id);

create table public.job_updates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  job_id uuid not null references public.service_jobs (id) on delete cascade,
  kind text not null check (kind in ('progress', 'material', 'additional_cost', 'note', 'completion', 'dispute_note', 'customer_message')),
  body text not null,
  amount_minor public.money_minor,
  author_party text not null default 'provider' check (author_party in ('provider', 'customer')),
  author_name text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index job_updates_job_idx on public.job_updates (job_id, created_at);
create trigger job_updates_immutable before update or delete on public.job_updates
  for each row execute function public.prevent_mutation();

create table public.job_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  job_id uuid not null references public.service_jobs (id) on delete cascade,
  document_id uuid not null references public.uploaded_documents (id) on delete cascade,
  phase text not null check (phase in ('before', 'during', 'after', 'other')),
  caption text,
  -- User-stated capture time; the application only knows the upload time.
  claimed_captured_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index job_evidence_job_idx on public.job_evidence (job_id);

-- ===========================================================================
-- CareerVault
-- ===========================================================================
create table public.career_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  headline text,
  summary text,
  location text,
  target_roles text[] not null default '{}',
  links jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);
create trigger career_profiles_updated_at before update on public.career_profiles
  for each row execute function public.set_updated_at();

create table public.career_skills (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  level text not null default 'intermediate' check (level in ('beginner', 'intermediate', 'advanced', 'expert')),
  years numeric(4, 1) check (years >= 0),
  evidence_note text,
  created_at timestamptz not null default now(),
  unique (organization_id, user_id, name)
);

create table public.employment_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  employer text not null,
  title text not null,
  start_date date,
  end_date date,
  description text,
  created_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create table public.credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  issuer text,
  issued_on date,
  expires_on date,
  credential_url text,
  document_id uuid references public.uploaded_documents (id) on delete set null,
  verification_status text not null default 'self_reported'
    check (verification_status in ('self_reported', 'document_uploaded', 'issuer_verified')),
  created_at timestamptz not null default now()
);

create table public.portfolio_projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  description text,
  role text,
  outcomes text,
  url text,
  skills text[] not null default '{}',
  source text not null default 'manual' check (source in ('manual', 'jobproof', 'launchready')),
  source_id uuid,
  -- Must be confirmed by the user before it is used as portfolio evidence.
  confirmed_accurate boolean not null default false,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger portfolio_projects_updated_at before update on public.portfolio_projects
  for each row execute function public.set_updated_at();

create table public.job_applications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  company text not null,
  role_title text not null,
  job_url text,
  job_description text,
  status text not null default 'saved' check (status in
    ('saved', 'preparing', 'applied', 'interviewing', 'offer', 'rejected', 'withdrawn')),
  submission_method text not null default 'manual' check (submission_method in ('manual', 'integration')),
  -- Only set when the destination confirmed receipt (or the user records it).
  submission_confirmation text,
  applied_at timestamptz,
  follow_up_on date,
  interview_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index job_applications_user_idx on public.job_applications (organization_id, user_id, updated_at desc);
create trigger job_applications_updated_at before update on public.job_applications
  for each row execute function public.set_updated_at();

create table public.application_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  application_id uuid references public.job_applications (id) on delete cascade,
  kind text not null check (kind in ('cv', 'cover_letter', 'interview_prep', 'skills_gap', 'other')),
  title text not null,
  content text not null,
  generated_by text not null default 'template' check (generated_by in ('template', 'ai', 'user')),
  version int not null default 1,
  created_at timestamptz not null default now()
);
create index application_documents_app_idx on public.application_documents (application_id, created_at desc);

-- ===========================================================================
-- IncomePilot
-- ===========================================================================
create table public.income_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  source text not null,
  description text,
  amount_minor public.money_minor not null check (amount_minor > 0),
  currency public.currency_code not null default 'NGN',
  received_on date not null default current_date,
  -- Invoice payments are already counted through payments; never link both.
  is_sample boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index income_entries_org_idx on public.income_entries (organization_id, received_on desc);

create table public.recurring_obligations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  category text not null default 'bills',
  amount_minor public.money_minor not null check (amount_minor > 0),
  currency public.currency_code not null default 'NGN',
  frequency text not null check (frequency in ('weekly', 'monthly', 'quarterly', 'yearly')),
  next_due_on date not null,
  is_active boolean not null default true,
  is_sample boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger recurring_obligations_updated_at before update on public.recurring_obligations
  for each row execute function public.set_updated_at();

create table public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  target_minor public.money_minor not null check (target_minor > 0),
  saved_minor public.money_minor not null default 0 check (saved_minor >= 0),
  currency public.currency_code not null default 'NGN',
  target_date date,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger savings_goals_updated_at before update on public.savings_goals
  for each row execute function public.set_updated_at();

create table public.cash_flow_forecasts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  currency public.currency_code not null,
  horizon_days int not null check (horizon_days between 7 and 366),
  opening_balance_minor public.money_minor not null,
  assumptions jsonb not null,
  result jsonb not null,
  method text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index cash_flow_forecasts_org_idx on public.cash_flow_forecasts (organization_id, created_at desc);

-- ===========================================================================
-- LaunchReady
-- ===========================================================================
-- Curated, attributable regulatory references. organization_id null = global.
create table public.regulatory_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  authority text not null,
  title text not null,
  url text not null,
  summary text,
  retrieved_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.launch_projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  idea text not null,
  product_category text not null default 'general',
  classification jsonb not null default '{}'::jsonb,
  stage text not null default 'planning' check (stage in ('idea', 'planning', 'registering', 'pre_launch', 'launched', 'paused')),
  currency public.currency_code not null default 'NGN',
  budget_minor public.money_minor check (budget_minor >= 0),
  target_launch_date date,
  is_sample boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger launch_projects_updated_at before update on public.launch_projects
  for each row execute function public.set_updated_at();

alter table public.expenses
  add constraint expenses_launch_project_fk foreign key (launch_project_id) references public.launch_projects (id) on delete set null;

create table public.launch_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid not null references public.launch_projects (id) on delete cascade,
  title text not null,
  description text,
  category text not null default 'operations' check (category in
    ('registration', 'compliance', 'product', 'labeling', 'suppliers', 'marketing', 'finance', 'operations')),
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'blocked', 'done')),
  due_on date,
  cost_estimate_minor public.money_minor check (cost_estimate_minor >= 0),
  regulatory_source_id uuid references public.regulatory_sources (id) on delete set null,
  needs_verification boolean not null default false,
  requires_expert boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index launch_tasks_project_idx on public.launch_tasks (project_id, position);
create trigger launch_tasks_updated_at before update on public.launch_tasks
  for each row execute function public.set_updated_at();

create table public.launch_applications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid not null references public.launch_projects (id) on delete cascade,
  authority text not null,
  application_type text not null,
  reference_number text,
  status text not null default 'preparing' check (status in
    ('preparing', 'submitted_by_user', 'under_review', 'query_raised', 'approved', 'rejected')),
  submitted_on date,
  last_checked_on date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger launch_applications_updated_at before update on public.launch_applications
  for each row execute function public.set_updated_at();

create table public.launch_suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid not null references public.launch_projects (id) on delete cascade,
  supplier_id uuid not null references public.suppliers (id) on delete cascade,
  role text,
  unique (project_id, supplier_id)
);

create table public.label_reviews (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid not null references public.launch_projects (id) on delete cascade,
  document_id uuid references public.uploaded_documents (id) on delete set null,
  label_text text,
  checklist jsonb not null default '[]'::jsonb,
  status text not null default 'in_review' check (status in ('in_review', 'changes_needed', 'ready_for_expert', 'expert_approved')),
  reviewer_note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger label_reviews_updated_at before update on public.label_reviews
  for each row execute function public.set_updated_at();

create table public.expert_handoffs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  project_id uuid not null references public.launch_projects (id) on delete cascade,
  expert_name text not null,
  expertise text not null,
  contact text,
  scope text not null,
  status text not null default 'requested' check (status in ('requested', 'engaged', 'completed', 'cancelled')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger expert_handoffs_updated_at before update on public.expert_handoffs
  for each row execute function public.set_updated_at();

-- Global, attributable starting points. Requirements must be verified at the
-- linked official source; TrustOS does not restate requirements it has not
-- retrieved. retrieved_at is null until a maintained source integration runs.
insert into public.regulatory_sources (organization_id, authority, title, url, summary, retrieved_at) values
  (null, 'CAC', 'Corporate Affairs Commission — official site', 'https://www.cac.gov.ng/',
   'Business name and company registration in Nigeria. Confirm current procedures and fees on the official portal.', null),
  (null, 'NAFDAC', 'National Agency for Food and Drug Administration and Control — official site', 'https://www.nafdac.gov.ng/',
   'Regulates food, drugs, cosmetics, medical devices, chemicals and packaged water. Confirm whether your product requires registration on the official site.', null),
  (null, 'SON', 'Standards Organisation of Nigeria — official site', 'https://son.gov.ng/',
   'Product standards and conformity programmes. Confirm applicable standards and certification on the official site.', null),
  (null, 'FIRS', 'Federal Inland Revenue Service — official site', 'https://www.firs.gov.ng/',
   'Federal tax registration and obligations. Confirm current requirements on the official site.', null);
