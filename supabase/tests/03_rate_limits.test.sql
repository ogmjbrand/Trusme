\set QUIET on
\o /dev/null
set client_min_messages = warning;
do $$
declare ok boolean; i int;
begin
  for i in 1..3 loop
    ok := public.rate_limit_hit('test:key', 60, 3);
    if not ok then raise exception 'hit % should be allowed', i; end if;
  end loop;
  if public.rate_limit_hit('test:key', 60, 3) then raise exception '4th hit should be blocked'; end if;
  if not public.rate_limit_hit('other:key', 60, 3) then raise exception 'keys must be independent'; end if;
end $$;
set role authenticated;
do $$
begin
  begin
    perform public.rate_limit_hit('x', 60, 1);
    raise exception 'authenticated users must not call rate_limit_hit';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
\echo '  rate limits: ok'
