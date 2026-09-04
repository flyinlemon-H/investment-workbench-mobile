-- Manual Analysis Sync V1 stores only the latest explicitly published module
-- snapshot. Device transport state remains local and outside this schema.
create schema if not exists analysis_private;
revoke all on schema analysis_private from public, anon, authenticated;

create table analysis_private.analysis_sync_modules (
  user_id uuid not null references auth.users(id) on delete cascade,
  module_type text not null check (module_type ~ '^[a-z][a-z0-9_]{0,63}$'),
  entity_key text not null check (entity_key ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'),
  module_schema_version text not null check (module_schema_version ~ '^[a-z][a-z0-9-]*\.v[1-9][0-9]*$'),
  revision bigint not null check (revision > 0),
  payload_hash text not null check (payload_hash ~ '^sha256:[0-9a-f]{64}$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  published_at timestamptz not null default now(),
  primary key (user_id,module_type,entity_key)
);
create index analysis_sync_modules_owner_published_idx on analysis_private.analysis_sync_modules(user_id,published_at desc);
alter table analysis_private.analysis_sync_modules enable row level security;
revoke all on analysis_private.analysis_sync_modules from public,anon,authenticated;
create policy analysis_sync_owner_select on analysis_private.analysis_sync_modules
  for select to authenticated using ((select auth.uid()) = user_id);
create policy analysis_sync_owner_insert on analysis_private.analysis_sync_modules
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy analysis_sync_owner_update on analysis_private.analysis_sync_modules
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create function analysis_private.module_json(p_row analysis_private.analysis_sync_modules)
returns jsonb language sql immutable security invoker set search_path='' as $$
  select jsonb_build_object(
    'moduleType',p_row.module_type,
    'entityKey',p_row.entity_key,
    'moduleSchemaVersion',p_row.module_schema_version,
    'revision',p_row.revision,
    'payloadHash',p_row.payload_hash,
    'publishedAt',p_row.published_at,
    'payload',p_row.payload
  );
$$;

create function analysis_private.validate_module_payload(p_module_type text,p_module_schema_version text,p_payload jsonb)
returns void language plpgsql immutable security invoker set search_path='' as $$
declare v_keys text[];
begin
  if p_module_type !~ '^[a-z][a-z0-9_]{0,63}$' or p_module_schema_version !~ '^[a-z][a-z0-9-]*\.v[1-9][0-9]*$' or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'ANALYSIS_MODULE_INVALID';
  end if;
  if p_module_type = 'long_term_logic' then
    if p_module_schema_version <> 'long-term-logic.v2' then raise exception 'ANALYSIS_SCHEMA_UNSUPPORTED'; end if;
    select array_agg(key order by key) into v_keys from jsonb_object_keys(p_payload) key;
    if v_keys <> array['confidence','coreDrivers','investmentThesis','keyRisks','logicStatus','nextReviewDate','reviewTriggers'] then
      raise exception 'ANALYSIS_PAYLOAD_INVALID';
    end if;
  else
    raise exception 'ANALYSIS_MODULE_UNSUPPORTED';
  end if;
end $$;

create function analysis_private.get_analysis_module(p_module_type text,p_entity_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid := auth.uid(); v_row analysis_private.analysis_sync_modules;
begin
  if v_owner is null then raise exception 'ANALYSIS_AUTH_REQUIRED' using errcode='42501'; end if;
  select * into v_row from analysis_private.analysis_sync_modules
    where user_id=v_owner and module_type=p_module_type and entity_key=p_entity_key;
  if not found then return null; end if;
  return analysis_private.module_json(v_row);
end $$;

create function analysis_private.list_analysis_modules()
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid := auth.uid(); v_rows jsonb;
begin
  if v_owner is null then raise exception 'ANALYSIS_AUTH_REQUIRED' using errcode='42501'; end if;
  select coalesce(jsonb_agg(analysis_private.module_json(row_value) order by row_value.published_at desc),'[]'::jsonb)
    into v_rows from analysis_private.analysis_sync_modules row_value where row_value.user_id=v_owner;
  return v_rows;
end $$;

create function analysis_private.publish_analysis_module(
  p_module_type text,p_entity_key text,p_module_schema_version text,p_payload_hash text,p_payload jsonb,
  p_expected_revision bigint,p_expected_hash text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_owner uuid := auth.uid(); v_row analysis_private.analysis_sync_modules; v_next bigint;
begin
  if v_owner is null then raise exception 'ANALYSIS_AUTH_REQUIRED' using errcode='42501'; end if;
  if p_entity_key !~ '^[A-Z0-9][A-Z0-9._-]{0,63}$' or p_payload_hash !~ '^sha256:[0-9a-f]{64}$' or p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'ANALYSIS_ENVELOPE_INVALID';
  end if;
  perform analysis_private.validate_module_payload(p_module_type,p_module_schema_version,p_payload);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_owner::text||':'||p_module_type||':'||p_entity_key,0));
  select * into v_row from analysis_private.analysis_sync_modules
    where user_id=v_owner and module_type=p_module_type and entity_key=p_entity_key for update;
  if found and v_row.payload_hash=p_payload_hash then
    return jsonb_build_object('status','no_change','module',analysis_private.module_json(v_row));
  end if;
  if not found then
    if p_expected_revision<>0 or p_expected_hash is not null then return jsonb_build_object('status','conflict'); end if;
    insert into analysis_private.analysis_sync_modules(user_id,module_type,entity_key,module_schema_version,revision,payload_hash,payload)
      values(v_owner,p_module_type,p_entity_key,p_module_schema_version,1,p_payload_hash,p_payload) returning * into v_row;
  else
    if v_row.revision<>p_expected_revision or v_row.payload_hash is distinct from p_expected_hash then return jsonb_build_object('status','conflict'); end if;
    v_next:=v_row.revision+1;
    update analysis_private.analysis_sync_modules set module_schema_version=p_module_schema_version,revision=v_next,payload_hash=p_payload_hash,payload=p_payload,published_at=now()
      where user_id=v_owner and module_type=p_module_type and entity_key=p_entity_key returning * into v_row;
  end if;
  return jsonb_build_object('status','published','module',analysis_private.module_json(v_row));
end $$;

revoke all on function analysis_private.module_json(analysis_private.analysis_sync_modules) from public,anon,authenticated;
revoke all on function analysis_private.validate_module_payload(text,text,jsonb) from public,anon,authenticated;
revoke all on function analysis_private.get_analysis_module(text,text) from public,anon,authenticated;
revoke all on function analysis_private.list_analysis_modules() from public,anon,authenticated;
revoke all on function analysis_private.publish_analysis_module(text,text,text,text,jsonb,bigint,text) from public,anon,authenticated;
grant usage on schema analysis_private to authenticated;
grant execute on function analysis_private.get_analysis_module(text,text) to authenticated;
grant execute on function analysis_private.list_analysis_modules() to authenticated;
grant execute on function analysis_private.publish_analysis_module(text,text,text,text,jsonb,bigint,text) to authenticated;

create function public.get_analysis_module(p_module_type text,p_entity_key text)
returns jsonb language sql security invoker set search_path='' as $$ select analysis_private.get_analysis_module(p_module_type,p_entity_key); $$;
create function public.list_analysis_modules()
returns jsonb language sql security invoker set search_path='' as $$ select analysis_private.list_analysis_modules(); $$;
create function public.publish_analysis_module(p_module_type text,p_entity_key text,p_module_schema_version text,p_payload_hash text,p_payload jsonb,p_expected_revision bigint,p_expected_hash text)
returns jsonb language sql security invoker set search_path='' as $$
  select analysis_private.publish_analysis_module(p_module_type,p_entity_key,p_module_schema_version,p_payload_hash,p_payload,p_expected_revision,p_expected_hash);
$$;
revoke all on function public.get_analysis_module(text,text) from public,anon,authenticated;
revoke all on function public.list_analysis_modules() from public,anon,authenticated;
revoke all on function public.publish_analysis_module(text,text,text,text,jsonb,bigint,text) from public,anon,authenticated;
grant execute on function public.get_analysis_module(text,text) to authenticated;
grant execute on function public.list_analysis_modules() to authenticated;
grant execute on function public.publish_analysis_module(text,text,text,text,jsonb,bigint,text) to authenticated;
comment on table analysis_private.analysis_sync_modules is 'Latest explicitly published module snapshots only; never whole application backups.';
