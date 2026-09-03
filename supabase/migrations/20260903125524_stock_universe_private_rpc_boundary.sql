-- Keep privileged implementations outside the exposed API schema. Public RPCs
-- are invoker wrappers; callers still have no access to either credential table.
alter function public.register_stock_universe_reader(text,text) set schema universe_private;
alter function public.list_stock_universe_readers() set schema universe_private;
alter function public.revoke_stock_universe_reader(uuid) set schema universe_private;
alter function public.read_stock_universe(text) set schema universe_private;
grant usage on schema universe_private to anon, authenticated;
create policy reader_credentials_deny_direct_access on universe_private.reader_credentials
  for all to public using (false) with check (false);

create function public.register_stock_universe_reader(p_token text,p_label text)
returns jsonb language sql security invoker set search_path='' as $$
  select universe_private.register_stock_universe_reader(p_token,p_label);
$$;
create function public.list_stock_universe_readers()
returns jsonb language sql security invoker set search_path='' as $$
  select universe_private.list_stock_universe_readers();
$$;
create function public.revoke_stock_universe_reader(p_id uuid)
returns void language sql security invoker set search_path='' as $$
  select universe_private.revoke_stock_universe_reader(p_id);
$$;
create function public.read_stock_universe(p_token text)
returns jsonb language sql security invoker set search_path='' as $$
  select universe_private.read_stock_universe(p_token);
$$;
revoke all on function public.register_stock_universe_reader(text,text) from public,anon,authenticated;
revoke all on function public.list_stock_universe_readers() from public,anon,authenticated;
revoke all on function public.revoke_stock_universe_reader(uuid) from public,anon,authenticated;
revoke all on function public.read_stock_universe(text) from public,anon,authenticated;
grant execute on function public.register_stock_universe_reader(text,text) to authenticated;
grant execute on function public.list_stock_universe_readers() to authenticated;
grant execute on function public.revoke_stock_universe_reader(uuid) to authenticated;
grant execute on function public.read_stock_universe(text) to anon;
