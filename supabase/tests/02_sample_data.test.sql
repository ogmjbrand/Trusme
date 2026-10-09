\set QUIET on
\o /dev/null
set client_min_messages = warning;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1', 'demo@example.com');
create temp table d as select id as org from public.organizations where created_by = '00000000-0000-0000-0000-0000000000d1';
grant select on d to authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000d1', false);
set role authenticated;
select public.load_sample_data((select org from d));
do $$
begin
  if (select count(*) from public.products where is_sample) <> 4 then raise exception 'sample products missing'; end if;
  if (select stock_on_hand from public.products where sku = 'SMP-RICE50') <> 30 - 22 then
    raise exception 'unexpected rice stock %', (select stock_on_hand from public.products where sku = 'SMP-RICE50');
  end if;
  if (select status from public.invoices i join public.customers c on c.id = i.customer_id where c.name like '%Kunle%') <> 'partially_paid' then
    raise exception 'sample partial payment not applied';
  end if;
  if exists (select 1 from public.customers where not is_sample) then raise exception 'unlabelled sample rows'; end if;
end $$;
-- Real record referencing a sample product survives removal.
insert into public.customers (organization_id, name) select org, 'Real customer' from d;
select public.remove_sample_data((select org from d));
do $$
begin
  if exists (select 1 from public.products where is_sample) then raise exception 'sample products not removed'; end if;
  if exists (select 1 from public.invoices) then raise exception 'sample invoices not removed'; end if;
  if not exists (select 1 from public.customers where name = 'Real customer') then raise exception 'real data was removed'; end if;
end $$;
reset role;
\echo '  sample data load/remove: ok'
