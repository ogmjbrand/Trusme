-- TrustOS core: identity, organizations, membership, audit, notifications, documents.
-- All tenant data is scoped by organization_id. A personal workspace is an
-- organization of kind 'personal' created automatically for every new user.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.org_role as enum ('owner', 'admin', 'member', 'viewer');
create type public.org_kind as enum ('personal', 'business');
create type public.member_status as enum ('active', 'suspended');
create type public.actor_type as enum ('user', 'system', 'ai', 'webhook');

-- ---------------------------------------------------------------------------
-- Shared trigger helpers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.prevent_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '42501';
end;
$$;

create or replace function public.org_role_rank(p_role public.org_role)
returns int
language sql
immutable
as $$
  select case p_role
    when 'owner' then 4
    when 'admin' then 3
    when 'member' then 2
    when 'viewer' then 1
  end;
$$;

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  phone text,
  avatar_url text,
  country text not null default 'NG',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Organizations & membership
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  kind public.org_kind not null default 'business',
  country text not null default 'NG',
  default_currency char(3) not null default 'NGN' check (default_currency ~ '^[A-Z]{3}$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger organizations_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();

create table public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.org_role not null default 'member',
  status public.member_status not null default 'active',
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index organization_members_user_idx on public.organization_members (user_id);
create trigger organization_members_updated_at before update on public.organization_members
  for each row execute function public.set_updated_at();

-- Membership helpers. SECURITY DEFINER so RLS policies can call them without
-- recursing into organization_members' own policies.
create or replace function public.is_org_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org and m.user_id = auth.uid() and m.status = 'active'
  );
$$;

create or replace function public.has_org_role(p_org uuid, p_min public.org_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = p_org
      and m.user_id = auth.uid()
      and m.status = 'active'
      and public.org_role_rank(m.role) >= public.org_role_rank(p_min)
  );
$$;

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email text not null check (position('@' in email) > 1),
  role public.org_role not null default 'member' check (role <> 'owner'),
  token_hash text not null unique,
  invited_by uuid not null references auth.users (id) on delete cascade,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index invitations_org_idx on public.invitations (organization_id);
create unique index invitations_open_unique on public.invitations (organization_id, lower(email))
  where accepted_at is null and revoked_at is null;

create table public.user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  active_organization_id uuid references public.organizations (id) on delete set null,
  notification_settings jsonb not null default '{"email": true, "in_app": true}'::jsonb,
  ai_auto_run_low_risk boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger user_preferences_updated_at before update on public.user_preferences
  for each row execute function public.set_updated_at();

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations (id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'starter', 'business')),
  status text not null default 'active' check (status in ('active', 'trialing', 'past_due', 'cancelled')),
  provider text check (provider in ('paystack', 'stripe')),
  provider_customer_id text,
  provider_subscription_id text,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute function public.set_updated_at();

create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  provider text not null,
  status text not null default 'not_configured'
    check (status in ('not_configured', 'connected', 'error', 'disabled')),
  -- Non-secret configuration only. Secrets live in server environment variables.
  config jsonb not null default '{}'::jsonb,
  last_checked_at timestamptz,
  last_error text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider)
);
create trigger integration_connections_updated_at before update on public.integration_connections
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Audit log (append-only)
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  actor_type public.actor_type not null default 'user',
  action text not null,
  resource_type text not null,
  resource_id text,
  execution_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  ip_address text,
  created_at timestamptz not null default now()
);
create index audit_logs_org_created_idx on public.audit_logs (organization_id, created_at desc);
create trigger audit_logs_immutable before update or delete on public.audit_logs
  for each row execute function public.prevent_mutation();

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Uploaded documents (files live in Supabase Storage bucket 'documents' under
-- the path <organization_id>/<uuid>/<file name>)
-- ---------------------------------------------------------------------------
create table public.uploaded_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  uploaded_by uuid references auth.users (id) on delete set null,
  bucket text not null default 'documents',
  storage_path text not null unique,
  file_name text not null,
  mime_type text,
  size_bytes bigint check (size_bytes >= 0),
  sha256 text,
  entity_type text,
  entity_id uuid,
  evidence_class text check (evidence_class in
    ('verified_evidence', 'user_claim', 'third_party_report', 'ai_hypothesis')),
  description text,
  created_at timestamptz not null default now(),
  check (storage_path like organization_id::text || '/%')
);
create index uploaded_documents_entity_idx on public.uploaded_documents (organization_id, entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- Webhook events (service role only; idempotency for provider callbacks)
-- ---------------------------------------------------------------------------
create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  event_type text not null,
  payload jsonb not null,
  signature_valid boolean not null,
  organization_id uuid references public.organizations (id) on delete set null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text,
  unique (provider, event_id)
);

-- ---------------------------------------------------------------------------
-- New user bootstrap: profile + personal workspace + owner membership.
-- ---------------------------------------------------------------------------
create or replace function public.slugify(p_text text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(lower(coalesce(p_text, '')), '[^a-z0-9]+', '-', 'g'));
$$;

create or replace function public.unique_org_slug(p_base text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text := left(nullif(public.slugify(p_base), ''), 40);
  v_slug text;
begin
  if v_base is null or char_length(v_base) < 2 then
    v_base := 'workspace';
  end if;
  v_slug := v_base;
  while exists (select 1 from public.organizations where slug = v_slug) loop
    v_slug := v_base || '-' || substr(encode(gen_random_bytes(4), 'hex'), 1, 6);
  end loop;
  return v_slug;
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_name text := coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1));
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name');

  insert into public.organizations (name, slug, kind, created_by)
  values (left(v_name || '''s workspace', 120), public.unique_org_slug(v_name), 'personal', new.id)
  returning id into v_org;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_org, new.id, 'owner');

  insert into public.subscriptions (organization_id) values (v_org);

  insert into public.user_preferences (user_id, active_organization_id)
  values (new.id, v_org);

  insert into public.audit_logs (organization_id, actor_user_id, actor_type, action, resource_type, resource_id)
  values (v_org, new.id, 'system', 'workspace.created', 'organization', v_org::text);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Create a business organization; caller becomes owner.
create or replace function public.create_organization(p_name text, p_country text default 'NG', p_currency text default 'NGN')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_name is null or char_length(trim(p_name)) = 0 then
    raise exception 'organization name is required' using errcode = '22023';
  end if;

  insert into public.organizations (name, slug, kind, country, default_currency, created_by)
  values (trim(p_name), public.unique_org_slug(p_name), 'business', coalesce(p_country, 'NG'), upper(coalesce(p_currency, 'NGN')), v_uid)
  returning id into v_org;

  insert into public.organization_members (organization_id, user_id, role) values (v_org, v_uid, 'owner');
  insert into public.subscriptions (organization_id) values (v_org);
  insert into public.audit_logs (organization_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (v_org, v_uid, 'organization.created', 'organization', v_org::text, jsonb_build_object('name', p_name));
  return v_org;
end;
$$;

-- Accept an invitation by raw token (hashed with sha256 server-side).
create or replace function public.accept_invitation(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_inv public.invitations%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select email into v_email from auth.users where id = v_uid;

  select * into v_inv from public.invitations
  where token_hash = encode(digest(p_token, 'sha256'), 'hex')
  for update;

  if not found or v_inv.revoked_at is not null or v_inv.accepted_at is not null or v_inv.expires_at < now() then
    raise exception 'invitation is invalid or expired' using errcode = '22023';
  end if;
  if lower(v_inv.email) <> lower(v_email) then
    raise exception 'invitation was issued to a different email address' using errcode = '42501';
  end if;

  insert into public.organization_members (organization_id, user_id, role, invited_by)
  values (v_inv.organization_id, v_uid, v_inv.role, v_inv.invited_by)
  on conflict (organization_id, user_id) do nothing;

  update public.invitations set accepted_at = now(), accepted_by = v_uid where id = v_inv.id;

  insert into public.audit_logs (organization_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (v_inv.organization_id, v_uid, 'invitation.accepted', 'invitation', v_inv.id::text,
          jsonb_build_object('role', v_inv.role));
  return v_inv.organization_id;
end;
$$;

-- Change a member's role. Admins may manage members/viewers; only owners may
-- grant or revoke admin/owner. The last owner cannot be demoted.
create or replace function public.update_member_role(p_org uuid, p_user uuid, p_role public.org_role)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_actor_role public.org_role;
  v_target_role public.org_role;
begin
  select role into v_actor_role from public.organization_members
  where organization_id = p_org and user_id = v_uid and status = 'active';
  if v_actor_role is null or public.org_role_rank(v_actor_role) < 3 then
    raise exception 'insufficient permissions' using errcode = '42501';
  end if;

  select role into v_target_role from public.organization_members
  where organization_id = p_org and user_id = p_user
  for update;
  if v_target_role is null then
    raise exception 'member not found' using errcode = '22023';
  end if;

  if v_actor_role <> 'owner' and (public.org_role_rank(v_target_role) >= 3 or public.org_role_rank(p_role) >= 3) then
    raise exception 'only owners can manage admins and owners' using errcode = '42501';
  end if;

  if v_target_role = 'owner' and p_role <> 'owner' and
     (select count(*) from public.organization_members where organization_id = p_org and role = 'owner' and status = 'active') <= 1 then
    raise exception 'an organization must keep at least one owner' using errcode = '22023';
  end if;

  update public.organization_members set role = p_role where organization_id = p_org and user_id = p_user;
  insert into public.audit_logs (organization_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (p_org, v_uid, 'member.role_changed', 'organization_member', p_user::text,
          jsonb_build_object('from', v_target_role, 'to', p_role));
end;
$$;

create or replace function public.remove_member(p_org uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_actor_role public.org_role;
  v_target_role public.org_role;
begin
  select role into v_actor_role from public.organization_members
  where organization_id = p_org and user_id = v_uid and status = 'active';
  select role into v_target_role from public.organization_members
  where organization_id = p_org and user_id = p_user;
  if v_target_role is null then
    raise exception 'member not found' using errcode = '22023';
  end if;

  -- Members may remove themselves (leave), except the last owner.
  if p_user <> v_uid then
    if v_actor_role is null or public.org_role_rank(v_actor_role) < 3 then
      raise exception 'insufficient permissions' using errcode = '42501';
    end if;
    if v_actor_role <> 'owner' and public.org_role_rank(v_target_role) >= 3 then
      raise exception 'only owners can remove admins and owners' using errcode = '42501';
    end if;
  end if;

  if v_target_role = 'owner' and
     (select count(*) from public.organization_members where organization_id = p_org and role = 'owner' and status = 'active') <= 1 then
    raise exception 'an organization must keep at least one owner' using errcode = '22023';
  end if;

  delete from public.organization_members where organization_id = p_org and user_id = p_user;
  insert into public.audit_logs (organization_id, actor_user_id, action, resource_type, resource_id)
  values (p_org, v_uid, 'member.removed', 'organization_member', p_user::text);
end;
$$;
