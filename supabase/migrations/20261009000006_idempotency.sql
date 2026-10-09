-- Idempotency keys for records created by execution steps, so a retried step
-- can never create a duplicate invoice or purchase order.
alter table public.invoices add column idempotency_key text;
alter table public.invoices add constraint invoices_idempotency_unique unique (organization_id, idempotency_key);
alter table public.purchase_orders add column idempotency_key text;
alter table public.purchase_orders add constraint purchase_orders_idempotency_unique unique (organization_id, idempotency_key);
alter table public.risk_assessments add column idempotency_key text;
alter table public.risk_assessments add constraint risk_assessments_idempotency_unique unique (organization_id, idempotency_key);
alter table public.cash_flow_forecasts add column idempotency_key text;
alter table public.cash_flow_forecasts add constraint cash_flow_forecasts_idempotency_unique unique (organization_id, idempotency_key);
alter table public.application_documents add column idempotency_key text;
alter table public.application_documents add constraint application_documents_idempotency_unique unique (organization_id, idempotency_key);
alter table public.launch_projects add column idempotency_key text;
alter table public.launch_projects add constraint launch_projects_idempotency_unique unique (organization_id, idempotency_key);

-- Late binding: some steps (e.g. "send the reminders drafted above") resolve
-- their concrete targets just before approval. The approval hash covers the
-- resolved input, so approvers always see the exact recipients and amounts.
alter table public.execution_steps add column input_resolved boolean not null default false;
