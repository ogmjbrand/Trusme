-- Explicitly labelled sample data (is_sample = true) for exploring TrustOS.
-- Sample rows are always shown with a "Sample" badge in the UI and can be
-- removed in one step. They are never mixed into real records silently.

-- Allow trusted maintenance (sample removal) to delete sample ledger rows.
create or replace function public.prevent_movement_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and public.in_system_context() and old.is_sample then
    return old;
  end if;
  raise exception 'inventory_movements is append-only' using errcode = '42501';
end;
$$;
drop trigger inventory_movements_immutable on public.inventory_movements;
create trigger inventory_movements_immutable before update or delete on public.inventory_movements
  for each row execute function public.prevent_movement_mutation();

create or replace function public.load_sample_data(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_c1 uuid; v_c2 uuid; v_c3 uuid;
  v_s1 uuid; v_s2 uuid;
  v_p1 uuid; v_p2 uuid; v_p3 uuid; v_p4 uuid;
  v_inv uuid;
  v_sale uuid;
  i int;
begin
  if not public.has_org_role(p_org, 'admin') then
    raise exception 'only admins can load sample data' using errcode = '42501';
  end if;
  if exists (select 1 from public.customers where organization_id = p_org and is_sample) then
    raise exception 'sample data is already loaded' using errcode = '22023';
  end if;

  insert into public.customers (organization_id, name, email, phone, company, consent_email, is_sample, created_by) values
    (p_org, 'Sample: Adaeze Stores', 'adaeze.sample@example.com', '+2348000000001', 'Adaeze Stores', true, true, v_uid) returning id into v_c1;
  insert into public.customers (organization_id, name, email, phone, consent_email, is_sample, created_by) values
    (p_org, 'Sample: Kunle Catering', 'kunle.sample@example.com', '+2348000000002', true, true, v_uid) returning id into v_c2;
  insert into public.customers (organization_id, name, phone, is_sample, created_by) values
    (p_org, 'Sample: Halima Boutique', '+2348000000003', true, v_uid) returning id into v_c3;

  insert into public.suppliers (organization_id, name, contact_name, email, lead_time_days, is_sample, created_by) values
    (p_org, 'Sample: Lagos Grains Ltd', 'Musa', 'grains.sample@example.com', 5, true, v_uid) returning id into v_s1;
  insert into public.suppliers (organization_id, name, contact_name, email, lead_time_days, is_sample, created_by) values
    (p_org, 'Sample: Onitsha Packaging', 'Chika', 'pack.sample@example.com', 10, true, v_uid) returning id into v_s2;

  insert into public.products (organization_id, sku, name, category, currency, unit_price_minor, unit_cost_minor, reorder_point, reorder_quantity, lead_time_days, preferred_supplier_id, is_sample, created_by)
    values (p_org, 'SMP-RICE50', 'Sample: Rice 50kg', 'Grains', 'NGN', 8500000, 6900000, 8, 20, 5, v_s1, true, v_uid) returning id into v_p1;
  insert into public.products (organization_id, sku, name, category, currency, unit_price_minor, unit_cost_minor, reorder_point, reorder_quantity, lead_time_days, preferred_supplier_id, is_sample, created_by)
    values (p_org, 'SMP-BEANS25', 'Sample: Beans 25kg', 'Grains', 'NGN', 5200000, 4600000, 6, 15, 5, v_s1, true, v_uid) returning id into v_p2;
  insert into public.products (organization_id, sku, name, category, currency, unit_price_minor, unit_cost_minor, reorder_point, reorder_quantity, lead_time_days, preferred_supplier_id, is_sample, created_by)
    values (p_org, 'SMP-OIL5L', 'Sample: Vegetable Oil 5L', 'Oils', 'NGN', 1450000, 1150000, 12, 30, 7, v_s1, true, v_uid) returning id into v_p3;
  insert into public.products (organization_id, sku, name, category, currency, unit_price_minor, unit_cost_minor, reorder_point, reorder_quantity, lead_time_days, preferred_supplier_id, is_sample, created_by)
    values (p_org, 'SMP-BAG100', 'Sample: Packaging Bags (100)', 'Packaging', 'NGN', 450000, 300000, 20, 50, 10, v_s2, true, v_uid) returning id into v_p4;

  insert into public.inventory_movements (organization_id, product_id, movement_type, quantity, unit_cost_minor, currency, reason, occurred_at, is_sample, created_by) values
    (p_org, v_p1, 'opening', 30, 6900000, 'NGN', 'Sample opening stock', now() - interval '50 days', true, v_uid),
    (p_org, v_p2, 'opening', 20, 4600000, 'NGN', 'Sample opening stock', now() - interval '50 days', true, v_uid),
    (p_org, v_p3, 'opening', 60, 1150000, 'NGN', 'Sample opening stock', now() - interval '50 days', true, v_uid),
    (p_org, v_p4, 'opening', 40, 300000, 'NGN', 'Sample opening stock', now() - interval '50 days', true, v_uid),
    (p_org, v_p3, 'spoilage', -3, 1150000, 'NGN', 'Sample: leaking containers', now() - interval '6 days', true, v_uid);

  -- Sales spread over ~45 days; costs rise in the recent period for beans.
  for i in 0..14 loop
    insert into public.sales (organization_id, customer_id, sale_number, channel, currency, occurred_at, payment_fee_minor, shipping_cost_minor, is_sample, created_by)
    values (p_org, case i % 3 when 0 then v_c1 when 1 then v_c2 else v_c3 end, public.next_document_number(p_org, 'sale'),
            case when i % 2 = 0 then 'shop' else 'whatsapp' end, 'NGN', now() - make_interval(days => 45 - i * 3),
            case when i % 2 = 0 then 0 else 15000 end, case when i % 4 = 0 then 250000 else 0 end, true, v_uid)
    returning id into v_sale;
    insert into public.sale_items (organization_id, sale_id, product_id, quantity, unit_price_minor, unit_cost_minor) values
      (p_org, v_sale, v_p1, 1 + (i % 2), 8500000, 6900000),
      (p_org, v_sale, v_p2, 1, 5200000, case when i >= 8 then 5050000 else 4600000 end),
      (p_org, v_sale, v_p3, 2 + (i % 3), 1450000, 1150000);
    insert into public.inventory_movements (organization_id, product_id, movement_type, quantity, unit_cost_minor, currency, reference_type, reference_id, occurred_at, is_sample, created_by) values
      (p_org, v_p1, 'sale', -(1 + (i % 2)), 6900000, 'NGN', 'sale', v_sale, now() - make_interval(days => 45 - i * 3), true, v_uid),
      (p_org, v_p2, 'sale', -1, case when i >= 8 then 5050000 else 4600000 end, 'NGN', 'sale', v_sale, now() - make_interval(days => 45 - i * 3), true, v_uid),
      (p_org, v_p3, 'sale', -(2 + (i % 3)), 1150000, 'NGN', 'sale', v_sale, now() - make_interval(days => 45 - i * 3), true, v_uid);
  end loop;

  insert into public.expenses (organization_id, description, category, cost_type, amount_minor, currency, incurred_at, product_id, is_sample, created_by) values
    (p_org, 'Sample: delivery to customers (beans)', 'Logistics', 'shipping', 900000, 'NGN', current_date - 10, v_p2, true, v_uid),
    (p_org, 'Sample: shop rent', 'Rent', 'overhead', 15000000, 'NGN', current_date - 20, null, true, v_uid);

  -- Invoices: one overdue, one partially paid and overdue, one current.
  insert into public.invoices (organization_id, customer_id, invoice_number, status, currency, issue_date, due_date, is_sample, created_by)
    values (p_org, v_c1, public.next_document_number(p_org, 'invoice'), 'draft', 'NGN', current_date - 40, current_date - 26, true, v_uid) returning id into v_inv;
  insert into public.invoice_items (organization_id, invoice_id, description, quantity, unit_price_minor, tax_rate_bps, product_id) values
    (p_org, v_inv, 'Rice 50kg', 3, 8500000, 0, v_p1);
  perform set_config('trustos.system_write', 'on', true);
  update public.invoices set status = 'issued', issued_at = now() - interval '40 days' where id = v_inv;
  perform set_config('trustos.system_write', '', true);

  insert into public.invoices (organization_id, customer_id, invoice_number, status, currency, issue_date, due_date, is_sample, created_by)
    values (p_org, v_c2, public.next_document_number(p_org, 'invoice'), 'draft', 'NGN', current_date - 20, current_date - 6, true, v_uid) returning id into v_inv;
  insert into public.invoice_items (organization_id, invoice_id, description, quantity, unit_price_minor, tax_rate_bps, product_id) values
    (p_org, v_inv, 'Catering supplies bundle', 1, 12000000, 750, null);
  perform set_config('trustos.system_write', 'on', true);
  update public.invoices set status = 'issued', issued_at = now() - interval '20 days' where id = v_inv;
  perform set_config('trustos.system_write', '', true);
  insert into public.payments (organization_id, invoice_id, customer_id, amount_minor, currency, method, received_at, is_sample, recorded_by, notes)
    values (p_org, v_inv, v_c2, 5000000, 'NGN', 'bank_transfer', now() - interval '3 days', true, v_uid, 'Sample part payment');

  insert into public.invoices (organization_id, customer_id, invoice_number, status, currency, issue_date, due_date, is_sample, created_by)
    values (p_org, v_c3, public.next_document_number(p_org, 'invoice'), 'draft', 'NGN', current_date - 2, current_date + 12, true, v_uid) returning id into v_inv;
  insert into public.invoice_items (organization_id, invoice_id, description, quantity, unit_price_minor, tax_rate_bps, product_id) values
    (p_org, v_inv, 'Vegetable Oil 5L', 10, 1450000, 0, v_p3);
  perform set_config('trustos.system_write', 'on', true);
  update public.invoices set status = 'issued', issued_at = now() - interval '2 days' where id = v_inv;
  perform set_config('trustos.system_write', '', true);

  insert into public.recurring_obligations (organization_id, name, category, amount_minor, currency, frequency, next_due_on, is_sample, created_by) values
    (p_org, 'Sample: Shop rent', 'Rent', 15000000, 'NGN', 'monthly', current_date + 9, true, v_uid),
    (p_org, 'Sample: Staff wages', 'Payroll', 18000000, 'NGN', 'monthly', current_date + 3, true, v_uid),
    (p_org, 'Sample: Generator diesel', 'Utilities', 2500000, 'NGN', 'weekly', current_date + 2, true, v_uid);
  insert into public.income_entries (organization_id, source, description, amount_minor, currency, received_on, is_sample, created_by) values
    (p_org, 'Sample: POS walk-in sales', 'Weekly cash takings', 9500000, 'NGN', current_date - 7, true, v_uid),
    (p_org, 'Sample: POS walk-in sales', 'Weekly cash takings', 8200000, 'NGN', current_date - 14, true, v_uid),
    (p_org, 'Sample: POS walk-in sales', 'Weekly cash takings', 10100000, 'NGN', current_date - 21, true, v_uid);

  insert into public.audit_logs (organization_id, actor_user_id, action, resource_type, resource_id)
  values (p_org, v_uid, 'sample_data.loaded', 'organization', p_org::text);
end;
$$;

create or replace function public.remove_sample_data(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_org_role(p_org, 'admin') then
    raise exception 'only admins can remove sample data' using errcode = '42501';
  end if;
  perform set_config('trustos.system_write', 'on', true);
  delete from public.payments where organization_id = p_org and is_sample;
  delete from public.invoices i where i.organization_id = p_org and i.is_sample
    and not exists (select 1 from public.payments p where p.invoice_id = i.id);
  delete from public.sales where organization_id = p_org and is_sample;
  delete from public.purchase_order_items poi using public.products p
    where poi.product_id = p.id and p.organization_id = p_org and p.is_sample;
  delete from public.purchase_orders po where po.organization_id = p_org and po.status = 'draft'
    and not exists (select 1 from public.purchase_order_items x where x.purchase_order_id = po.id);
  delete from public.expenses where organization_id = p_org and is_sample;
  delete from public.inventory_movements where organization_id = p_org and is_sample;
  delete from public.products p where p.organization_id = p_org and p.is_sample
    and not exists (select 1 from public.sale_items s where s.product_id = p.id)
    and not exists (select 1 from public.inventory_movements m where m.product_id = p.id);
  delete from public.suppliers where organization_id = p_org and is_sample;
  delete from public.customers c where c.organization_id = p_org and c.is_sample
    and not exists (select 1 from public.invoices i where i.customer_id = c.id);
  delete from public.recurring_obligations where organization_id = p_org and is_sample;
  delete from public.income_entries where organization_id = p_org and is_sample;
  perform set_config('trustos.system_write', '', true);
  insert into public.audit_logs (organization_id, actor_user_id, action, resource_type, resource_id)
  values (p_org, auth.uid(), 'sample_data.removed', 'organization', p_org::text);
end;
$$;
