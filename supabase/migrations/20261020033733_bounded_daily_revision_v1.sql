-- Opt-in 2899.HK daily receipts. No existing function or Rebase history is replaced.
create table market_private.daily_versions (
 id uuid primary key default gen_random_uuid(), owner uuid not null references auth.users(id),
 symbol text not null check(symbol='2899.HK'), task_id uuid unique references market_private.tasks(id),
 previous_id uuid references market_private.daily_versions(id), bundle jsonb not null,
 bundle_hash text not null check(bundle_hash ~ '^[a-f0-9]{64}$'), identity_hash text not null,
 observation jsonb not null, receipt jsonb not null, created_at timestamptz not null default now()
);
create index daily_versions_owner on market_private.daily_versions(owner,symbol,created_at);
create table market_private.daily_heads (
 owner uuid not null references auth.users(id), symbol text not null check(symbol='2899.HK'),
 current_id uuid not null references market_private.daily_versions(id), generation integer not null check(generation>=0),
 enabled boolean not null default false, primary key(owner,symbol)
);
alter table market_private.daily_versions enable row level security;
alter table market_private.daily_heads enable row level security;
revoke all on market_private.daily_versions,market_private.daily_heads from public,anon,authenticated,service_role;
create trigger daily_versions_immutable before update or delete on market_private.daily_versions
 for each row execute function market_private.migration_immutable();

-- Exact binary64 -> decimal round-half-even, matching Python round(x, places).
-- Never an epsilon comparison; preserve the computed price and its content hash.
create function market_private.daily_round(x float8, places integer) returns numeric
language plpgsql immutable strict set search_path='' as $$
declare b bytea:=float8send(x); e integer; m numeric; i integer; n numeric; q numeric; s integer:=1;
begin
 if places not between 0 and 6 then raise exception 'invalid_precision'; end if;
 e:=(get_byte(b,0)%128)*16+get_byte(b,1)/16;
 if e=2047 then raise exception 'non_finite_number'; end if;
 if get_byte(b,0)>=128 then s:=-1; end if;
 m:=get_byte(b,1)%16;
 for i in 2..7 loop m:=m*256+get_byte(b,i); end loop;
 if e>0 then m:=m+4503599627370496; else e:=1; end if;
 n:=m*power(2::numeric,e-1075)*power(10::numeric,places); q:=trunc(n);
 if n-q>0.5 or (n-q=0.5 and mod(q,2)=1) then q:=q+1; end if;
 return s*q/power(10::numeric,places);
end $$;

create function market_private.daily_check(base jsonb, old_observation jsonb, p jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare oldraw jsonb; newraw jsonb; repeatraw jsonb; a jsonb; b jsonb; ar jsonb; br jsonb; k text;
 rows jsonb; oldrows jsonb:=market_private.daily_bars(base->'priceHistory'); n integer; i integer;
 changed integer:=0; steps bigint; fa bytea; fb bytea; va float8; vb float8; delta numeric; maxdelta numeric:=0;
 ct jsonb:=base#>'{marketDataFreshness,sourceContract}'; nc jsonb; before jsonb; after jsonb; preview jsonb;
 content text; tech text; versions jsonb; meta jsonb; bundle jsonb; tier text:='NORMAL_UPDATE';
begin
 if p-array['protocol','policyVersion','taskId','expectedVersion','expectedGeneration','expectedHash','observation','repeat','bundle','bundleHash']<>'{}'::jsonb
  or p->>'protocol' is distinct from 'bounded-daily-revision-v1' or p->>'policyVersion' is distinct from 'yahoo-hk-adjclose-ulp-pilot-v1' then raise exception 'DAILY_PROTOCOL_MISMATCH';end if;
 if ct->>'symbol' is distinct from '2899.HK' or ct->>'canonicalProvider' is distinct from 'yahoo' or ct->>'market' is distinct from 'HK'
  or ct->>'normalizationVersion' is distinct from 'python-round-6-v1' or ct->>'interval' is distinct from 'daily'
  or ct->>'priceCurrency' is distinct from 'HKD' or ct->>'priceUnit' is distinct from 'HKD/share' or ct->>'volumeUnit' is distinct from 'shares'
  or ct->>'adjustment' is distinct from 'qfq' or ct->>'priceBasis' is distinct from 'adjusted' or ct->>'amountAvailability' is distinct from 'NOT_AVAILABLE'
  then raise exception 'SOURCE_CONTRACT_MISMATCH';end if;
 oldraw:=market_private.daily_raw(old_observation);newraw:=market_private.daily_raw(p->'observation');repeatraw:=market_private.daily_raw(p->'repeat');
 if oldraw->'bars' is distinct from oldrows or newraw is distinct from repeatraw then raise exception 'RAW_OUTPUT_MISMATCH';end if;
 if p#>>'{observation,id}'=p#>>'{repeat,id}' or p#>>'{observation,asOf}'=p#>>'{repeat,asOf}'
  or (p#>>'{observation,asOf}')::timestamptz<(old_observation->>'asOf')::timestamptz
  or (p#>>'{repeat,asOf}')::timestamptz<(p#>>'{observation,asOf}')::timestamptz
  or (p#>>'{repeat,asOf}')::timestamptz>clock_timestamp()+interval '2 minutes' then raise exception 'REPEAT_OBSERVATION_REQUIRED';end if;
 rows:=newraw->'bars';n:=jsonb_array_length(oldrows);
 if jsonb_array_length(rows)<n then raise exception 'HISTORY_DATE_SET_CHANGED';end if;
 for i in 0..n-1 loop
  a:=oldrows->i;b:=rows->i;ar:=oldraw->'raw'->i;br:=newraw->'raw'->i;
  if a->'date' is distinct from b->'date' then raise exception 'HISTORY_DATE_SET_CHANGED';end if;
  if ar-'adjclose' is distinct from br-'adjclose' then raise exception 'RAW_QUOTE_CHANGED';end if;
  if ar->'adjclose'<>br->'adjclose' then
   va:=(ar->>'adjclose')::float8;vb:=(br->>'adjclose')::float8;
   if va<>(va::real)::float8 or vb<>(vb::real)::float8 then raise exception 'NON_FLOAT32_ADJCLOSE_CHANGE';end if;
   fa:=float4send(va::real);fb:=float4send(vb::real);
   steps:=abs((get_byte(fa,0)::bigint-get_byte(fb,0))*16777216+(get_byte(fa,1)-get_byte(fb,1))*65536+(get_byte(fa,2)-get_byte(fb,2))*256+get_byte(fa,3)-get_byte(fb,3));
   if steps>2 then raise exception 'ADJCLOSE_STEP_EXCEEDED';end if;
   tier:='AUDITED_REVISION';
  end if;
  if a<>b then changed:=changed+1;end if;
  foreach k in array array['open','high','low','close'] loop
   delta:=abs((a->>k)::numeric-(b->>k)::numeric);maxdelta:=greatest(maxdelta,delta);
   if delta>0.000004 then raise exception 'PRICE_DELTA_EXCEEDED';end if;
  end loop;
 end loop;
 if changed>140 or changed*430>140*n then raise exception 'UNCALIBRATED_REVISION_RANGE';end if;
 if tier='AUDITED_REVISION' then
  before:=market_private.daily_technical(oldrows);
  after:=market_private.daily_technical((select jsonb_agg(value order by ord) from jsonb_array_elements(rows) with ordinality t(value,ord) where ord<=n));
  if before->'relationships'<>after->'relationships' or before->'crossovers'<>after->'crossovers'
   or before#>'{technicalData,programRiskFlags}'<>after#>'{technicalData,programRiskFlags}' then raise exception 'TECHNICAL_DECISION_BOUNDARY_CHANGED';end if;
  foreach k in array array['ma5','ma10','ma20','ma60','ma120'] loop
   if abs((before#>>array['indicators',k])::numeric-(after#>>array['indicators',k])::numeric)>0.000005 then raise exception 'TECHNICAL_NUMERIC_BOUND_EXCEEDED';end if;
  end loop;
  foreach k in array array['dif','dea','histogram'] loop
   if abs((before#>>array['indicators','macd',k])::numeric-(after#>>array['indicators','macd',k])::numeric)>(case when k='histogram' then 0.000033 else 0.000009 end) then raise exception 'TECHNICAL_NUMERIC_BOUND_EXCEEDED';end if;
  end loop;
 end if;
 nc:=ct||jsonb_build_object('historyWindow',jsonb_build_object('start',rows->0->>'date','end',rows->-1->>'date'));
 preview:=market_private.daily_technical(rows);
 content:=market_private.canonical_hash(jsonb_build_object('bars',rows,'sourceContract',nc)::json);
 tech:=market_private.canonical_hash(jsonb_build_object('contentHash',content,'technical',preview)::json);
 versions:=jsonb_build_object('dataVersion',content,'dataContentVersion',content,'technicalVersion',tech,'latestCompleteBar',rows->-1->>'date');
 meta:=versions||jsonb_build_object('provider','yahoo','sourceContract',nc,'fetched_at',p#>>'{observation,asOf}',
  'last_trade_date',rows->-1->>'date','kline_status','current','is_complete_bar',true,'technical_analysis_stale',false,'revisionStatus','audited_daily',
  'dailyProtocol','bounded-daily-revision-v1','resultVersion',p->>'taskId');
 if base#>'{marketDataFreshness,sourceMigration}' is not null then meta:=meta||jsonb_build_object('sourceMigration',base#>'{marketDataFreshness,sourceMigration}');end if;
 bundle:=jsonb_build_object('priceHistory',rows,'marketDataFreshness',meta,
  'technicalIndicators',(preview->'indicators')||versions||jsonb_build_object('updated_at',p#>>'{observation,asOf}'),
  'technicalData',(preview->'technicalData')||versions||jsonb_build_object('technicalDataStatus','fresh','dataQuality','validated'));
 if bundle is distinct from p->'bundle' or market_private.canonical_hash(bundle::json) is distinct from p->>'bundleHash' then raise exception 'DAILY_FACTS_MISMATCH';end if;
 return jsonb_build_object('tier',tier,'changedDates',changed,'maxPriceDelta',maxdelta,'contentHash',content,'technicalVersion',tech);
end $$;

create function market_private.daily_view(u uuid) returns jsonb language sql set search_path='' as $$
 select jsonb_build_object('protocol','bounded-daily-revision-v1','owner',h.owner,'symbol',h.symbol,'enabled',h.enabled,
 'generation',h.generation,'versionId',v.id,'previousId',v.previous_id,'bundle',v.bundle,'bundleHash',v.bundle_hash,
 'identityHash',v.identity_hash,'observation',v.observation,'receipt',v.receipt,
 'ancestors',coalesce((with recursive chain as (
  select x.id,x.previous_id,x.identity_hash,x.bundle_hash,0 depth from market_private.daily_versions x where x.id=v.id and x.owner=u
  union all select x.id,x.previous_id,x.identity_hash,x.bundle_hash,c.depth+1 from chain c join market_private.daily_versions x on x.id=c.previous_id and x.owner=u where c.depth<128
 ) select jsonb_agg(jsonb_build_object('versionId',id,'identityHash',identity_hash,'bundleHash',bundle_hash) order by depth) from chain),'[]'::jsonb))
 from market_private.daily_heads h join market_private.daily_versions v on v.id=h.current_id and v.owner=h.owner
 where h.owner=u and h.symbol='2899.HK'
$$;

-- Operator-only bootstrap: exact existing approved current version, no new Rebase.
create function market_private.daily_bootstrap(u uuid, expected text, o jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare b jsonb; v uuid; ct jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(u::text,1));
 if exists(select 1 from market_private.daily_heads where owner=u) then raise exception 'DAILY_ALREADY_MANAGED';end if;
 if exists(select 1 from market_private.tasks where owner=u and symbol='2899.HK' and status in ('queued','running')) then raise exception 'ACTIVE_TASK_CONFLICT';end if;
 if exists(select 1 from market_private.migration_records where owner=u and symbol='2899.HK' and status in ('staged','approved')) then raise exception 'ACTIVE_MIGRATION_CONFLICT';end if;
 select v.bundle into b from market_private.migration_heads h join market_private.migration_versions v
  on v.owner=h.owner and v.symbol=h.symbol and v.version=h.current_version where h.owner=u and h.symbol='2899.HK' and h.current_version=expected;
 if b is null or (market_private.migration_view(u,'2899.HK')->>'dailyAdvanced')::boolean then raise exception 'DAILY_BASELINE_INVALID';end if;
 ct:=b#>'{marketDataFreshness,sourceContract}';
 if ct->>'canonicalProvider' is distinct from 'yahoo' or ct->>'unitValidationProfile' is distinct from 'empirical-exchange-v1'
  or ct#>>'{units,yahoo,price,evidenceLevel}' is distinct from 'EMPIRICALLY_VALIDATED' or ct#>>'{units,yahoo,volume,evidenceLevel}' is distinct from 'EMPIRICALLY_VALIDATED'
  or ct#>>'{units,yahoo,price,scale}' is distinct from '1' or ct#>>'{units,yahoo,volume,scale}' is distinct from '1'
  or ct#>>'{units,yahoo,price,unit}' is distinct from 'HKD/share' or ct#>>'{units,yahoo,volume,unit}' is distinct from 'shares'
  or market_private.daily_raw(o)->'bars' is distinct from market_private.daily_bars(b->'priceHistory') then raise exception 'DAILY_BASELINE_INVALID';end if;
 insert into market_private.daily_versions(owner,symbol,bundle,bundle_hash,identity_hash,observation,receipt)
 values(u,'2899.HK',b,market_private.canonical_hash(b::json),market_private.daily_identity(b),o,
  jsonb_build_object('kind','BASELINE','rebaseVersion',expected,'protocol','bounded-daily-revision-v1')) returning id into v;
 insert into market_private.daily_heads(owner,symbol,current_id,generation) values(u,'2899.HK',v,0);
 return market_private.daily_view(u);
end $$;

create function market_private.daily_worker(token text, action text, p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w market_private.workers; t market_private.tasks; h market_private.daily_heads; v market_private.daily_versions;
 checked jsonb; receipt jsonb; nextid uuid; payload jsonb; b jsonb;
begin
 if token is null or token !~ '^[a-f0-9]{64}$' then raise exception 'worker_unauthorized' using errcode='42501';end if;
 select * into w from market_private.workers where token_hash=extensions.digest(token,'sha256') and expires_at>clock_timestamp();
 if w.id is null then raise exception 'worker_unauthorized' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(w.owner::text,1));
 select * into w from market_private.workers where id=w.id and expires_at>clock_timestamp();
 if w.id is null then raise exception 'worker_unauthorized' using errcode='42501';end if;
 if jsonb_typeof(p) is distinct from 'object' then raise exception 'invalid_input';end if;
 if action='current' then
  if p<>jsonb_build_object('symbol','2899.HK') then raise exception 'invalid_symbol';end if;
  return market_private.daily_view(w.owner);
 end if;
 if action is distinct from 'finish' then raise exception 'invalid_action';end if;
 select * into t from market_private.tasks where id=(p->>'taskId')::uuid and owner=w.owner and worker_id=w.id and symbol='2899.HK' for update;
 if t.id is null then raise exception 'task_not_owned' using errcode='42501';end if;
 select * into v from market_private.daily_versions where task_id=t.id and owner=w.owner;
 if t.status='succeeded' and v.id is not null then
  if v.receipt->>'submissionHash' is distinct from market_private.canonical_hash(p::json) then raise exception 'DUPLICATE_SUBMISSION_MISMATCH';end if;
  return market_private.task_json(t)||jsonb_build_object('dailyVersion',v.id);
 end if;
 if t.status<>'running' or t.lease_until<clock_timestamp() then raise exception 'claim_expired';end if;
 select * into h from market_private.daily_heads where owner=w.owner and symbol=t.symbol for update;
 if h.owner is null or not h.enabled then raise exception 'DAILY_POLICY_DISABLED';end if;
 select * into v from market_private.daily_versions where id=h.current_id and owner=w.owner;
 if h.current_id::text is distinct from p->>'expectedVersion' or h.generation::text is distinct from p->>'expectedGeneration'
  or v.bundle_hash is distinct from p->>'expectedHash' then raise exception 'VERSION_CONFLICT';end if;
 if exists(select 1 from market_private.migration_records where owner=w.owner and symbol=t.symbol and status in ('staged','approved')) then raise exception 'ACTIVE_MIGRATION_CONFLICT';end if;
 checked:=market_private.daily_check(v.bundle,v.observation,p);b:=p->'bundle';nextid:=gen_random_uuid();
 receipt:=checked||jsonb_build_object('protocol','bounded-daily-revision-v1','kind','DAILY_UPDATE','policyVersion','yahoo-hk-adjclose-ulp-pilot-v1',
  'generation',h.generation+1,'previousId',v.id,'previousHash',v.bundle_hash,'previousIdentity',v.identity_hash,
  'taskId',t.id,'workerId',w.id,'submissionHash',market_private.canonical_hash(p::json),'observations',jsonb_build_array(p->'observation',p->'repeat'));
 insert into market_private.daily_versions(id,owner,symbol,task_id,previous_id,bundle,bundle_hash,identity_hash,observation,receipt)
 values(nextid,w.owner,t.symbol,t.id,v.id,b,p->>'bundleHash',market_private.daily_identity(b),p->'observation',receipt);
 payload:=jsonb_build_object('schemaVersion',1,'taskId',t.id,'resultVersion',t.id,'symbol',t.symbol,'provider','yahoo',
  'requestedAt',t.requested_at,'completedAt',now(),'latestCompleteBar',b#>>'{marketDataFreshness,last_trade_date}',
  'technicalAsOf',b#>>'{marketDataFreshness,last_trade_date}','fingerprint',checked->>'contentHash','dataUpdated',v.identity_hash<>market_private.daily_identity(b),'warnings','[]'::jsonb,
  'stock',jsonb_build_object('symbol',t.symbol,'priceHistory',b->'priceHistory','marketDataFreshness',b->'marketDataFreshness',
   'technicalIndicators',(b->'technicalIndicators')||jsonb_build_object('technicalSnapshot',b->'technicalData')));
 insert into market_private.results(version,owner,symbol,payload) values(t.id,w.owner,t.symbol,payload);
 update market_private.daily_heads set current_id=nextid,generation=generation+1 where owner=w.owner and symbol=t.symbol;
 update market_private.tasks set status='succeeded',completed_at=now(),result_version=id where id=t.id returning * into t;
 return market_private.task_json(t)||jsonb_build_object('dailyVersion',nextid);
end $$;

-- A managed pilot cannot publish through an older Worker or ordinary finish.
-- Other symbols and unconfigured accounts keep their existing semantics.
create function market_private.daily_result_guard() returns trigger language plpgsql set search_path='' as $$
declare v market_private.daily_versions;
begin
 if exists(select 1 from market_private.daily_heads where owner=new.owner and symbol=new.symbol) then
  select * into v from market_private.daily_versions where owner=new.owner and symbol=new.symbol and task_id=new.version;
  if v.id is null or new.payload#>'{stock,priceHistory}' is distinct from v.bundle->'priceHistory'
   or new.payload#>'{stock,marketDataFreshness}' is distinct from v.bundle->'marketDataFreshness'
   or new.payload#>'{stock,technicalIndicators}' is distinct from (v.bundle->'technicalIndicators')||jsonb_build_object('technicalSnapshot',v.bundle->'technicalData') then raise exception 'DAILY_TRUSTED_RECEIPT_REQUIRED';end if;
 end if;
 return new;
end $$;
create trigger daily_result_guard before insert on market_private.results for each row execute function market_private.daily_result_guard();

create function market_private.daily_account(p_symbol text) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();r jsonb;
begin
 if u is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'authentication_required' using errcode='42501';end if;
 if p_symbol is distinct from '2899.HK' then raise exception 'invalid_symbol';end if;
 r:=market_private.daily_view(u);
 -- Raw observations remain private to the trusted executor and audit operator.
 return (r-'observation')||case when r is null then null else jsonb_build_object('receipt',(r->'receipt')-'observations') end;
end $$;

-- Full-fact recovery is operator-only, CAS bound, append-only and auditable.
create function market_private.daily_restore(u uuid, expected uuid, target uuid, reason text) returns jsonb
language plpgsql set search_path='' as $$
declare h market_private.daily_heads; old market_private.daily_versions; dest market_private.daily_versions; newid uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(u::text,1));
 select * into h from market_private.daily_heads where owner=u and symbol='2899.HK' for update;
 if h.current_id is distinct from expected or length(trim(reason)) not between 8 and 240 then raise exception 'VERSION_CONFLICT';end if;
 if exists(select 1 from market_private.tasks where owner=u and symbol='2899.HK' and status in ('running','queued')) then raise exception 'ACTIVE_TASK_CONFLICT';end if;
 select * into old from market_private.daily_versions where id=h.current_id and owner=u;
 if old.previous_id is distinct from target then raise exception 'INVALID_RESTORE_TARGET';end if;
 select * into dest from market_private.daily_versions where id=target and owner=u and symbol='2899.HK';
 if dest.id is null then raise exception 'INVALID_RESTORE_TARGET';end if;
 insert into market_private.daily_versions(owner,symbol,previous_id,bundle,bundle_hash,identity_hash,observation,receipt)
 values(u,'2899.HK',old.id,dest.bundle,dest.bundle_hash,dest.identity_hash,dest.observation,
 jsonb_build_object('kind','RESTORE','protocol','bounded-daily-revision-v1','targetId',target,'previousId',old.id,'reason',reason,'generation',h.generation+1)) returning id into newid;
 update market_private.daily_heads set current_id=newid,generation=generation+1,enabled=false where owner=u and symbol='2899.HK';
 return market_private.daily_view(u);
end $$;

create function public.market_data_daily_worker(p_token text,p_action text,p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select market_private.daily_worker(p_token,p_action,p_input) $$;
create function public.market_data_daily_current(p_symbol text) returns jsonb
language sql security invoker set search_path='' as $$ select market_private.daily_account(p_symbol) $$;

create function market_private.daily_bars(rows jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_agg(jsonb_build_object('date',r->'date','open',r->'open','high',r->'high','low',r->'low','close',r->'close',
 'volume',r->'volume','amount',r->'amount','provider',r->'provider','adjustment',r->'adjustment',
 'price_basis',r->'price_basis','is_complete_bar',r->'is_complete_bar') order by ord)
 from jsonb_array_elements(rows) with ordinality t(r,ord)
$$;
create function market_private.daily_identity(b jsonb) returns text
language sql immutable set search_path='' as $$
 select market_private.canonical_hash(jsonb_build_object('bars',market_private.daily_bars(b->'priceHistory'),
 'sourceContract',b#>'{marketDataFreshness,sourceContract}','contentVersion',b#>'{marketDataFreshness,dataContentVersion}',
 'technicalVersion',b#>'{marketDataFreshness,technicalVersion}',
 'technical',(select jsonb_object_agg(k,b#>array['technicalData',k]) from unnest(array['price','technicalAsOf','ma5','ma10','ma20','ma60','ma120','macd','supportPrice','resistancePrice','volume','volumeAvg20','volumeChangePct']) k))::json)
$$;

-- Reparse retained provider bytes, including the complete-bar cutoff at observation time.
create function market_private.daily_raw(o jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare d jsonb; q jsonb; adj jsonb; ts jsonb; i integer; day date; stamp timestamp; prior date;
 a float8; c float8; f float8; vals jsonb; bars jsonb:='[]'; rawrows jsonb:='[]'; k text; v float8;
begin
 if jsonb_typeof(o)<>'object' or o-array['id','raw','rawHash','asOf']<>'{}'::jsonb or
  octet_length(o->>'raw') not between 1 and 8388608 or market_private.migration_hash(o->>'raw') is distinct from o->>'rawHash'
  or (o->>'id')::uuid is null or (o->>'asOf')::timestamptz is null then raise exception 'RAW_PROVENANCE_REQUIRED'; end if;
 d:=(o->>'raw')::jsonb;
 if jsonb_array_length(d#>'{chart,result}')<>1 or d#>>'{chart,error}' is not null then raise exception 'PROVENANCE_INVALID'; end if;
 d:=d#>'{chart,result,0}';
 if d#>>'{meta,symbol}' is distinct from '2899.HK' or d#>>'{meta,currency}' is distinct from 'HKD' then raise exception 'RAW_SYMBOL_MISMATCH'; end if;
 ts:=d->'timestamp';q:=d#>'{indicators,quote,0}';adj:=d#>'{indicators,adjclose,0,adjclose}';
 if jsonb_typeof(ts) is distinct from 'array' or jsonb_array_length(ts) not between 430 and 3001 or jsonb_array_length(adj) is distinct from jsonb_array_length(ts) then raise exception 'INVALID_HISTORY'; end if;
 foreach k in array array['open','high','low','close','volume'] loop
  if jsonb_array_length(q->k) is distinct from jsonb_array_length(ts) then raise exception 'INVALID_HISTORY'; end if;
 end loop;
 stamp:=(o->>'asOf')::timestamptz at time zone 'Asia/Hong_Kong';
 for i in 0..jsonb_array_length(ts)-1 loop
  day:=(to_timestamp((ts->>i)::float8) at time zone 'Asia/Hong_Kong')::date;
  if day>stamp::date or (day=stamp::date and (stamp::time<time '16:10' or extract(isodow from day)>5)) then continue; end if;
  if prior is not null and day<=prior then raise exception 'INVALID_HISTORY'; end if; prior:=day;
  c:=(q#>>array['close',i::text])::float8;a:=(adj->>i)::float8;
  if c is null or a is null or c<=0 or a<=0 then raise exception 'INVALID_HISTORY'; end if; f:=a/c;
  vals:=jsonb_build_object('date',day::text,'volume',q#>array['volume',i::text],'amount',null,
   'provider','yahoo','adjustment','qfq','price_basis','adjusted','is_complete_bar',true);
  foreach k in array array['open','high','low','close'] loop
   v:=(q#>>array[k,i::text])::float8;
   if v is null or v<=0 then raise exception 'INVALID_HISTORY'; end if;
   vals:=vals||jsonb_build_object(k,market_private.daily_round(v*f,6));
  end loop;
  if (vals->>'high')::numeric<greatest((vals->>'open')::numeric,(vals->>'close')::numeric,(vals->>'low')::numeric)
   or (vals->>'low')::numeric>least((vals->>'open')::numeric,(vals->>'close')::numeric)
   or (vals->>'volume') is null or (vals->>'volume')::numeric<0 or trunc((vals->>'volume')::numeric)<>(vals->>'volume')::numeric then raise exception 'INVALID_HISTORY'; end if;
  bars:=bars||jsonb_build_array(vals);
  rawrows:=rawrows||jsonb_build_array(jsonb_build_object('date',day::text,'open',q#>array['open',i::text],
   'high',q#>array['high',i::text],'low',q#>array['low',i::text],'close',q#>array['close',i::text],
   'volume',q#>array['volume',i::text],'adjclose',adj->i));
 end loop;
 if jsonb_array_length(bars)<430 then raise exception 'INVALID_HISTORY'; end if;
 return jsonb_build_object('bars',bars,'raw',rawrows);
end $$;

-- Independent reproduction of the existing MA/MACD, discrete signals and volume preview.
create function market_private.daily_technical(rows jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare n integer:=jsonb_array_length(rows); i integer; j integer; w integer; r jsonb; x float8; total float8;
 closes float8[]:='{}'; volumes float8[]:='{}'; em12 float8; em26 float8; sig float8:=0; dif float8;
 r12 float8; r26 float8; rsig float8:=0; rdif float8; m5 float8; m20 float8;
 point jsonb; prev jsonb; rel jsonb:='[]'; crossovers jsonb:='[]'; ind jsonb; td jsonb; mas jsonb:='{}';
 macd jsonb; key text; flags jsonb:='[]'; recent float8:=0; previous float8:=0; avg20 float8:=0; vol jsonb; lastday text;
begin
 if n<120 then raise exception 'INVALID_HISTORY'; end if;
 for i in 0..n-1 loop
  r:=rows->i;x:=(r->>'close')::float8;closes:=array_append(closes,x);volumes:=array_append(volumes,(r->>'volume')::float8);
  if i=0 then em12:=x;em26:=x;r12:=x;r26:=x; else
   em12:=em12+(2::float8/13)*(x-em12); em26:=em26+(2::float8/27)*(x-em26);
   r12:=r12+(x-r12)*2/13; r26:=r26+(x-r26)*2/27;
  end if;
  dif:=em12-em26;sig:=sig+(2::float8/10)*(dif-sig);rdif:=r12-r26;rsig:=rsig+(rdif-rsig)*2/10;
  m5:=null;m20:=null;
  if i>=19 then
   total:=0;for j in i-18..i+1 loop total:=total+closes[j];end loop;m20:=total/20;
   total:=0;for j in i-3..i+1 loop total:=total+closes[j];end loop;m5:=total/5;
  end if;
  point:=jsonb_build_object('date',r->>'date','priceVsMA20',sign(x-m20),'ma5VsMA20',sign(m5-m20),'macdSign',case when i>=25 then sign(rdif-rsig) else null end);
  if prev is not null then foreach key in array array['priceVsMA20','ma5VsMA20','macdSign'] loop
   if prev->>key is not null and point->>key is not null and prev->key<>point->key then
    crossovers:=crossovers||jsonb_build_array(jsonb_build_object('date',r->>'date','indicator',key,'before',prev->key,'after',point->key));
   end if;
  end loop;end if;
  rel:=rel||jsonb_build_array(point);prev:=point;
 end loop;
 foreach w in array array[5,10,20,60,120] loop
  total:=0;for j in n-w+1..n loop total:=total+closes[j];end loop;
  mas:=mas||jsonb_build_object('ma'||w,market_private.daily_round(total/w,6));
 end loop;
 macd:=jsonb_build_object('dif',market_private.daily_round(dif,6),'dea',market_private.daily_round(sig,6),'histogram',market_private.daily_round(2*(dif-sig),6));
 for j in n-4..n loop recent:=recent+volumes[j];end loop;recent:=recent/5;
 for j in n-9..n-5 loop previous:=previous+volumes[j];end loop;previous:=previous/5;
 for j in n-19..n loop avg20:=avg20+volumes[j];end loop;avg20:=avg20/20;
 vol:=jsonb_build_object('recent_5d_average',market_private.daily_round(recent,2),'previous_5d_average',market_private.daily_round(previous,2),
  'change_pct',case when previous<>0 then market_private.daily_round((recent/previous-1)*100,2) else null end,'unit','shares','status','comparable');
 lastday:=rows->-1->>'date';
 if point->>'priceVsMA20'='-1' then flags:=flags||'"price_below_ma20"'::jsonb;end if;
 if point->>'ma5VsMA20'='-1' then flags:=flags||'"ma5_below_ma20"'::jsonb;end if;
 if point->>'macdSign'='-1' then flags:=flags||'"macd_below_signal"'::jsonb;end if;
 ind:=mas||jsonb_build_object('last_trade_date',lastday,'macd',macd,'volume_change',vol);
 td:=mas||jsonb_build_object('symbol','2899.HK','price',closes[n],'technicalAsOf',lastday,'latestCompleteBar',lastday,'macd',macd,
  'supportPrice',market_private.daily_round((select min(v) from unnest(closes[n-59:n]) v),4),
  'resistancePrice',market_private.daily_round((select max(v) from unnest(closes[n-59:n]) v),4),'supportResistanceAsOf',lastday,
  'technicalDataStatus','candidate','dataQuality','candidate_only','priceActionEvent',jsonb_build_object('status','unavailable','reason','no_versioned_deterministic_classifier'),
  'deterministicTrendInputs',mas||jsonb_build_object('macd',macd),'programRiskFlags',flags,'aiJudgmentStatus','needs_review',
  'volume',volumes[n],'volumeAvg20',avg20,'volumeChangePct',vol->'change_pct','volumeStatus','comparable');
 return jsonb_build_object('indicators',ind,'technicalData',td,'relationships',rel,'crossovers',crossovers);
end $$;

-- Every helper is private, including bootstrap/restore; no service-role bypass RPC.
do $$ declare r record;begin
 for r in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='market_private' and p.proname like 'daily_%' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',r.sig);
 end loop;
end $$;
revoke all on function public.market_data_daily_worker(text,text,jsonb),public.market_data_daily_current(text) from public,anon,authenticated,service_role;
grant execute on function market_private.daily_worker(text,text,jsonb),public.market_data_daily_worker(text,text,jsonb) to anon;
grant execute on function market_private.daily_account(text),public.market_data_daily_current(text) to authenticated;
