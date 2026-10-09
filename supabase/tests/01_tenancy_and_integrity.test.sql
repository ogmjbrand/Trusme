-- Tenancy isolation, role enforcement and financial/inventory integrity tests.
-- Each block raises an exception (failing the run) when an expectation is not met.
\set QUIET on
\o /dev/null
set client_min_messages = warning;

create or replace function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), false);
  if p_user is null then
    execute 'reset role';
  else
    execute 'set role authenticated';
  end if;
end;
$$;

create or replace function pg_temp.expect_error(p_sql text, p_label text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    return;
  end;
  raise exception 'EXPECTED FAILURE did not fail: %', p_label;
end;
$$;

-- Fixtures --------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'ada@example.com', '{"full_name": "Ada Obi"}'),
  ('00000000-0000-0000-0000-00000000000b', 'bayo@example.com', '{"full_name": "Bayo Ade"}'),
  ('00000000-0000-0000-0000-00000000000c', 'chi@example.com', '{}');

do $$
begin
  if (select count(*) from public.organizations where kind = 'personal') <> 3 then
    raise exception 'personal workspaces were not created for new users';
  end if;
  if (select count(*) from public.organization_members where role = 'owner') <> 3 then
    raise exception 'owners were not assigned';
  end if;
end $$;

select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
create temp table ctx as select public.create_organization('Acme Stores') as org;
grant select on ctx to authenticated;

-- Ada (owner) creates business records.
insert into public.customers (organization_id, name, email) select org, 'Tunde Retail', 't@example.com' from ctx;
insert into public.products (organization_id, sku, name, currency, unit_price_minor, unit_cost_minor, reorder_point)
  select org, 'RICE-50', 'Rice 50kg', 'NGN', 8000000, 6500000, 5 from ctx;

-- Stock is derived from movements.
insert into public.inventory_movements (organization_id, product_id, movement_type, quantity, unit_cost_minor, currency, created_by)
  select c.org, p.id, 'opening', 10, 6500000, 'NGN', '00000000-0000-0000-0000-00000000000a'
  from ctx c join public.products p on p.organization_id = c.org;

do $$
begin
  if (select stock_on_hand from public.products where sku = 'RICE-50') <> 10 then
    raise exception 'opening movement did not set stock';
  end if;
end $$;

select pg_temp.expect_error($q$update public.products set stock_on_hand = 999 where sku = 'RICE-50'$q$,
  'direct stock edits must be rejected');
update public.inventory_movements set quantity = 1; -- no update policy: filtered by RLS
reset role;
select pg_temp.expect_error($q$update public.inventory_movements set quantity = 1$q$,
  'inventory movements are immutable even for privileged roles');
set role authenticated;

-- Record a sale: reduces stock atomically and snapshots cost.
select public.record_sale(
  (select org from ctx), (select id from public.customers where name = 'Tunde Retail'), 'NGN',
  jsonb_build_array(jsonb_build_object('product_id', (select id from public.products where sku = 'RICE-50'), 'quantity', 3)));

do $$
begin
  if (select stock_on_hand from public.products where sku = 'RICE-50') <> 7 then
    raise exception 'sale did not reduce stock (got %)', (select stock_on_hand from public.products where sku = 'RICE-50');
  end if;
  if (select unit_cost_minor from public.sale_items limit 1) <> 6500000 then
    raise exception 'sale did not snapshot unit cost';
  end if;
end $$;

-- Invoices: totals derive from items, payments drive status.
insert into public.invoices (organization_id, customer_id, invoice_number, currency, created_by)
  select c.org, cu.id, public.next_document_number(c.org, 'invoice'), 'NGN', '00000000-0000-0000-0000-00000000000a'
  from ctx c join public.customers cu on cu.organization_id = c.org;
insert into public.invoice_items (organization_id, invoice_id, description, quantity, unit_price_minor, tax_rate_bps)
  select i.organization_id, i.id, 'Rice 50kg', 2, 8000000, 750 from public.invoices i;

do $$
declare v public.invoices%rowtype;
begin
  select * into v from public.invoices limit 1;
  if v.invoice_number <> 'INV-00001' then raise exception 'unexpected invoice number %', v.invoice_number; end if;
  if v.subtotal_minor <> 16000000 or v.tax_minor <> 1200000 or v.total_minor <> 17200000 then
    raise exception 'invoice totals wrong: % % %', v.subtotal_minor, v.tax_minor, v.total_minor;
  end if;
end $$;

select pg_temp.expect_error($q$update public.invoices set amount_paid_minor = 1$q$, 'paid amount is derived');
select pg_temp.expect_error($q$update public.invoices set status = 'paid'$q$, 'cannot mark paid directly');
select pg_temp.expect_error(
  $q$insert into public.payments (organization_id, invoice_id, amount_minor, currency, method, recorded_by)
     select organization_id, id, 100, 'NGN', 'cash', '00000000-0000-0000-0000-00000000000a' from public.invoices$q$,
  'payments against draft invoices are rejected');

update public.invoices set status = 'issued', issued_at = now();
select pg_temp.expect_error($q$insert into public.invoice_items (organization_id, invoice_id, description, quantity, unit_price_minor)
  select organization_id, id, 'extra', 1, 1 from public.invoices$q$, 'issued invoice lines are frozen');

select pg_temp.expect_error(
  $q$insert into public.payments (organization_id, invoice_id, amount_minor, currency, method, recorded_by)
     select organization_id, id, 100, 'USD', 'cash', '00000000-0000-0000-0000-00000000000a' from public.invoices$q$,
  'payment currency must match invoice currency');
select pg_temp.expect_error(
  $q$insert into public.payments (organization_id, invoice_id, amount_minor, currency, method, source, provider, provider_reference, verified_at, recorded_by)
     select organization_id, id, 100, 'NGN', 'paystack', 'provider_verified', 'paystack', 'ref1', now(), '00000000-0000-0000-0000-00000000000a' from public.invoices$q$,
  'users cannot self-assert provider-verified payments');

insert into public.payments (organization_id, invoice_id, amount_minor, currency, method, recorded_by, idempotency_key)
  select organization_id, id, 7200000, 'NGN', 'bank_transfer', '00000000-0000-0000-0000-00000000000a', 'pay-1' from public.invoices;
select pg_temp.expect_error(
  $q$insert into public.payments (organization_id, invoice_id, amount_minor, currency, method, recorded_by, idempotency_key)
     select organization_id, id, 7200000, 'NGN', 'bank_transfer', '00000000-0000-0000-0000-00000000000a', 'pay-1' from public.invoices$q$,
  'duplicate idempotency key must be rejected');

do $$
begin
  if (select status from public.invoices limit 1) <> 'partially_paid' then raise exception 'expected partially_paid'; end if;
end $$;

insert into public.payments (organization_id, invoice_id, amount_minor, currency, method, recorded_by)
  select organization_id, id, 10000000, 'NGN', 'cash', '00000000-0000-0000-0000-00000000000a' from public.invoices;
do $$
declare v public.invoices%rowtype;
begin
  select * into v from public.invoices limit 1;
  if v.status <> 'paid' or v.amount_paid_minor <> 17200000 then
    raise exception 'expected paid invoice, got % / %', v.status, v.amount_paid_minor;
  end if;
end $$;

-- Reversal re-opens the balance.
update public.payments set status = 'reversed' where amount_minor = 10000000;
do $$
begin
  if (select status from public.invoices limit 1) <> 'partially_paid' then raise exception 'reversal did not reopen invoice'; end if;
end $$;
select pg_temp.expect_error($q$update public.payments set amount_minor = 1$q$, 'payment amounts are immutable');
delete from public.payments; -- no delete policy: silently filtered by RLS
do $$
begin
  if (select count(*) from public.payments) <> 2 then raise exception 'payments were deleted'; end if;
end $$;

-- Execution engine tables are server-write only.
select pg_temp.expect_error(
  $q$insert into public.executions (organization_id, created_by, goal, originating_request)
     select org, '00000000-0000-0000-0000-00000000000a', 'x', 'x' from ctx$q$,
  'clients cannot create executions directly');

-- Audit logs are append-only.
insert into public.audit_logs (organization_id, actor_user_id, action, resource_type)
  select org, '00000000-0000-0000-0000-00000000000a', 'test.event', 'test' from ctx;
reset role;
select pg_temp.expect_error($q$update public.audit_logs set action = 'tampered'$q$, 'audit logs are immutable');
select pg_temp.expect_error($q$delete from public.audit_logs$q$, 'audit logs cannot be deleted');
set role authenticated;

-- Cross-tenant isolation --------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
do $$
begin
  if exists (select 1 from public.customers) then raise exception 'Bayo can see Acme customers'; end if;
  if exists (select 1 from public.invoices) then raise exception 'Bayo can see Acme invoices'; end if;
  if exists (select 1 from public.organizations where name = 'Acme Stores') then raise exception 'Bayo can see Acme org'; end if;
  if exists (select 1 from public.audit_logs where organization_id = (select org from ctx)) then raise exception 'Bayo can see Acme audit logs'; end if;
end $$;
select pg_temp.expect_error(
  $q$insert into public.customers (organization_id, name) select id, 'intruder' from public.organizations where false
     union all select org, 'intruder' from ctx$q$,
  'Bayo cannot insert into Acme');
update public.customers set name = 'hacked';
select pg_temp.act_as(null);
do $$
begin
  if exists (select 1 from public.customers where name = 'hacked') then raise exception 'cross-tenant update succeeded'; end if;
end $$;

-- Bayo joins Acme as viewer: read-only.
insert into public.organization_members (organization_id, user_id, role) select org, '00000000-0000-0000-0000-00000000000b', 'viewer' from ctx;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
do $$
begin
  if not exists (select 1 from public.customers) then raise exception 'viewer cannot read'; end if;
end $$;
select pg_temp.expect_error($q$insert into public.customers (organization_id, name) select org, 'viewer write' from ctx$q$,
  'viewers cannot write');
select pg_temp.expect_error($q$select public.next_document_number((select org from ctx), 'invoice')$q$,
  'viewers cannot allocate document numbers');
select pg_temp.expect_error($q$select public.update_member_role((select org from ctx), '00000000-0000-0000-0000-00000000000b', 'admin')$q$,
  'viewer cannot self-promote');

-- Owner protections.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select pg_temp.expect_error($q$select public.update_member_role((select org from ctx), '00000000-0000-0000-0000-00000000000a', 'member')$q$,
  'last owner cannot be demoted');
select public.update_member_role((select org from ctx), '00000000-0000-0000-0000-00000000000b', 'member');

-- Invitations: admin-only, token-bound to email.
insert into public.invitations (organization_id, email, role, token_hash, invited_by)
  select org, 'chi@example.com', 'member', encode(digest('tok-123', 'sha256'), 'hex'), '00000000-0000-0000-0000-00000000000a' from ctx;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error($q$select public.accept_invitation('tok-123')$q$, 'invitation bound to another email');
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
select public.accept_invitation('tok-123');
do $$
begin
  if not exists (select 1 from public.customers) then raise exception 'invited member cannot read'; end if;
end $$;
select pg_temp.expect_error($q$select public.accept_invitation('tok-123')$q$, 'invitation cannot be reused');

-- Personal CareerVault data is private even within a shared org.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
insert into public.job_applications (organization_id, user_id, company, role_title)
  select org, '00000000-0000-0000-0000-00000000000a', 'Paystack', 'Engineer' from ctx;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000c');
do $$
begin
  if exists (select 1 from public.job_applications) then raise exception 'career data leaked to co-member'; end if;
end $$;

-- Preferences cannot point to a foreign org.
create temp table chi_org as select id from public.organizations where created_by = '00000000-0000-0000-0000-00000000000c' and kind = 'personal';
grant select on chi_org to authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select pg_temp.expect_error(
  $q$update public.user_preferences set active_organization_id = (select id from chi_org)$q$,
  'cannot switch to a workspace you do not belong to');

select pg_temp.act_as(null);
\echo '  tenancy & integrity: ok'
