-- V1A is a monotonic set. No UPDATE, DELETE, snapshot, active flag or CAS.
create table public.stock_universe_entries (
  user_id uuid not null references auth.users(id),
  symbol text not null check (symbol ~ '^(?:[0-9]{6}\.(?:SS|SZ)|[0-9]{4,5}\.HK)$'),
  display_name text not null default '' check (char_length(display_name) <= 120),
  created_at timestamptz not null default now(),
  primary key (user_id, symbol)
);
alter table public.stock_universe_entries enable row level security;
revoke all on public.stock_universe_entries from public, anon, authenticated;
grant select, insert on public.stock_universe_entries to authenticated;
create policy stock_universe_owner_select on public.stock_universe_entries
  for select to authenticated using ((select auth.uid()) = user_id);
create policy stock_universe_owner_insert on public.stock_universe_entries
  for insert to authenticated with check ((select auth.uid()) = user_id);

-- PC capabilities are independent from Auth sessions. Only their hashes are stored.
-- The private schema is not exposed through PostgREST; callers receive no table grants.
create schema if not exists universe_private;
revoke all on schema universe_private from public, anon, authenticated;
create table universe_private.reader_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  token_hash bytea not null unique,
  label text not null check (char_length(label) between 1 and 40),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '180 days')
);
create index reader_credentials_owner_idx on universe_private.reader_credentials(user_id);
alter table universe_private.reader_credentials enable row level security;
revoke all on universe_private.reader_credentials from public, anon, authenticated;

-- SECURITY DEFINER is required only to bridge to the private credential store.
-- Every account operation explicitly derives ownership from auth.uid(), never input.
create function public.register_stock_universe_reader(p_token text, p_label text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := auth.uid(); v_id uuid; v_expiry timestamptz;
begin
  if v_owner is null then raise exception 'UNIVERSE_AUTH_REQUIRED' using errcode='42501'; end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' or p_label is null or char_length(btrim(p_label)) not between 1 and 40 then
    raise exception 'UNIVERSE_READER_INVALID';
  end if;
  -- Serialize issuance to enforce the small per-owner limit, not Universe ordering.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_owner::text,0));
  if (select count(*) from universe_private.reader_credentials where user_id=v_owner and expires_at>now()) >= 10 then
    raise exception 'UNIVERSE_READER_LIMIT';
  end if;
  insert into universe_private.reader_credentials(user_id,token_hash,label)
    values(v_owner,pg_catalog.sha256(pg_catalog.convert_to(p_token,'UTF8')),btrim(p_label))
    returning id,expires_at into v_id,v_expiry;
  return jsonb_build_object('id',v_id,'userId',v_owner,'expiresAt',v_expiry);
end $$;

create function public.list_stock_universe_readers()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid := auth.uid();
begin
  if v_owner is null then raise exception 'UNIVERSE_AUTH_REQUIRED' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',id,'label',label,'expiresAt',expires_at) order by created_at),'[]'::jsonb)
    from universe_private.reader_credentials where user_id=v_owner and expires_at>now());
end $$;

create function public.revoke_stock_universe_reader(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'UNIVERSE_AUTH_REQUIRED' using errcode='42501'; end if;
  update universe_private.reader_credentials set expires_at=now() where id=p_id and user_id=auth.uid();
end $$;

-- An unguessable 256-bit read capability authorizes exactly one owner's small set.
-- It cannot write membership, obtain user sessions, or access any investment state.
create function public.read_stock_universe(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_expiry timestamptz; v_rows jsonb;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'UNIVERSE_READER_AUTH_REQUIRED' using errcode='42501';
  end if;
  select user_id,expires_at into v_owner,v_expiry from universe_private.reader_credentials
    where token_hash=pg_catalog.sha256(pg_catalog.convert_to(p_token,'UTF8')) and expires_at>now();
  if v_owner is null then raise exception 'UNIVERSE_READER_AUTH_REQUIRED' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('symbol',symbol,'displayName',display_name) order by symbol),'[]'::jsonb)
    into v_rows from public.stock_universe_entries where user_id=v_owner;
  return jsonb_build_object('schemaVersion',1,'userId',v_owner,'credentialExpiresAt',v_expiry,'symbols',v_rows);
end $$;

revoke all on function public.register_stock_universe_reader(text,text) from public, anon, authenticated;
revoke all on function public.list_stock_universe_readers() from public, anon, authenticated;
revoke all on function public.revoke_stock_universe_reader(uuid) from public, anon, authenticated;
revoke all on function public.read_stock_universe(text) from public, anon, authenticated;
grant execute on function public.register_stock_universe_reader(text,text) to authenticated;
grant execute on function public.list_stock_universe_readers() to authenticated;
grant execute on function public.revoke_stock_universe_reader(uuid) to authenticated;
grant execute on function public.read_stock_universe(text) to anon;
comment on table public.stock_universe_entries is 'V1A add-only user market coverage. No investment judgments or positions.';
comment on function public.read_stock_universe(text) is 'Read-only PC capability; token must only travel in HTTPS request body and protected local storage.';
