-- REVIEWED PLAN ONLY. DO NOT EXECUTE WITHOUT A NEW EXPLICIT PRODUCTION AUTHORIZATION.
-- Target connection must be verified as fntslvdxnupmdljnadec; SQL alone cannot authenticate a project URL.
-- Run the complete file in ONE session with stop-on-error. Do not use full-repository db push.
-- This file records exactly two ledger rows. Do not wrap it in apply_migration (which adds another row).
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
lock table supabase_migrations.schema_migrations in share row exclusive mode;
do $preflight$
begin
 if current_user <> 'postgres' then raise exception 'unexpected_migration_owner'; end if;
 if to_regnamespace('market_private') is not null or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('market_data_account','market_data_worker')) then raise exception 'market_objects_already_exist'; end if;
 if (select jsonb_agg(jsonb_build_array(version,name) order by version) from supabase_migrations.schema_migrations) is distinct from '[ ["20260903132654","stock_universe_auto_add_v1a"], ["20260903132704","stock_universe_private_rpc_boundary"] ]'::jsonb then raise exception 'production_ledger_changed_re_review_required'; end if;
 if to_regprocedure('extensions.digest(text,text)') is null or to_regprocedure('auth.uid()') is null or to_regprocedure('auth.jwt()') is null then raise exception 'missing_dependency'; end if;
end $preflight$;

-- M1 (unmodified reviewed SQL)
-- Daily-only queue. All privileged implementations and tables are unexposed.
create schema if not exists market_private;
revoke all on schema market_private from public, anon, authenticated;
grant usage on schema market_private to anon, authenticated;
create table market_private.workers (
 id uuid primary key default gen_random_uuid(), owner uuid not null references auth.users(id),
 token_hash bytea unique not null, expires_at timestamptz not null default now()+interval '90 days'
);
create index market_worker_owner on market_private.workers(owner);
create table market_private.tasks (
 id uuid primary key default gen_random_uuid(), owner uuid not null references auth.users(id),
 symbol text not null check(symbol ~ '^(?:[0-9]{6}\.(?:SS|SZ)|[0-9]{4,5}\.HK)$'),
 status text not null default 'queued' check(status in ('queued','running','succeeded','failed')),
 requested_at timestamptz not null default now(), started_at timestamptz, completed_at timestamptz,
 worker_id uuid references market_private.workers(id), lease_until timestamptz, error text,
 result_version uuid
);
create unique index market_one_active on market_private.tasks(owner,symbol) where status in ('queued','running');
create index market_task_owner_time on market_private.tasks(owner,requested_at desc);
create table market_private.results (
 version uuid primary key references market_private.tasks(id), owner uuid not null references auth.users(id),
 symbol text not null, completed_at timestamptz not null default now(), payload jsonb not null
);
create index market_result_owner_symbol on market_private.results(owner,symbol,completed_at desc);
alter table market_private.workers enable row level security;
alter table market_private.tasks enable row level security;
alter table market_private.results enable row level security;
revoke all on all tables in schema market_private from public,anon,authenticated;
create policy no_direct_workers on market_private.workers for all using(false) with check(false);
create policy no_direct_tasks on market_private.tasks for all using(false) with check(false);
create policy no_direct_results on market_private.results for all using(false) with check(false);

create function market_private.task_json(t market_private.tasks) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('taskId',t.id,'taskType','UPDATE_DAILY_MARKET_DATA','symbol',t.symbol,
 'requestedBy',t.owner,'requestedAt',t.requested_at,'status',t.status,'startedAt',t.started_at,
 'completedAt',t.completed_at,'workerId',t.worker_id,'resultVersion',t.result_version,'error',t.error);
$$;

-- One account operation endpoint. Ownership always comes from the Auth session.
create function market_private.account(p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); t market_private.tasks; w market_private.workers; r jsonb; s text;
begin
 if u is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'authentication_required' using errcode='42501'; end if;
 if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'invalid_input'; end if;
 if p_action='request' then
  if p_input - array['symbol','taskType'] <> '{}'::jsonb or p_input->>'taskType' is distinct from 'UPDATE_DAILY_MARKET_DATA' then raise exception 'invalid_task'; end if;
  s:=p_input->>'symbol';
  if s is null or s !~ '^(?:[0-9]{6}\.(?:SS|SZ)|[0-9]{4,5}\.HK)$' then raise exception 'invalid_symbol'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text||s,0));
  update market_private.tasks set status='failed',completed_at=now(),error='worker_lease_expired' where owner=u and symbol=s and status='running' and lease_until<now();
  select * into t from market_private.tasks where owner=u and symbol=s and status in ('queued','running');
  if t.id is null then
   if (select count(*) from market_private.tasks where owner=u and status in ('queued','running'))>=50 then raise exception 'queue_limit'; end if;
   insert into market_private.tasks(owner,symbol) values(u,s) returning * into t;
  end if;
  return market_private.task_json(t);
 elsif p_action='read' then
  if p_input - array['taskId','symbol'] <> '{}'::jsonb then raise exception 'invalid_input'; end if;
  update market_private.tasks set status='failed',completed_at=now(),error='worker_lease_expired' where owner=u and status='running' and lease_until<now();
  select * into t from market_private.tasks where owner=u and
    ((p_input ? 'taskId' and id=(p_input->>'taskId')::uuid) or (not p_input ? 'taskId' and symbol=p_input->>'symbol')) order by requested_at desc limit 1;
  if t.id is null then return null; end if;
  select payload into r from market_private.results where owner=u and version=t.result_version;
  return market_private.task_json(t)||jsonb_build_object('result',r);
 elsif p_action='register_worker' then
  if p_input - array['token'] <> '{}'::jsonb or coalesce(p_input->>'token','') !~ '^[0-9a-f]{64}$' then raise exception 'invalid_token'; end if;
  -- V1 has one authorized executor per account. Rotation revokes the old capability.
  if exists(select 1 from market_private.tasks where owner=u and status='running' and lease_until>now()) then raise exception 'worker_busy'; end if;
  update market_private.workers set expires_at=now() where owner=u;
  insert into market_private.workers(owner,token_hash) values(u,extensions.digest(p_input->>'token','sha256')) returning * into w;
  return jsonb_build_object('workerId',w.id,'userId',u,'expiresAt',w.expires_at);
 elsif p_action='revoke_worker' then
  if p_input <> '{}'::jsonb then raise exception 'invalid_input'; end if;
  update market_private.workers set expires_at=now() where owner=u;
  update market_private.tasks set status='failed',completed_at=now(),error='worker_revoked' where owner=u and status='running';
  return jsonb_build_object('revoked',true);
 end if;
 raise exception 'invalid_action';
end $$;

-- Capability-bound executor endpoint: claim or complete a fixed daily task only.
create function market_private.worker(p_token text,p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w market_private.workers; t market_private.tasks; r jsonb; prev jsonb; row jsonb; last_date text; prior_date text:='';
begin
 if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'worker_unauthorized' using errcode='42501'; end if;
 select * into w from market_private.workers where token_hash=extensions.digest(p_token,'sha256') and expires_at>now();
 if w.id is null then raise exception 'worker_unauthorized' using errcode='42501'; end if;
 if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'invalid_input'; end if;
 perform pg_advisory_xact_lock(hashtextextended(w.owner::text,1));
 if p_action='claim' then
  if p_input <> '{}'::jsonb then raise exception 'invalid_input'; end if;
  update market_private.tasks set status='failed',completed_at=now(),error='worker_lease_expired' where owner=w.owner and status='running' and lease_until<now();
  if exists(select 1 from market_private.tasks where owner=w.owner and status='running') then return null; end if;
  select * into t from market_private.tasks where owner=w.owner and status='queued' order by requested_at for update skip locked limit 1;
  if t.id is null then return null; end if;
  update market_private.tasks set status='running',started_at=now(),worker_id=w.id,lease_until=now()+interval '10 minutes' where id=t.id returning * into t;
  select payload into prev from market_private.results where owner=w.owner and symbol=t.symbol order by completed_at desc limit 1;
  return market_private.task_json(t)||jsonb_build_object('previousResult',prev);
 elsif p_action='finish' then
  if p_input - array['taskId','result','error'] <> '{}'::jsonb then raise exception 'invalid_input'; end if;
  select * into t from market_private.tasks where id=(p_input->>'taskId')::uuid and owner=w.owner and worker_id=w.id for update;
  if t.id is null then raise exception 'task_not_owned' using errcode='42501'; end if;
  if t.status in ('succeeded','failed') then return market_private.task_json(t); end if;
  if t.status<>'running' then raise exception 'claim_expired'; end if;
  if t.lease_until<now() then
   update market_private.tasks set status='failed',completed_at=now(),error='worker_lease_expired' where id=t.id returning * into t;
   return market_private.task_json(t);
  end if;
  if p_input ? 'error' then
   update market_private.tasks set status='failed',error=left(p_input->>'error',240),completed_at=now() where id=t.id returning * into t;
   return market_private.task_json(t);
  end if;
  r:=p_input->'result';
  if r is null or jsonb_typeof(r)<>'object' or r - array['schemaVersion','taskId','symbol','provider','requestedAt','completedAt','resultVersion','latestCompleteBar','technicalAsOf','dataUpdated','warnings','fingerprint','stock'] <> '{}'::jsonb
   or r->>'taskId' is distinct from t.id::text or r->>'resultVersion' is distinct from t.id::text or r->>'symbol' is distinct from t.symbol or r->>'schemaVersion' is distinct from '1'
   or jsonb_typeof(r->'warnings') is distinct from 'array' or jsonb_typeof(r->'dataUpdated') is distinct from 'boolean'
   or coalesce(r->>'fingerprint','') !~ '^[0-9a-f]{64}$' or octet_length(r::text)>2097152 then raise exception 'invalid_result'; end if;
  if (r->'stock') - array['symbol','priceHistory','marketDataFreshness','technicalIndicators'] <> '{}'::jsonb or r#>>'{stock,symbol}' is distinct from t.symbol
   or jsonb_typeof(r#>'{stock,priceHistory}') is distinct from 'array' or jsonb_array_length(r#>'{stock,priceHistory}') not between 1 and 3000 then raise exception 'invalid_snapshot'; end if;
  for row in select value from jsonb_array_elements(r#>'{stock,priceHistory}') loop
   if row->>'is_complete_bar' is distinct from 'true' or coalesce(row->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' or row->>'date'<=prior_date
    or row->>'adjustment' is distinct from 'qfq' or row->>'price_basis' is distinct from 'adjusted' or row->>'provider' is distinct from r->>'provider'
    or coalesce((row->>'close')::numeric,0)<=0 then raise exception 'invalid_bar'; end if;
   prior_date:=row->>'date';
  end loop;
  last_date:=prior_date;
  if r->>'latestCompleteBar' is distinct from last_date or r->>'technicalAsOf' is distinct from last_date
    or r#>>'{stock,marketDataFreshness,last_trade_date}' is distinct from last_date or r#>>'{stock,technicalIndicators,last_trade_date}' is distinct from last_date then raise exception 'unaligned_result'; end if;
  r:=r||jsonb_build_object('completedAt',now(),'requestedAt',t.requested_at);
  insert into market_private.results(version,owner,symbol,payload) values(t.id,w.owner,t.symbol,r);
  update market_private.tasks set status='succeeded',completed_at=now(),result_version=id where id=t.id returning * into t;
  return market_private.task_json(t);
 end if;
 raise exception 'invalid_action';
end $$;

create function public.market_data_account(p_action text,p_input jsonb) returns jsonb language sql security invoker set search_path='' as $$ select market_private.account(p_action,p_input); $$;
create function public.market_data_worker(p_token text,p_action text,p_input jsonb) returns jsonb language sql security invoker set search_path='' as $$ select market_private.worker(p_token,p_action,p_input); $$;
revoke all on all functions in schema market_private from public,anon,authenticated;
revoke all on function public.market_data_account(text,jsonb) from public,anon,authenticated;
revoke all on function public.market_data_worker(text,text,jsonb) from public,anon,authenticated;
grant execute on function market_private.account(text,jsonb), public.market_data_account(text,jsonb) to authenticated;
grant execute on function market_private.worker(text,text,jsonb), public.market_data_worker(text,text,jsonb) to anon;

-- M2 (unmodified reviewed SQL; no intermediate COMMIT)
-- Minimal capability rotation/revocation race fix; existing grants and tables unchanged.
create or replace function market_private.account(p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); t market_private.tasks; w market_private.workers; r jsonb; s text;
begin
 if u is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'authentication_required' using errcode='42501'; end if;
 if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'invalid_input'; end if;
 -- Serialize account mutations and capability use under the same owner lock.
 perform pg_advisory_xact_lock(hashtextextended(u::text,1));
 if p_action='request' then
  if p_input - array['symbol','taskType'] <> '{}'::jsonb or p_input->>'taskType' is distinct from 'UPDATE_DAILY_MARKET_DATA' then raise exception 'invalid_task'; end if;
  s:=p_input->>'symbol';
  if s is null or s !~ '^(?:[0-9]{6}\.(?:SS|SZ)|[0-9]{4,5}\.HK)$' then raise exception 'invalid_symbol'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text||s,0));
  update market_private.tasks set status='failed',completed_at=now(),error='worker_lease_expired' where owner=u and symbol=s and status='running' and lease_until<now();
  select * into t from market_private.tasks where owner=u and symbol=s and status in ('queued','running');
  if t.id is null then
   if (select count(*) from market_private.tasks where owner=u and status in ('queued','running'))>=50 then raise exception 'queue_limit'; end if;
   insert into market_private.tasks(owner,symbol) values(u,s) returning * into t;
  end if;
  return market_private.task_json(t);
 elsif p_action='read' then
  if p_input - array['taskId','symbol'] <> '{}'::jsonb then raise exception 'invalid_input'; end if;
  update market_private.tasks set status='failed',completed_at=now(),error='worker_lease_expired' where owner=u and status='running' and lease_until<now();
  select * into t from market_private.tasks where owner=u and
    ((p_input ? 'taskId' and id=(p_input->>'taskId')::uuid) or (not p_input ? 'taskId' and symbol=p_input->>'symbol')) order by requested_at desc limit 1;
  if t.id is null then return null; end if;
  select payload into r from market_private.results where owner=u and version=t.result_version;
  return market_private.task_json(t)||jsonb_build_object('result',r);
 elsif p_action='register_worker' then
  if p_input - array['token'] <> '{}'::jsonb or coalesce(p_input->>'token','') !~ '^[0-9a-f]{64}$' then raise exception 'invalid_token'; end if;
  -- V1 has one authorized executor per account. Rotation revokes the old capability.
  if exists(select 1 from market_private.tasks where owner=u and status='running' and lease_until>now()) then raise exception 'worker_busy'; end if;
  update market_private.workers set expires_at=now() where owner=u;
  insert into market_private.workers(owner,token_hash) values(u,extensions.digest(p_input->>'token','sha256')) returning * into w;
  return jsonb_build_object('workerId',w.id,'userId',u,'expiresAt',w.expires_at);
 elsif p_action='revoke_worker' then
  if p_input <> '{}'::jsonb then raise exception 'invalid_input'; end if;
  update market_private.workers set expires_at=now() where owner=u;
  update market_private.tasks set status='failed',completed_at=now(),error='worker_revoked' where owner=u and status='running';
  return jsonb_build_object('revoked',true);
 end if;
 raise exception 'invalid_action';
end $$;

-- Capability-bound executor endpoint: claim or complete a fixed daily task only.
create or replace function market_private.worker(p_token text,p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w market_private.workers; t market_private.tasks; r jsonb; prev jsonb; row jsonb; last_date text; prior_date text:='';
begin
 if p_token is null or p_token !~ '^[0-9a-f]{64}$' then raise exception 'worker_unauthorized' using errcode='42501'; end if;
 select * into w from market_private.workers where token_hash=extensions.digest(p_token,'sha256') and expires_at>clock_timestamp();
 if w.id is null then raise exception 'worker_unauthorized' using errcode='42501'; end if;
 if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'invalid_input'; end if;
 perform pg_advisory_xact_lock(hashtextextended(w.owner::text,1));
 -- Rotation/revocation may have completed while this caller waited for the lock.
 select * into w from market_private.workers where id=w.id and expires_at>clock_timestamp();
 if w.id is null then raise exception 'worker_unauthorized' using errcode='42501'; end if;
 if p_action='claim' then
  if p_input <> '{}'::jsonb then raise exception 'invalid_input'; end if;
  update market_private.tasks set status='failed',completed_at=now(),error='worker_lease_expired' where owner=w.owner and status='running' and lease_until<now();
  if exists(select 1 from market_private.tasks where owner=w.owner and status='running') then return null; end if;
  select * into t from market_private.tasks where owner=w.owner and status='queued' order by requested_at for update skip locked limit 1;
  if t.id is null then return null; end if;
  update market_private.tasks set status='running',started_at=now(),worker_id=w.id,lease_until=now()+interval '10 minutes' where id=t.id returning * into t;
  select payload into prev from market_private.results where owner=w.owner and symbol=t.symbol order by completed_at desc limit 1;
  return market_private.task_json(t)||jsonb_build_object('previousResult',prev);
 elsif p_action='finish' then
  if p_input - array['taskId','result','error'] <> '{}'::jsonb then raise exception 'invalid_input'; end if;
  select * into t from market_private.tasks where id=(p_input->>'taskId')::uuid and owner=w.owner and worker_id=w.id for update;
  if t.id is null then raise exception 'task_not_owned' using errcode='42501'; end if;
  if t.status in ('succeeded','failed') then return market_private.task_json(t); end if;
  if t.status<>'running' then raise exception 'claim_expired'; end if;
  if t.lease_until<now() then
   update market_private.tasks set status='failed',completed_at=now(),error='worker_lease_expired' where id=t.id returning * into t;
   return market_private.task_json(t);
  end if;
  if p_input ? 'error' then
   update market_private.tasks set status='failed',error=left(p_input->>'error',240),completed_at=now() where id=t.id returning * into t;
   return market_private.task_json(t);
  end if;
  r:=p_input->'result';
  if r is null or jsonb_typeof(r)<>'object' or r - array['schemaVersion','taskId','symbol','provider','requestedAt','completedAt','resultVersion','latestCompleteBar','technicalAsOf','dataUpdated','warnings','fingerprint','stock'] <> '{}'::jsonb
   or r->>'taskId' is distinct from t.id::text or r->>'resultVersion' is distinct from t.id::text or r->>'symbol' is distinct from t.symbol or r->>'schemaVersion' is distinct from '1'
   or jsonb_typeof(r->'warnings') is distinct from 'array' or jsonb_typeof(r->'dataUpdated') is distinct from 'boolean'
   or coalesce(r->>'fingerprint','') !~ '^[0-9a-f]{64}$' or octet_length(r::text)>2097152 then raise exception 'invalid_result'; end if;
  if (r->'stock') - array['symbol','priceHistory','marketDataFreshness','technicalIndicators'] <> '{}'::jsonb or r#>>'{stock,symbol}' is distinct from t.symbol
   or jsonb_typeof(r#>'{stock,priceHistory}') is distinct from 'array' or jsonb_array_length(r#>'{stock,priceHistory}') not between 1 and 3000 then raise exception 'invalid_snapshot'; end if;
  for row in select value from jsonb_array_elements(r#>'{stock,priceHistory}') loop
   if row->>'is_complete_bar' is distinct from 'true' or coalesce(row->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' or row->>'date'<=prior_date
    or row->>'adjustment' is distinct from 'qfq' or row->>'price_basis' is distinct from 'adjusted' or row->>'provider' is distinct from r->>'provider'
    or coalesce((row->>'close')::numeric,0)<=0 then raise exception 'invalid_bar'; end if;
   prior_date:=row->>'date';
  end loop;
  last_date:=prior_date;
  if r->>'latestCompleteBar' is distinct from last_date or r->>'technicalAsOf' is distinct from last_date
    or r#>>'{stock,marketDataFreshness,last_trade_date}' is distinct from last_date or r#>>'{stock,technicalIndicators,last_trade_date}' is distinct from last_date then raise exception 'unaligned_result'; end if;
  r:=r||jsonb_build_object('completedAt',now(),'requestedAt',t.requested_at);
  insert into market_private.results(version,owner,symbol,payload) values(t.id,w.owner,t.symbol,r);
  update market_private.tasks set status='succeeded',completed_at=now(),result_version=id where id=t.id returning * into t;
  return market_private.task_json(t);
 end if;
 raise exception 'invalid_action';
end $$;

do $postcheck$
declare r text; t text;
begin
 if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='market_private' and c.relkind='r' and c.relrowsecurity)<>3 then raise exception 'unexpected_tables_or_rls'; end if;
 if (select count(*) from pg_indexes where schemaname='market_private')<>8 or (select count(*) from pg_policies where schemaname='market_private' and qual='false' and with_check='false' and cmd='ALL')<>3 then raise exception 'unexpected_indexes_or_policies'; end if;
 if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='market_private' or (n.nspname='public' and p.proname in ('market_data_account','market_data_worker'))) and pg_get_userbyid(p.proowner)='postgres' and p.proconfig @> array['search_path=""'])<>5 then raise exception 'unexpected_function_boundary'; end if;
 foreach r in array array['anon','authenticated'] loop
  foreach t in array array['workers','tasks','results'] loop
   if has_table_privilege(r,'market_private.'||t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'direct_table_grant'; end if;
  end loop;
 end loop;
 if has_function_privilege('anon','public.market_data_account(text,jsonb)','EXECUTE') or has_function_privilege('authenticated','public.market_data_worker(text,text,jsonb)','EXECUTE') or not has_function_privilege('authenticated','public.market_data_account(text,jsonb)','EXECUTE') or not has_function_privilege('anon','public.market_data_worker(text,text,jsonb)','EXECUTE') then raise exception 'unexpected_rpc_grants'; end if;
 if position('clock_timestamp()' in pg_get_functiondef('market_private.worker(text,text,jsonb)'::regprocedure))=0 then raise exception 'capability_fix_missing'; end if;
end $postcheck$;

insert into supabase_migrations.schema_migrations(version,name,statements) values ('20261002020030','market_data_orchestrator_v1',array['-- Daily-only queue. All privileged implementations and tables are unexposed.
create schema if not exists market_private;
revoke all on schema market_private from public, anon, authenticated;
grant usage on schema market_private to anon, authenticated;
create table market_private.workers (
 id uuid primary key default gen_random_uuid(), owner uuid not null references auth.users(id),
 token_hash bytea unique not null, expires_at timestamptz not null default now()+interval ''90 days''
);
create index market_worker_owner on market_private.workers(owner);
create table market_private.tasks (
 id uuid primary key default gen_random_uuid(), owner uuid not null references auth.users(id),
 symbol text not null check(symbol ~ ''^(?:[0-9]{6}\.(?:SS|SZ)|[0-9]{4,5}\.HK)$''),
 status text not null default ''queued'' check(status in (''queued'',''running'',''succeeded'',''failed'')),
 requested_at timestamptz not null default now(), started_at timestamptz, completed_at timestamptz,
 worker_id uuid references market_private.workers(id), lease_until timestamptz, error text,
 result_version uuid
);
create unique index market_one_active on market_private.tasks(owner,symbol) where status in (''queued'',''running'');
create index market_task_owner_time on market_private.tasks(owner,requested_at desc);
create table market_private.results (
 version uuid primary key references market_private.tasks(id), owner uuid not null references auth.users(id),
 symbol text not null, completed_at timestamptz not null default now(), payload jsonb not null
);
create index market_result_owner_symbol on market_private.results(owner,symbol,completed_at desc);
alter table market_private.workers enable row level security;
alter table market_private.tasks enable row level security;
alter table market_private.results enable row level security;
revoke all on all tables in schema market_private from public,anon,authenticated;
create policy no_direct_workers on market_private.workers for all using(false) with check(false);
create policy no_direct_tasks on market_private.tasks for all using(false) with check(false);
create policy no_direct_results on market_private.results for all using(false) with check(false);

create function market_private.task_json(t market_private.tasks) returns jsonb
language sql stable security invoker set search_path='''' as $$
 select jsonb_build_object(''taskId'',t.id,''taskType'',''UPDATE_DAILY_MARKET_DATA'',''symbol'',t.symbol,
 ''requestedBy'',t.owner,''requestedAt'',t.requested_at,''status'',t.status,''startedAt'',t.started_at,
 ''completedAt'',t.completed_at,''workerId'',t.worker_id,''resultVersion'',t.result_version,''error'',t.error);
$$;

-- One account operation endpoint. Ownership always comes from the Auth session.
create function market_private.account(p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='''' as $$
declare u uuid:=auth.uid(); t market_private.tasks; w market_private.workers; r jsonb; s text;
begin
 if u is null or coalesce((auth.jwt()->>''is_anonymous'')::boolean,false) then raise exception ''authentication_required'' using errcode=''42501''; end if;
 if jsonb_typeof(p_input) is distinct from ''object'' then raise exception ''invalid_input''; end if;
 if p_action=''request'' then
  if p_input - array[''symbol'',''taskType''] <> ''{}''::jsonb or p_input->>''taskType'' is distinct from ''UPDATE_DAILY_MARKET_DATA'' then raise exception ''invalid_task''; end if;
  s:=p_input->>''symbol'';
  if s is null or s !~ ''^(?:[0-9]{6}\.(?:SS|SZ)|[0-9]{4,5}\.HK)$'' then raise exception ''invalid_symbol''; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text||s,0));
  update market_private.tasks set status=''failed'',completed_at=now(),error=''worker_lease_expired'' where owner=u and symbol=s and status=''running'' and lease_until<now();
  select * into t from market_private.tasks where owner=u and symbol=s and status in (''queued'',''running'');
  if t.id is null then
   if (select count(*) from market_private.tasks where owner=u and status in (''queued'',''running''))>=50 then raise exception ''queue_limit''; end if;
   insert into market_private.tasks(owner,symbol) values(u,s) returning * into t;
  end if;
  return market_private.task_json(t);
 elsif p_action=''read'' then
  if p_input - array[''taskId'',''symbol''] <> ''{}''::jsonb then raise exception ''invalid_input''; end if;
  update market_private.tasks set status=''failed'',completed_at=now(),error=''worker_lease_expired'' where owner=u and status=''running'' and lease_until<now();
  select * into t from market_private.tasks where owner=u and
    ((p_input ? ''taskId'' and id=(p_input->>''taskId'')::uuid) or (not p_input ? ''taskId'' and symbol=p_input->>''symbol'')) order by requested_at desc limit 1;
  if t.id is null then return null; end if;
  select payload into r from market_private.results where owner=u and version=t.result_version;
  return market_private.task_json(t)||jsonb_build_object(''result'',r);
 elsif p_action=''register_worker'' then
  if p_input - array[''token''] <> ''{}''::jsonb or coalesce(p_input->>''token'','''') !~ ''^[0-9a-f]{64}$'' then raise exception ''invalid_token''; end if;
  -- V1 has one authorized executor per account. Rotation revokes the old capability.
  if exists(select 1 from market_private.tasks where owner=u and status=''running'' and lease_until>now()) then raise exception ''worker_busy''; end if;
  update market_private.workers set expires_at=now() where owner=u;
  insert into market_private.workers(owner,token_hash) values(u,extensions.digest(p_input->>''token'',''sha256'')) returning * into w;
  return jsonb_build_object(''workerId'',w.id,''userId'',u,''expiresAt'',w.expires_at);
 elsif p_action=''revoke_worker'' then
  if p_input <> ''{}''::jsonb then raise exception ''invalid_input''; end if;
  update market_private.workers set expires_at=now() where owner=u;
  update market_private.tasks set status=''failed'',completed_at=now(),error=''worker_revoked'' where owner=u and status=''running'';
  return jsonb_build_object(''revoked'',true);
 end if;
 raise exception ''invalid_action'';
end $$;

-- Capability-bound executor endpoint: claim or complete a fixed daily task only.
create function market_private.worker(p_token text,p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='''' as $$
declare w market_private.workers; t market_private.tasks; r jsonb; prev jsonb; row jsonb; last_date text; prior_date text:='''';
begin
 if p_token is null or p_token !~ ''^[0-9a-f]{64}$'' then raise exception ''worker_unauthorized'' using errcode=''42501''; end if;
 select * into w from market_private.workers where token_hash=extensions.digest(p_token,''sha256'') and expires_at>now();
 if w.id is null then raise exception ''worker_unauthorized'' using errcode=''42501''; end if;
 if jsonb_typeof(p_input) is distinct from ''object'' then raise exception ''invalid_input''; end if;
 perform pg_advisory_xact_lock(hashtextextended(w.owner::text,1));
 if p_action=''claim'' then
  if p_input <> ''{}''::jsonb then raise exception ''invalid_input''; end if;
  update market_private.tasks set status=''failed'',completed_at=now(),error=''worker_lease_expired'' where owner=w.owner and status=''running'' and lease_until<now();
  if exists(select 1 from market_private.tasks where owner=w.owner and status=''running'') then return null; end if;
  select * into t from market_private.tasks where owner=w.owner and status=''queued'' order by requested_at for update skip locked limit 1;
  if t.id is null then return null; end if;
  update market_private.tasks set status=''running'',started_at=now(),worker_id=w.id,lease_until=now()+interval ''10 minutes'' where id=t.id returning * into t;
  select payload into prev from market_private.results where owner=w.owner and symbol=t.symbol order by completed_at desc limit 1;
  return market_private.task_json(t)||jsonb_build_object(''previousResult'',prev);
 elsif p_action=''finish'' then
  if p_input - array[''taskId'',''result'',''error''] <> ''{}''::jsonb then raise exception ''invalid_input''; end if;
  select * into t from market_private.tasks where id=(p_input->>''taskId'')::uuid and owner=w.owner and worker_id=w.id for update;
  if t.id is null then raise exception ''task_not_owned'' using errcode=''42501''; end if;
  if t.status in (''succeeded'',''failed'') then return market_private.task_json(t); end if;
  if t.status<>''running'' then raise exception ''claim_expired''; end if;
  if t.lease_until<now() then
   update market_private.tasks set status=''failed'',completed_at=now(),error=''worker_lease_expired'' where id=t.id returning * into t;
   return market_private.task_json(t);
  end if;
  if p_input ? ''error'' then
   update market_private.tasks set status=''failed'',error=left(p_input->>''error'',240),completed_at=now() where id=t.id returning * into t;
   return market_private.task_json(t);
  end if;
  r:=p_input->''result'';
  if r is null or jsonb_typeof(r)<>''object'' or r - array[''schemaVersion'',''taskId'',''symbol'',''provider'',''requestedAt'',''completedAt'',''resultVersion'',''latestCompleteBar'',''technicalAsOf'',''dataUpdated'',''warnings'',''fingerprint'',''stock''] <> ''{}''::jsonb
   or r->>''taskId'' is distinct from t.id::text or r->>''resultVersion'' is distinct from t.id::text or r->>''symbol'' is distinct from t.symbol or r->>''schemaVersion'' is distinct from ''1''
   or jsonb_typeof(r->''warnings'') is distinct from ''array'' or jsonb_typeof(r->''dataUpdated'') is distinct from ''boolean''
   or coalesce(r->>''fingerprint'','''') !~ ''^[0-9a-f]{64}$'' or octet_length(r::text)>2097152 then raise exception ''invalid_result''; end if;
  if (r->''stock'') - array[''symbol'',''priceHistory'',''marketDataFreshness'',''technicalIndicators''] <> ''{}''::jsonb or r#>>''{stock,symbol}'' is distinct from t.symbol
   or jsonb_typeof(r#>''{stock,priceHistory}'') is distinct from ''array'' or jsonb_array_length(r#>''{stock,priceHistory}'') not between 1 and 3000 then raise exception ''invalid_snapshot''; end if;
  for row in select value from jsonb_array_elements(r#>''{stock,priceHistory}'') loop
   if row->>''is_complete_bar'' is distinct from ''true'' or coalesce(row->>''date'','''') !~ ''^\d{4}-\d{2}-\d{2}$'' or row->>''date''<=prior_date
    or row->>''adjustment'' is distinct from ''qfq'' or row->>''price_basis'' is distinct from ''adjusted'' or row->>''provider'' is distinct from r->>''provider''
    or coalesce((row->>''close'')::numeric,0)<=0 then raise exception ''invalid_bar''; end if;
   prior_date:=row->>''date'';
  end loop;
  last_date:=prior_date;
  if r->>''latestCompleteBar'' is distinct from last_date or r->>''technicalAsOf'' is distinct from last_date
    or r#>>''{stock,marketDataFreshness,last_trade_date}'' is distinct from last_date or r#>>''{stock,technicalIndicators,last_trade_date}'' is distinct from last_date then raise exception ''unaligned_result''; end if;
  r:=r||jsonb_build_object(''completedAt'',now(),''requestedAt'',t.requested_at);
  insert into market_private.results(version,owner,symbol,payload) values(t.id,w.owner,t.symbol,r);
  update market_private.tasks set status=''succeeded'',completed_at=now(),result_version=id where id=t.id returning * into t;
  return market_private.task_json(t);
 end if;
 raise exception ''invalid_action'';
end $$;

create function public.market_data_account(p_action text,p_input jsonb) returns jsonb language sql security invoker set search_path='''' as $$ select market_private.account(p_action,p_input); $$;
create function public.market_data_worker(p_token text,p_action text,p_input jsonb) returns jsonb language sql security invoker set search_path='''' as $$ select market_private.worker(p_token,p_action,p_input); $$;
revoke all on all functions in schema market_private from public,anon,authenticated;
revoke all on function public.market_data_account(text,jsonb) from public,anon,authenticated;
revoke all on function public.market_data_worker(text,text,jsonb) from public,anon,authenticated;
grant execute on function market_private.account(text,jsonb), public.market_data_account(text,jsonb) to authenticated;
grant execute on function market_private.worker(text,text,jsonb), public.market_data_worker(text,text,jsonb) to anon;']);
insert into supabase_migrations.schema_migrations(version,name,statements) values ('20261002021340','market_data_worker_capability_lock',array['-- Minimal capability rotation/revocation race fix; existing grants and tables unchanged.
create or replace function market_private.account(p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='''' as $$
declare u uuid:=auth.uid(); t market_private.tasks; w market_private.workers; r jsonb; s text;
begin
 if u is null or coalesce((auth.jwt()->>''is_anonymous'')::boolean,false) then raise exception ''authentication_required'' using errcode=''42501''; end if;
 if jsonb_typeof(p_input) is distinct from ''object'' then raise exception ''invalid_input''; end if;
 -- Serialize account mutations and capability use under the same owner lock.
 perform pg_advisory_xact_lock(hashtextextended(u::text,1));
 if p_action=''request'' then
  if p_input - array[''symbol'',''taskType''] <> ''{}''::jsonb or p_input->>''taskType'' is distinct from ''UPDATE_DAILY_MARKET_DATA'' then raise exception ''invalid_task''; end if;
  s:=p_input->>''symbol'';
  if s is null or s !~ ''^(?:[0-9]{6}\.(?:SS|SZ)|[0-9]{4,5}\.HK)$'' then raise exception ''invalid_symbol''; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text||s,0));
  update market_private.tasks set status=''failed'',completed_at=now(),error=''worker_lease_expired'' where owner=u and symbol=s and status=''running'' and lease_until<now();
  select * into t from market_private.tasks where owner=u and symbol=s and status in (''queued'',''running'');
  if t.id is null then
   if (select count(*) from market_private.tasks where owner=u and status in (''queued'',''running''))>=50 then raise exception ''queue_limit''; end if;
   insert into market_private.tasks(owner,symbol) values(u,s) returning * into t;
  end if;
  return market_private.task_json(t);
 elsif p_action=''read'' then
  if p_input - array[''taskId'',''symbol''] <> ''{}''::jsonb then raise exception ''invalid_input''; end if;
  update market_private.tasks set status=''failed'',completed_at=now(),error=''worker_lease_expired'' where owner=u and status=''running'' and lease_until<now();
  select * into t from market_private.tasks where owner=u and
    ((p_input ? ''taskId'' and id=(p_input->>''taskId'')::uuid) or (not p_input ? ''taskId'' and symbol=p_input->>''symbol'')) order by requested_at desc limit 1;
  if t.id is null then return null; end if;
  select payload into r from market_private.results where owner=u and version=t.result_version;
  return market_private.task_json(t)||jsonb_build_object(''result'',r);
 elsif p_action=''register_worker'' then
  if p_input - array[''token''] <> ''{}''::jsonb or coalesce(p_input->>''token'','''') !~ ''^[0-9a-f]{64}$'' then raise exception ''invalid_token''; end if;
  -- V1 has one authorized executor per account. Rotation revokes the old capability.
  if exists(select 1 from market_private.tasks where owner=u and status=''running'' and lease_until>now()) then raise exception ''worker_busy''; end if;
  update market_private.workers set expires_at=now() where owner=u;
  insert into market_private.workers(owner,token_hash) values(u,extensions.digest(p_input->>''token'',''sha256'')) returning * into w;
  return jsonb_build_object(''workerId'',w.id,''userId'',u,''expiresAt'',w.expires_at);
 elsif p_action=''revoke_worker'' then
  if p_input <> ''{}''::jsonb then raise exception ''invalid_input''; end if;
  update market_private.workers set expires_at=now() where owner=u;
  update market_private.tasks set status=''failed'',completed_at=now(),error=''worker_revoked'' where owner=u and status=''running'';
  return jsonb_build_object(''revoked'',true);
 end if;
 raise exception ''invalid_action'';
end $$;

-- Capability-bound executor endpoint: claim or complete a fixed daily task only.
create or replace function market_private.worker(p_token text,p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='''' as $$
declare w market_private.workers; t market_private.tasks; r jsonb; prev jsonb; row jsonb; last_date text; prior_date text:='''';
begin
 if p_token is null or p_token !~ ''^[0-9a-f]{64}$'' then raise exception ''worker_unauthorized'' using errcode=''42501''; end if;
 select * into w from market_private.workers where token_hash=extensions.digest(p_token,''sha256'') and expires_at>clock_timestamp();
 if w.id is null then raise exception ''worker_unauthorized'' using errcode=''42501''; end if;
 if jsonb_typeof(p_input) is distinct from ''object'' then raise exception ''invalid_input''; end if;
 perform pg_advisory_xact_lock(hashtextextended(w.owner::text,1));
 -- Rotation/revocation may have completed while this caller waited for the lock.
 select * into w from market_private.workers where id=w.id and expires_at>clock_timestamp();
 if w.id is null then raise exception ''worker_unauthorized'' using errcode=''42501''; end if;
 if p_action=''claim'' then
  if p_input <> ''{}''::jsonb then raise exception ''invalid_input''; end if;
  update market_private.tasks set status=''failed'',completed_at=now(),error=''worker_lease_expired'' where owner=w.owner and status=''running'' and lease_until<now();
  if exists(select 1 from market_private.tasks where owner=w.owner and status=''running'') then return null; end if;
  select * into t from market_private.tasks where owner=w.owner and status=''queued'' order by requested_at for update skip locked limit 1;
  if t.id is null then return null; end if;
  update market_private.tasks set status=''running'',started_at=now(),worker_id=w.id,lease_until=now()+interval ''10 minutes'' where id=t.id returning * into t;
  select payload into prev from market_private.results where owner=w.owner and symbol=t.symbol order by completed_at desc limit 1;
  return market_private.task_json(t)||jsonb_build_object(''previousResult'',prev);
 elsif p_action=''finish'' then
  if p_input - array[''taskId'',''result'',''error''] <> ''{}''::jsonb then raise exception ''invalid_input''; end if;
  select * into t from market_private.tasks where id=(p_input->>''taskId'')::uuid and owner=w.owner and worker_id=w.id for update;
  if t.id is null then raise exception ''task_not_owned'' using errcode=''42501''; end if;
  if t.status in (''succeeded'',''failed'') then return market_private.task_json(t); end if;
  if t.status<>''running'' then raise exception ''claim_expired''; end if;
  if t.lease_until<now() then
   update market_private.tasks set status=''failed'',completed_at=now(),error=''worker_lease_expired'' where id=t.id returning * into t;
   return market_private.task_json(t);
  end if;
  if p_input ? ''error'' then
   update market_private.tasks set status=''failed'',error=left(p_input->>''error'',240),completed_at=now() where id=t.id returning * into t;
   return market_private.task_json(t);
  end if;
  r:=p_input->''result'';
  if r is null or jsonb_typeof(r)<>''object'' or r - array[''schemaVersion'',''taskId'',''symbol'',''provider'',''requestedAt'',''completedAt'',''resultVersion'',''latestCompleteBar'',''technicalAsOf'',''dataUpdated'',''warnings'',''fingerprint'',''stock''] <> ''{}''::jsonb
   or r->>''taskId'' is distinct from t.id::text or r->>''resultVersion'' is distinct from t.id::text or r->>''symbol'' is distinct from t.symbol or r->>''schemaVersion'' is distinct from ''1''
   or jsonb_typeof(r->''warnings'') is distinct from ''array'' or jsonb_typeof(r->''dataUpdated'') is distinct from ''boolean''
   or coalesce(r->>''fingerprint'','''') !~ ''^[0-9a-f]{64}$'' or octet_length(r::text)>2097152 then raise exception ''invalid_result''; end if;
  if (r->''stock'') - array[''symbol'',''priceHistory'',''marketDataFreshness'',''technicalIndicators''] <> ''{}''::jsonb or r#>>''{stock,symbol}'' is distinct from t.symbol
   or jsonb_typeof(r#>''{stock,priceHistory}'') is distinct from ''array'' or jsonb_array_length(r#>''{stock,priceHistory}'') not between 1 and 3000 then raise exception ''invalid_snapshot''; end if;
  for row in select value from jsonb_array_elements(r#>''{stock,priceHistory}'') loop
   if row->>''is_complete_bar'' is distinct from ''true'' or coalesce(row->>''date'','''') !~ ''^\d{4}-\d{2}-\d{2}$'' or row->>''date''<=prior_date
    or row->>''adjustment'' is distinct from ''qfq'' or row->>''price_basis'' is distinct from ''adjusted'' or row->>''provider'' is distinct from r->>''provider''
    or coalesce((row->>''close'')::numeric,0)<=0 then raise exception ''invalid_bar''; end if;
   prior_date:=row->>''date'';
  end loop;
  last_date:=prior_date;
  if r->>''latestCompleteBar'' is distinct from last_date or r->>''technicalAsOf'' is distinct from last_date
    or r#>>''{stock,marketDataFreshness,last_trade_date}'' is distinct from last_date or r#>>''{stock,technicalIndicators,last_trade_date}'' is distinct from last_date then raise exception ''unaligned_result''; end if;
  r:=r||jsonb_build_object(''completedAt'',now(),''requestedAt'',t.requested_at);
  insert into market_private.results(version,owner,symbol,payload) values(t.id,w.owner,t.symbol,r);
  update market_private.tasks set status=''succeeded'',completed_at=now(),result_version=id where id=t.id returning * into t;
  return market_private.task_json(t);
 end if;
 raise exception ''invalid_action'';
end $$;']);
commit;
