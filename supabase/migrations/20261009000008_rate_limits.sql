-- Fixed-window rate limiting for public and authentication endpoints.
-- Called only by the server (service role). Keys are hashed by the caller.
create table public.rate_limits (
  key text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (key, window_start)
);
alter table public.rate_limits enable row level security; -- no policies: service role only

create or replace function public.rate_limit_hit(p_key text, p_window_seconds int, p_max int)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits int;
begin
  insert into public.rate_limits (key, window_start, hits) values (p_key, v_start, 1)
  on conflict (key, window_start) do update set hits = public.rate_limits.hits + 1
  returning hits into v_hits;
  -- Opportunistic cleanup of old windows.
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;
  return v_hits <= p_max;
end;
$$;
revoke execute on function public.rate_limit_hit(text, int, int) from public, anon, authenticated;

-- Link a sale to the invoice created from it (one invoice per sale).
create unique index invoices_sale_unique on public.invoices (sale_id) where sale_id is not null;
alter table public.purchase_orders add column sent_at timestamptz;
alter table public.purchase_orders add column sent_to text;
