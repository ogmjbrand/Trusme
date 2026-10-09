-- TrustOS connected business data: customers, suppliers, products, inventory,
-- purchasing, sales, invoices, payments and expenses.
--
-- Money is stored as integer minor units (e.g. kobo, cents) in bigint columns
-- together with an explicit ISO-4217 currency code. Amounts in different
-- currencies are never summed in the database.

create domain public.currency_code as char(3) check (value ~ '^[A-Z]{3}$');
create domain public.money_minor as bigint;

-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  email text,
  phone text,
  company text,
  address text,
  notes text,
  consent_email boolean not null default false,
  consent_sms boolean not null default false,
  consent_whatsapp boolean not null default false,
  is_sample boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index customers_org_idx on public.customers (organization_id, name);
create trigger customers_updated_at before update on public.customers
  for each row execute function public.set_updated_at();

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  contact_name text,
  email text,
  phone text,
  address text,
  lead_time_days int check (lead_time_days >= 0),
  notes text,
  is_sample boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index suppliers_org_idx on public.suppliers (organization_id, name);
create trigger suppliers_updated_at before update on public.suppliers
  for each row execute function public.set_updated_at();

create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  sku text not null check (char_length(sku) between 1 and 64),
  name text not null check (char_length(name) between 1 and 200),
  category text,
  unit text not null default 'unit',
  currency public.currency_code not null default 'NGN',
  unit_price_minor public.money_minor not null default 0 check (unit_price_minor >= 0),
  unit_cost_minor public.money_minor not null default 0 check (unit_cost_minor >= 0),
  reorder_point numeric(14, 3) not null default 0 check (reorder_point >= 0),
  reorder_quantity numeric(14, 3) not null default 0 check (reorder_quantity >= 0),
  lead_time_days int check (lead_time_days >= 0),
  preferred_supplier_id uuid references public.suppliers (id) on delete set null,
  -- Maintained exclusively by the inventory_movements trigger.
  stock_on_hand numeric(14, 3) not null default 0,
  is_active boolean not null default true,
  is_sample boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, sku)
);
create trigger products_updated_at before update on public.products
  for each row execute function public.set_updated_at();

create table public.product_cost_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  supplier_id uuid references public.suppliers (id) on delete set null,
  currency public.currency_code not null,
  unit_cost_minor public.money_minor not null check (unit_cost_minor >= 0),
  source text not null check (source in ('manual', 'purchase_order', 'import')),
  source_id uuid,
  effective_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index product_cost_history_product_idx on public.product_cost_history (product_id, effective_at desc);

-- ---------------------------------------------------------------------------
-- Inventory movements are the single source of truth for stock quantities.
-- They are immutable: corrections are recorded as new adjustment movements.
-- ---------------------------------------------------------------------------
create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  movement_type text not null check (movement_type in
    ('opening', 'purchase_receipt', 'sale', 'adjustment', 'customer_return', 'spoilage', 'supplier_return')),
  quantity numeric(14, 3) not null check (quantity <> 0),
  unit_cost_minor public.money_minor,
  currency public.currency_code,
  reason text,
  reference_type text,
  reference_id uuid,
  occurred_at timestamptz not null default now(),
  is_sample boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (
    (movement_type in ('opening', 'purchase_receipt', 'customer_return') and quantity > 0) or
    (movement_type in ('sale', 'spoilage', 'supplier_return') and quantity < 0) or
    (movement_type = 'adjustment')
  )
);
create index inventory_movements_product_idx on public.inventory_movements (product_id, occurred_at desc);
create index inventory_movements_org_idx on public.inventory_movements (organization_id, occurred_at desc);
create trigger inventory_movements_immutable before update or delete on public.inventory_movements
  for each row execute function public.prevent_mutation();

create or replace function public.apply_inventory_movement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.products
     set stock_on_hand = stock_on_hand + new.quantity
   where id = new.product_id and organization_id = new.organization_id;
  if not found then
    raise exception 'product does not belong to organization' using errcode = '23503';
  end if;
  return new;
end;
$$;
create trigger inventory_movements_apply after insert on public.inventory_movements
  for each row execute function public.apply_inventory_movement();

-- ---------------------------------------------------------------------------
-- Purchasing
-- ---------------------------------------------------------------------------
create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  supplier_id uuid references public.suppliers (id) on delete set null,
  po_number text not null,
  status text not null default 'draft' check (status in
    ('draft', 'approved', 'sent', 'partially_received', 'received', 'cancelled')),
  currency public.currency_code not null default 'NGN',
  total_minor public.money_minor not null default 0,
  expected_at date,
  notes text,
  source_execution_id uuid references public.executions (id) on delete set null,
  is_sample boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, po_number)
);
create trigger purchase_orders_updated_at before update on public.purchase_orders
  for each row execute function public.set_updated_at();

create table public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  purchase_order_id uuid not null references public.purchase_orders (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete restrict,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_cost_minor public.money_minor not null check (unit_cost_minor >= 0),
  received_quantity numeric(14, 3) not null default 0 check (received_quantity >= 0),
  created_at timestamptz not null default now(),
  check (received_quantity <= quantity)
);
create index purchase_order_items_po_idx on public.purchase_order_items (purchase_order_id);

create or replace function public.recalculate_purchase_order_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po uuid := coalesce(new.purchase_order_id, old.purchase_order_id);
begin
  update public.purchase_orders po
     set total_minor = coalesce((
       select sum(round(i.quantity * i.unit_cost_minor))::bigint
       from public.purchase_order_items i where i.purchase_order_id = v_po
     ), 0)
   where po.id = v_po;
  return null;
end;
$$;
create trigger purchase_order_items_total after insert or update or delete on public.purchase_order_items
  for each row execute function public.recalculate_purchase_order_total();

-- ---------------------------------------------------------------------------
-- Invoices & receivables
-- ---------------------------------------------------------------------------
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete restrict,
  invoice_number text not null,
  status text not null default 'draft' check (status in ('draft', 'issued', 'partially_paid', 'paid', 'void')),
  currency public.currency_code not null default 'NGN',
  issue_date date not null default current_date,
  due_date date not null default current_date + 14,
  subtotal_minor public.money_minor not null default 0,
  tax_minor public.money_minor not null default 0,
  discount_minor public.money_minor not null default 0 check (discount_minor >= 0),
  total_minor public.money_minor not null default 0,
  amount_paid_minor public.money_minor not null default 0,
  notes text,
  sale_id uuid,
  service_job_id uuid,
  source_execution_id uuid references public.executions (id) on delete set null,
  issued_at timestamptz,
  voided_at timestamptz,
  is_sample boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, invoice_number),
  check (due_date >= issue_date)
);
create index invoices_org_status_idx on public.invoices (organization_id, status, due_date);
create index invoices_customer_idx on public.invoices (customer_id);
create trigger invoices_updated_at before update on public.invoices
  for each row execute function public.set_updated_at();

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  description text not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_price_minor public.money_minor not null check (unit_price_minor >= 0),
  -- Tax rate in basis points (750 = 7.5% VAT).
  tax_rate_bps int not null default 0 check (tax_rate_bps between 0 and 10000),
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index invoice_items_invoice_idx on public.invoice_items (invoice_id, position);

-- Recompute invoice totals from items. Rounds per line (half away from zero).
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

  update public.invoices
     set subtotal_minor = v_sub,
         tax_minor = v_tax,
         total_minor = greatest(v_sub + v_tax - discount_minor, 0)
   where id = p_invoice;
end;
$$;

create or replace function public.invoice_items_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice uuid := coalesce(new.invoice_id, old.invoice_id);
  v_status text;
begin
  select status into v_status from public.invoices where id = v_invoice;
  if v_status is not null and v_status <> 'draft' then
    raise exception 'line items can only be changed while the invoice is a draft' using errcode = '55000';
  end if;
  perform public.recalculate_invoice_totals(v_invoice);
  return null;
end;
$$;
create trigger invoice_items_totals after insert or update or delete on public.invoice_items
  for each row execute function public.invoice_items_changed();

create or replace function public.invoice_discount_changed()
returns trigger
language plpgsql
as $$
begin
  if new.discount_minor is distinct from old.discount_minor then
    new.total_minor := greatest(new.subtotal_minor + new.tax_minor - new.discount_minor, 0);
  end if;
  return new;
end;
$$;
create trigger invoices_discount before update of discount_minor on public.invoices
  for each row execute function public.invoice_discount_changed();

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  invoice_id uuid references public.invoices (id) on delete restrict,
  customer_id uuid references public.customers (id) on delete set null,
  amount_minor public.money_minor not null check (amount_minor > 0),
  currency public.currency_code not null,
  method text not null check (method in
    ('cash', 'bank_transfer', 'pos', 'card', 'mobile_money', 'paystack', 'stripe', 'other')),
  source text not null default 'manual' check (source in ('manual', 'provider_verified')),
  provider text check (provider in ('paystack', 'stripe')),
  provider_reference text,
  status text not null default 'succeeded' check (status in ('pending', 'succeeded', 'failed', 'reversed')),
  received_at timestamptz not null default now(),
  verified_at timestamptz,
  idempotency_key text,
  notes text,
  is_sample boolean not null default false,
  recorded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  unique (provider, provider_reference),
  check ((source = 'provider_verified') = (provider is not null and provider_reference is not null and verified_at is not null))
);
create index payments_invoice_idx on public.payments (invoice_id);
create index payments_org_received_idx on public.payments (organization_id, received_at desc);
create trigger payments_updated_at before update on public.payments
  for each row execute function public.set_updated_at();

-- Keep invoice paid amount and status consistent with succeeded payments.
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

  update public.invoices
     set amount_paid_minor = v_paid,
         status = case
           when v_inv.status in ('void', 'draft') then v_inv.status
           when v_paid >= v_inv.total_minor and v_inv.total_minor > 0 then 'paid'
           when v_paid > 0 then 'partially_paid'
           else 'issued'
         end
   where id = p_invoice;
end;
$$;

create or replace function public.payments_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.invoices%rowtype;
begin
  if tg_op in ('INSERT', 'UPDATE') and new.invoice_id is not null then
    select * into v_inv from public.invoices where id = new.invoice_id;
    if v_inv.organization_id <> new.organization_id then
      raise exception 'invoice does not belong to organization' using errcode = '23503';
    end if;
    if v_inv.currency <> new.currency then
      raise exception 'payment currency % does not match invoice currency %', new.currency, v_inv.currency
        using errcode = '22023';
    end if;
    if v_inv.status in ('draft', 'void') then
      raise exception 'payments can only be recorded against issued invoices' using errcode = '55000';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.invoice_id is distinct from new.invoice_id and old.invoice_id is not null then
    perform public.sync_invoice_payment_state(old.invoice_id);
  end if;
  if tg_op = 'DELETE' then
    if old.invoice_id is not null then perform public.sync_invoice_payment_state(old.invoice_id); end if;
    return null;
  end if;
  if new.invoice_id is not null then
    perform public.sync_invoice_payment_state(new.invoice_id);
  end if;
  return null;
end;
$$;
create trigger payments_sync after insert or update or delete on public.payments
  for each row execute function public.payments_changed();

create table public.payment_promises (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  promised_amount_minor public.money_minor not null check (promised_amount_minor > 0),
  promised_date date not null,
  status text not null default 'open' check (status in ('open', 'kept', 'broken', 'cancelled')),
  note text,
  recorded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payment_promises_invoice_idx on public.payment_promises (invoice_id);
create trigger payment_promises_updated_at before update on public.payment_promises
  for each row execute function public.set_updated_at();

-- Reminder drafts vs sent messages are distinct states. 'sent' is only set
-- after the delivery provider accepts the message.
create table public.payment_reminders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  channel text not null check (channel in ('email', 'sms', 'whatsapp')),
  recipient text,
  subject text,
  body text not null,
  status text not null default 'draft' check (status in ('draft', 'approved', 'sent', 'failed', 'cancelled')),
  scheduled_for timestamptz,
  sent_at timestamptz,
  provider text,
  provider_message_id text,
  failure_reason text,
  execution_id uuid references public.executions (id) on delete set null,
  idempotency_key text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);
create index payment_reminders_invoice_idx on public.payment_reminders (invoice_id, created_at desc);
create trigger payment_reminders_updated_at before update on public.payment_reminders
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Sales (feed inventory and profitability)
-- ---------------------------------------------------------------------------
create table public.sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,
  sale_number text not null,
  channel text,
  currency public.currency_code not null default 'NGN',
  occurred_at timestamptz not null default now(),
  -- Order-level direct costs, allocated to lines by revenue share in analysis.
  payment_fee_minor public.money_minor not null default 0 check (payment_fee_minor >= 0),
  shipping_cost_minor public.money_minor not null default 0 check (shipping_cost_minor >= 0),
  discount_minor public.money_minor not null default 0 check (discount_minor >= 0),
  invoice_id uuid references public.invoices (id) on delete set null,
  notes text,
  is_sample boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, sale_number)
);
create index sales_org_occurred_idx on public.sales (organization_id, occurred_at desc);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  sale_id uuid not null references public.sales (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete restrict,
  quantity numeric(14, 3) not null check (quantity > 0),
  unit_price_minor public.money_minor not null check (unit_price_minor >= 0),
  -- Cost snapshot at time of sale (COGS).
  unit_cost_minor public.money_minor not null check (unit_cost_minor >= 0),
  returned_quantity numeric(14, 3) not null default 0 check (returned_quantity >= 0),
  created_at timestamptz not null default now(),
  check (returned_quantity <= quantity)
);
create index sale_items_sale_idx on public.sale_items (sale_id);
create index sale_items_product_idx on public.sale_items (product_id);

alter table public.invoices
  add constraint invoices_sale_fk foreign key (sale_id) references public.sales (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Expenses
-- ---------------------------------------------------------------------------
create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  description text not null,
  category text not null default 'general',
  -- cost_type controls how MarginGuard treats it. Expenses linked to a
  -- purchase order are excluded from COGS to avoid double counting.
  cost_type text not null default 'overhead' check (cost_type in
    ('inventory_purchase', 'shipping', 'payment_fee', 'other_direct', 'overhead', 'personal')),
  amount_minor public.money_minor not null check (amount_minor > 0),
  currency public.currency_code not null default 'NGN',
  incurred_at date not null default current_date,
  supplier_id uuid references public.suppliers (id) on delete set null,
  product_id uuid references public.products (id) on delete set null,
  purchase_order_id uuid references public.purchase_orders (id) on delete set null,
  launch_project_id uuid,
  receipt_document_id uuid references public.uploaded_documents (id) on delete set null,
  is_sample boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index expenses_org_incurred_idx on public.expenses (organization_id, incurred_at desc);
create trigger expenses_updated_at before update on public.expenses
  for each row execute function public.set_updated_at();
