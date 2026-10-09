-- TrustOS row level security, integrity guards and transactional functions.
--
-- Principles:
--   * Every tenant table has RLS enabled.
--   * Reads require active membership of the row's organization.
--   * Writes to shared business data require role >= member; deletes >= admin.
--   * Viewers are read-only.
--   * Execution-engine tables, notifications, subscriptions and webhook events
--     are written only by the server (service role) after server-side checks.
--   * Derived values (stock on hand, invoice totals, paid amounts) can only be
--     changed by their owning triggers.

-- ---------------------------------------------------------------------------
-- Integrity guards for derived values
-- ---------------------------------------------------------------------------
create or replace function public.in_system_context()
returns boolean
language sql
stable
as $$
  select coalesce(current_setting('trustos.system_write', true), '') = 'on';
$$;

-- Wrap derived-value maintenance so guards know the write is trusted.
create or replace function public.apply_inventory_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('trustos.system_write', 'on', true);
  update public.products
     set stock_on_hand = stock_on_hand + new.quantity
   where id = new.product_id and organization_id = new.organization_id;
  if not found then
    perform set_config('trustos.system_write', '', true);
    raise exception 'product does not belong to organization' using errcode = '23503';
  end if;
  perform set_config('trustos.system_write', '', true);
  return new;
end;
$$;

create or replace function public.guard_product_update()
returns trigger
language plpgsql
as $$
begin
  if new.stock_on_hand is distinct from old.stock_on_hand and not public.in_system_context() then
    raise exception 'stock_on_hand is derived from inventory movements; record an adjustment instead'
      using errcode = '42501';
  end if;
  if new.organization_id is distinct from old.organization_id then
    raise exception 'organization_id is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger products_guard before update on public.products
  for each row execute function public.guard_product_update();

create or replace function public.recalculate_invoice_totals(p_invoice uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub bigint;
  v_tax bigint;
begin
  select coalesce(sum(round(quantity * unit_price_minor)), 0)::bigint,
         coalesce(sum(round(round(quantity * unit_price_minor) * tax_rate_bps / 10000.0)), 0)::bigint
    into v_sub, v_tax
    from public.invoice_items where invoice_id = p_invoice;

  perform set_config('trustos.system_write', 'on', true);
  update public.invoices
     set subtotal_minor = v_sub,
         tax_minor = v_tax,
         total_minor = greatest(v_sub + v_tax - discount_minor, 0)
   where id = p_invoice;
  perform set_config('trustos.system_write', '', true);
end;
$$;

create or replace function public.sync_invoice_payment_state(p_invoice uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_paid bigint;
  v_inv public.invoices%rowtype;
begin
  select * into v_inv from public.invoices where id = p_invoice for update;
  if not found then return; end if;

  select coalesce(sum(amount_minor), 0)::bigint into v_paid
    from public.payments where invoice_id = p_invoice and status = 'succeeded';

  perform set_config('trustos.system_write', 'on', true);
  update public.invoices
     set amount_paid_minor = v_paid,
         status = case
           when v_inv.status in ('void', 'draft') then v_inv.status
           when v_paid >= v_inv.total_minor and v_inv.total_minor > 0 then 'paid'
           when v_paid > 0 then 'partially_paid'
           else 'issued'
         end
   where id = p_invoice;
  perform set_config('trustos.system_write', '', true);

  -- Keep linked JobProof payment status in step with the invoice.
  update public.service_jobs j
     set payment_status = case
       when v_paid >= v_inv.total_minor and v_inv.total_minor > 0 then 'paid'
       when v_paid > 0 then 'partially_paid'
       else 'unpaid' end
   where j.invoice_id = p_invoice;
end;
$$;

create or replace function public.guard_invoice_update()
returns trigger
language plpgsql
as $$
begin
  if public.in_system_context() then
    return new;
  end if;
  if new.organization_id is distinct from old.organization_id then
    raise exception 'organization_id is immutable' using errcode = '42501';
  end if;
  if new.amount_paid_minor is distinct from old.amount_paid_minor
     or new.subtotal_minor is distinct from old.subtotal_minor
     or new.tax_minor is distinct from old.tax_minor
     or (new.total_minor is distinct from old.total_minor and new.discount_minor is not distinct from old.discount_minor) then
    raise exception 'invoice amounts are derived from line items and payments' using errcode = '42501';
  end if;
  if old.status <> 'draft' and (new.discount_minor is distinct from old.discount_minor
     or new.currency is distinct from old.currency or new.customer_id is distinct from old.customer_id) then
    raise exception 'issued invoices cannot change amounts, currency or customer' using errcode = '55000';
  end if;
  if new.status is distinct from old.status then
    if not (
      (old.status = 'draft' and new.status = 'issued') or
      (old.status in ('draft', 'issued') and new.status = 'void' and old.amount_paid_minor = 0)
    ) then
      raise exception 'invalid invoice status transition % -> %', old.status, new.status using errcode = '55000';
    end if;
    if new.status = 'issued' and new.total_minor <= 0 then
      raise exception 'cannot issue an invoice with a zero total' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;
create trigger invoices_guard before update on public.invoices
  for each row execute function public.guard_invoice_update();

-- Payments are financial records: amount, currency and invoice are immutable
-- once recorded. Corrections are made by reversing (status = 'reversed').
create or replace function public.guard_payment_update()
returns trigger
language plpgsql
as $$
begin
  if new.amount_minor is distinct from old.amount_minor
     or new.currency is distinct from old.currency
     or new.invoice_id is distinct from old.invoice_id
     or new.organization_id is distinct from old.organization_id
     or new.source is distinct from old.source
     or new.provider_reference is distinct from old.provider_reference then
    raise exception 'payment records are immutable; reverse and re-record instead' using errcode = '42501';
  end if;
  if old.status = 'reversed' and new.status <> 'reversed' then
    raise exception 'reversed payments cannot be reinstated' using errcode = '55000';
  end if;
  return new;
end;
$$;
create trigger payments_guard before update on public.payments
  for each row execute function public.guard_payment_update();

-- ---------------------------------------------------------------------------
-- Document numbering
-- ---------------------------------------------------------------------------
create table public.document_sequences (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('invoice', 'purchase_order', 'sale')),
  next_value bigint not null default 1,
  primary key (organization_id, kind)
);

create or replace function public.next_document_number(p_org uuid, p_kind text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_value bigint;
  v_prefix text := case p_kind when 'invoice' then 'INV' when 'purchase_order' then 'PO' when 'sale' then 'SL' end;
begin
  if auth.uid() is not null and not public.has_org_role(p_org, 'member') then
    raise exception 'insufficient permissions' using errcode = '42501';
  end if;
  if v_prefix is null then
    raise exception 'unknown document kind %', p_kind using errcode = '22023';
  end if;
  insert into public.document_sequences (organization_id, kind, next_value) values (p_org, p_kind, 2)
  on conflict (organization_id, kind) do update set next_value = public.document_sequences.next_value + 1
  returning next_value - 1 into v_value;
  return v_prefix || '-' || lpad(v_value::text, 5, '0');
end;
$$;

-- ---------------------------------------------------------------------------
-- Transactional business operations (SECURITY INVOKER: RLS applies)
-- ---------------------------------------------------------------------------

-- Record a sale: creates the sale, its lines (snapshotting product cost) and
-- the matching inventory movements in one transaction.
-- p_items: [{"product_id": uuid, "quantity": number, "unit_price_minor": int}]
create or replace function public.record_sale(
  p_org uuid,
  p_customer uuid,
  p_currency text,
  p_items jsonb,
  p_channel text default null,
  p_payment_fee_minor bigint default 0,
  p_shipping_cost_minor bigint default 0,
  p_discount_minor bigint default 0,
  p_occurred_at timestamptz default now(),
  p_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sale uuid;
  v_item jsonb;
  v_product public.products%rowtype;
  v_qty numeric;
begin
  if not public.has_org_role(p_org, 'member') then
    raise exception 'insufficient permissions' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'a sale needs at least one item' using errcode = '22023';
  end if;

  insert into public.sales (organization_id, customer_id, sale_number, channel, currency, occurred_at,
                            payment_fee_minor, shipping_cost_minor, discount_minor, notes, created_by)
  values (p_org, p_customer, public.next_document_number(p_org, 'sale'), p_channel, upper(p_currency), p_occurred_at,
          coalesce(p_payment_fee_minor, 0), coalesce(p_shipping_cost_minor, 0), coalesce(p_discount_minor, 0), p_notes, auth.uid())
  returning id into v_sale;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_product from public.products
     where id = (v_item ->> 'product_id')::uuid and organization_id = p_org;
    if not found then
      raise exception 'product % not found', v_item ->> 'product_id' using errcode = '23503';
    end if;
    if v_product.currency <> upper(p_currency) then
      raise exception 'product % is priced in %, sale is in %', v_product.sku, v_product.currency, upper(p_currency)
        using errcode = '22023';
    end if;
    v_qty := (v_item ->> 'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then
      raise exception 'quantity must be positive' using errcode = '22023';
    end if;

    insert into public.sale_items (organization_id, sale_id, product_id, quantity, unit_price_minor, unit_cost_minor)
    values (p_org, v_sale, v_product.id, v_qty,
            coalesce((v_item ->> 'unit_price_minor')::bigint, v_product.unit_price_minor),
            v_product.unit_cost_minor);

    insert into public.inventory_movements (organization_id, product_id, movement_type, quantity, unit_cost_minor,
                                            currency, reference_type, reference_id, occurred_at, created_by)
    values (p_org, v_product.id, 'sale', -v_qty, v_product.unit_cost_minor, v_product.currency, 'sale', v_sale,
            p_occurred_at, auth.uid());
  end loop;

  insert into public.audit_logs (organization_id, actor_user_id, action, resource_type, resource_id)
  values (p_org, auth.uid(), 'sale.recorded', 'sale', v_sale::text);
  return v_sale;
end;
$$;

-- Receive goods against a purchase order: increments stock, records cost
-- history and advances the PO status. p_lines: [{"item_id": uuid, "quantity": number}]
create or replace function public.receive_purchase_order(p_po uuid, p_lines jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_po public.purchase_orders%rowtype;
  v_line jsonb;
  v_item public.purchase_order_items%rowtype;
  v_qty numeric;
  v_open int;
begin
  select * into v_po from public.purchase_orders where id = p_po for update;
  if not found then
    raise exception 'purchase order not found' using errcode = '23503';
  end if;
  if not public.has_org_role(v_po.organization_id, 'member') then
    raise exception 'insufficient permissions' using errcode = '42501';
  end if;
  if v_po.status not in ('approved', 'sent', 'partially_received') then
    raise exception 'purchase order must be approved before receiving (status: %)', v_po.status using errcode = '55000';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into v_item from public.purchase_order_items
     where id = (v_line ->> 'item_id')::uuid and purchase_order_id = p_po for update;
    if not found then
      raise exception 'purchase order line not found' using errcode = '23503';
    end if;
    v_qty := (v_line ->> 'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then continue; end if;
    if v_item.received_quantity + v_qty > v_item.quantity then
      raise exception 'cannot receive more than ordered' using errcode = '22023';
    end if;

    update public.purchase_order_items set received_quantity = received_quantity + v_qty where id = v_item.id;

    insert into public.inventory_movements (organization_id, product_id, movement_type, quantity, unit_cost_minor,
                                            currency, reference_type, reference_id, created_by)
    values (v_po.organization_id, v_item.product_id, 'purchase_receipt', v_qty, v_item.unit_cost_minor,
            v_po.currency, 'purchase_order', p_po, auth.uid());

    insert into public.product_cost_history (organization_id, product_id, supplier_id, currency, unit_cost_minor,
                                             source, source_id, created_by)
    values (v_po.organization_id, v_item.product_id, v_po.supplier_id, v_po.currency, v_item.unit_cost_minor,
            'purchase_order', p_po, auth.uid());

    update public.products set unit_cost_minor = v_item.unit_cost_minor
     where id = v_item.product_id and currency = v_po.currency;
  end loop;

  select count(*) into v_open from public.purchase_order_items
   where purchase_order_id = p_po and received_quantity < quantity;
  update public.purchase_orders set status = case when v_open = 0 then 'received' else 'partially_received' end
   where id = p_po;

  insert into public.audit_logs (organization_id, actor_user_id, action, resource_type, resource_id, metadata)
  values (v_po.organization_id, auth.uid(), 'purchase_order.received', 'purchase_order', p_po::text, jsonb_build_object('lines', p_lines));
end;
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.invitations enable row level security;
alter table public.user_preferences enable row level security;
alter table public.subscriptions enable row level security;
alter table public.integration_connections enable row level security;
alter table public.audit_logs enable row level security;
alter table public.notifications enable row level security;
alter table public.uploaded_documents enable row level security;
alter table public.webhook_events enable row level security;
alter table public.document_sequences enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.executions enable row level security;
alter table public.execution_steps enable row level security;
alter table public.execution_events enable row level security;
alter table public.approval_requests enable row level security;
alter table public.regulatory_sources enable row level security;

-- Profiles: self, plus co-members' basic profile.
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or exists (
    select 1 from public.organization_members mine
    join public.organization_members theirs on theirs.organization_id = mine.organization_id
    where mine.user_id = auth.uid() and mine.status = 'active' and theirs.user_id = profiles.id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Organizations
create policy organizations_select on public.organizations for select to authenticated
  using (public.is_org_member(id));
create policy organizations_update on public.organizations for update to authenticated
  using (public.has_org_role(id, 'admin')) with check (public.has_org_role(id, 'admin'));
create policy organizations_delete on public.organizations for delete to authenticated
  using (public.has_org_role(id, 'owner') and kind = 'business');

-- Membership: visible to co-members; changed only through RPCs.
create policy organization_members_select on public.organization_members for select to authenticated
  using (public.is_org_member(organization_id));

-- Invitations: admins manage.
create policy invitations_select on public.invitations for select to authenticated
  using (public.has_org_role(organization_id, 'admin'));
create policy invitations_insert on public.invitations for insert to authenticated
  with check (
    public.has_org_role(organization_id, 'admin')
    and invited_by = auth.uid()
    and (role <> 'admin' or public.has_org_role(organization_id, 'owner'))
  );
create policy invitations_update on public.invitations for update to authenticated
  using (public.has_org_role(organization_id, 'admin'))
  with check (public.has_org_role(organization_id, 'admin'));

-- Preferences: own row; active org must be one the user belongs to.
create policy user_preferences_select on public.user_preferences for select to authenticated
  using (user_id = auth.uid());
create policy user_preferences_insert on public.user_preferences for insert to authenticated
  with check (user_id = auth.uid() and (active_organization_id is null or public.is_org_member(active_organization_id)));
create policy user_preferences_update on public.user_preferences for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and (active_organization_id is null or public.is_org_member(active_organization_id)));

create policy subscriptions_select on public.subscriptions for select to authenticated
  using (public.is_org_member(organization_id));

create policy integration_connections_select on public.integration_connections for select to authenticated
  using (public.is_org_member(organization_id));
create policy integration_connections_write on public.integration_connections for all to authenticated
  using (public.has_org_role(organization_id, 'admin'))
  with check (public.has_org_role(organization_id, 'admin'));

-- Audit logs: admins read; members append entries attributed to themselves.
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (public.has_org_role(organization_id, 'admin'));
create policy audit_logs_insert on public.audit_logs for insert to authenticated
  with check (public.is_org_member(organization_id) and actor_user_id = auth.uid() and actor_type in ('user', 'ai'));

create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Conversations & messages are private to their author within the org.
create policy conversations_owner on public.conversations for all to authenticated
  using (user_id = auth.uid() and public.is_org_member(organization_id))
  with check (user_id = auth.uid() and public.is_org_member(organization_id));
create policy messages_owner on public.messages for select to authenticated
  using (exists (select 1 from public.conversations c
                 where c.id = messages.conversation_id and c.user_id = auth.uid())
         and public.is_org_member(organization_id));

-- Execution engine: readable by org members; written by the server only.
create policy executions_select on public.executions for select to authenticated
  using (public.is_org_member(organization_id));
create policy execution_steps_select on public.execution_steps for select to authenticated
  using (public.is_org_member(organization_id));
create policy execution_events_select on public.execution_events for select to authenticated
  using (public.is_org_member(organization_id));
create policy approval_requests_select on public.approval_requests for select to authenticated
  using (public.is_org_member(organization_id));

create policy regulatory_sources_select on public.regulatory_sources for select to authenticated
  using (organization_id is null or public.is_org_member(organization_id));
create policy regulatory_sources_write on public.regulatory_sources for all to authenticated
  using (organization_id is not null and public.has_org_role(organization_id, 'admin'))
  with check (organization_id is not null and public.has_org_role(organization_id, 'admin'));

-- Shared business tables: generic policy set.
do $$
declare
  t text;
begin
  foreach t in array array[
    'customers', 'suppliers', 'products', 'product_cost_history', 'purchase_orders', 'purchase_order_items',
    'invoices', 'invoice_items', 'payment_promises', 'payment_reminders', 'sales', 'sale_items', 'expenses',
    'risk_assessments', 'risk_signals', 'scam_reports',
    'service_jobs', 'service_agreements', 'job_change_requests', 'job_evidence',
    'income_entries', 'recurring_obligations', 'savings_goals', 'cash_flow_forecasts',
    'launch_projects', 'launch_tasks', 'launch_applications', 'launch_suppliers', 'label_reviews', 'expert_handoffs',
    'uploaded_documents'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_org_member(organization_id))',
                   t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.has_org_role(organization_id, ''member''))',
                   t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.has_org_role(organization_id, ''member'')) with check (public.has_org_role(organization_id, ''member''))',
                   t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.has_org_role(organization_id, ''admin''))',
                   t || '_delete', t);
  end loop;
end;
$$;

-- Append-only ledgers: read + insert only.
alter table public.inventory_movements enable row level security;
create policy inventory_movements_select on public.inventory_movements for select to authenticated
  using (public.is_org_member(organization_id));
create policy inventory_movements_insert on public.inventory_movements for insert to authenticated
  with check (public.has_org_role(organization_id, 'member') and created_by = auth.uid());

alter table public.job_updates enable row level security;
create policy job_updates_select on public.job_updates for select to authenticated
  using (public.is_org_member(organization_id));
create policy job_updates_insert on public.job_updates for insert to authenticated
  with check (public.has_org_role(organization_id, 'member') and created_by = auth.uid() and author_party = 'provider');

-- Payments: members record manual payments; provider-verified payments are
-- written only by the webhook handler (service role). No deletes.
alter table public.payments enable row level security;
create policy payments_select on public.payments for select to authenticated
  using (public.is_org_member(organization_id));
create policy payments_insert on public.payments for insert to authenticated
  with check (public.has_org_role(organization_id, 'member') and source = 'manual'
              and recorded_by = auth.uid() and status in ('succeeded', 'pending'));
create policy payments_update on public.payments for update to authenticated
  using (public.has_org_role(organization_id, 'admin'))
  with check (public.has_org_role(organization_id, 'admin'));

-- Personal (per-user) records within a workspace: CareerVault.
do $$
declare
  t text;
begin
  foreach t in array array[
    'career_profiles', 'career_skills', 'employment_history', 'credentials', 'portfolio_projects',
    'job_applications', 'application_documents'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for all to authenticated using (user_id = auth.uid() and public.is_org_member(organization_id)) with check (user_id = auth.uid() and public.is_org_member(organization_id))',
                   t || '_owner', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Storage: private 'documents' bucket; objects stored under <org_id>/...
-- (Skipped automatically when the storage schema is unavailable, e.g. plain
-- PostgreSQL used for local policy tests.)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage')
     and exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('documents', 'documents', false, 10485760)
    on conflict (id) do nothing;

    execute $p$create policy "documents read for org members" on storage.objects for select to authenticated
      using (bucket_id = 'documents' and public.is_org_member(((storage.foldername(name))[1])::uuid))$p$;
    execute $p$create policy "documents upload for org members" on storage.objects for insert to authenticated
      with check (bucket_id = 'documents' and public.has_org_role(((storage.foldername(name))[1])::uuid, 'member'))$p$;
    execute $p$create policy "documents delete for org admins" on storage.objects for delete to authenticated
      using (bucket_id = 'documents' and public.has_org_role(((storage.foldername(name))[1])::uuid, 'admin'))$p$;
  end if;
end;
$$;
