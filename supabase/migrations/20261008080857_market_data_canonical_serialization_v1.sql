-- REVIEW CANDIDATE ONLY. No production execution is authorized by this task.
-- Pure helpers are private; no new tables, policies, roles or direct grants.
create function market_private.canonical_encode(p json, depth integer default 0)
returns text language plpgsql immutable security invoker set search_path='' as $$
declare kind text:=json_typeof(p); result text; item record; n text; mantissa text; digits text; exponent integer; fraction text; negative boolean;
begin
 if depth>64 then raise exception 'canonical_depth_limit'; end if;
 if kind='null' then return 'n'; elsif kind='boolean' then return case when p::text='true' then 't' else 'f' end;
 elsif kind='string' then return 's'||encode(convert_to(p#>>'{}','UTF8'),'hex');
 elsif kind='number' then
  n:=lower(p::text);
  if length(n)>2048 then raise exception 'canonical_number_limit'; end if;
  mantissa:=split_part(n,'e',1); exponent:=case when position('e' in n)>0 then split_part(n,'e',2)::integer else 0 end;
  negative:=left(mantissa,1)='-'; if negative then mantissa:=substr(mantissa,2); end if;
  fraction:=case when position('.' in mantissa)>0 then split_part(mantissa,'.',2) else '' end;
  exponent:=exponent-length(fraction); digits:=ltrim(replace(mantissa,'.',''),'0');
  if abs(exponent)>10000 or length(digits)>1024 then raise exception 'canonical_number_limit'; end if;
  if digits='' then return 'd0e0'; end if;
  while right(digits,1)='0' loop digits:=left(digits,length(digits)-1); exponent:=exponent+1; end loop;
  return 'd'||case when negative then '-' else '' end||digits||'e'||exponent::text;
 elsif kind='array' then
  result:=''; for item in select value from json_array_elements(p) loop
   result:=result||case when result='' then '' else ',' end||market_private.canonical_encode(item.value,depth+1);
  end loop; return '['||result||']';
 elsif kind='object' then
  if exists(select 1 from json_each(p) group by key having count(*)>1) then raise exception 'canonical_duplicate_key'; end if;
  result:=''; for item in select key,value from json_each(p) order by encode(convert_to(key,'UTF8'),'hex') collate "C" loop
   result:=result||case when result='' then '' else ',' end||'s'||encode(convert_to(item.key,'UTF8'),'hex')||':'||market_private.canonical_encode(item.value,depth+1);
  end loop; return '{'||result||'}';
 end if;
 raise exception 'canonical_unsupported_type';
end $$;
create function market_private.canonical_hash(p json) returns text language sql immutable security invoker set search_path='' as $$
 select market_private.migration_hash('MARKET_DATA_CANONICAL_SERIALIZATION_V1'||chr(10)||market_private.canonical_encode(p))
$$;
create function market_private.canonical_baseline(c jsonb, b jsonb) returns void language plpgsql immutable security invoker set search_path='' as $$
declare binding jsonb:=c->'baselineBinding'; row jsonb; prior text:=''; day text;
begin
 if binding is distinct from jsonb_build_object(
  'canonicalSerializationVersion','MARKET_DATA_CANONICAL_SERIALIZATION_V1',
  'canonicalContentHash',market_private.canonical_hash(b::json),
  'legacyBaseHash',c->>'baseHash','expectedCurrentVersion',c->>'baseHash',
  'sourceContractHash',market_private.canonical_hash(jsonb_build_object('present',(b->'marketDataFreshness')?'sourceContract','value',b#>'{marketDataFreshness,sourceContract}')::json))
 then raise exception 'canonical_baseline_binding_mismatch'; end if;
 if jsonb_typeof(b->'priceHistory') is distinct from 'array' or jsonb_array_length(b->'priceHistory') not between 1 and 3000 then raise exception 'canonical_bars'; end if;
 for row in select value from jsonb_array_elements(b->'priceHistory') loop
  day:=row->>'date';
  if day is null or day!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or (day::date)::text is distinct from day or day<=prior then raise exception 'canonical_bar_order_or_date'; end if;
  prior:=day;
 end loop;
end $$;
revoke all on function market_private.canonical_encode(json,integer),market_private.canonical_hash(json),market_private.canonical_baseline(jsonb,jsonb) from public,anon,authenticated,service_role;

create or replace function market_private.migration_validate(p jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c jsonb; pkg jsonb; sem jsonb; base jsonb; contract jsonb; units jsonb; row jsonb; sr jsonb; field text; n int:=0; prior text:=''; tv text; ch text; ph text;
begin
 if jsonb_typeof(p) is distinct from 'object' or p-array['candidate','package','content','technical','base']<>'{}'::jsonb
  or octet_length(p::text)>12000000 then raise exception 'invalid_capsule'; end if;
 foreach field in array array['candidate','package','content','technical','base'] loop
  if jsonb_typeof(p->field) is distinct from 'string' then raise exception 'invalid_capsule'; end if;
 end loop;
 c:=(p->>'candidate')::jsonb;
 if c->>'guardImplementationHash' is distinct from market_private.migration_release_binding()->>'guardHash'
  or c#>>'{evidence,productionDeployment,assetVersion}' is distinct from market_private.migration_release_binding()->>'assetVersion'
  then raise exception 'migration_release_binding_mismatch'; end if;
 pkg:=(p->>'package')::jsonb; sem:=(p->>'content')::jsonb; base:=(p->>'base')::jsonb;
 ch:=market_private.migration_hash(p->>'candidate'); ph:=market_private.migration_hash(p->>'package');
 if c ?| array['candidateId','candidateHash'] or c-'approvalPackageHash' is distinct from pkg or c->>'approvalPackageHash' is distinct from ph
  or c->>'contentHash' is distinct from market_private.migration_hash(p->>'content') or c->>'baseHash' is distinct from market_private.migration_hash(p->>'base')
  then raise exception 'hash_binding_mismatch'; end if;
 if coalesce(c->>'schemaVersion','') not in ('3','4') or coalesce(c->>'type','') not in ('provider_rebase','same_provider_revision')
  or coalesce(c->>'symbol','') !~ '^(?:[0-9]{6}\.(?:SS|SZ)|[0-9]{4,5}\.HK)$'
  or c->'blockers' is distinct from '[]'::jsonb or c#>'{guardDelivery,missingPaths}' is distinct from '[]'::jsonb
  or c#>>'{technicalValidation,complete}' is distinct from 'true' or coalesce(c->>'guardImplementationHash','') !~ '^[a-f0-9]{64}$'
  or c#>>'{evidence,guardImplementationHash}' is distinct from c->>'guardImplementationHash'
  or c#>>'{evidence,migrationDeployment,rpcVersion}' is distinct from market_private.migration_protocol()
  or c#>>'{evidence,migrationDeployment,unsafeWritePathCount}' is distinct from '0'
  then raise exception 'migration_guard_incompatible'; end if;
 foreach field in array array['worker','manual','batch','pc_direct','legacy_json','legacy_csv','bridge_publish','browser_result'] loop
  if c#>>array['guardDelivery','paths',field,'status'] is distinct from 'delivered'
   or coalesce(c#>>array['guardDelivery','paths',field,'implementationHash'],'') !~ '^[a-f0-9]{64}$'
   or coalesce(c#>>array['guardDelivery','paths',field,'testHash'],'') !~ '^[a-f0-9]{64}$' then raise exception 'migration_guard_incompatible'; end if;
 end loop;
 contract:=c->'sourceContract';
 if contract->>'symbol' is distinct from c->>'symbol' or coalesce(contract->>'canonicalProvider','') not in ('yahoo','eastmoney')
  or contract->>'rawProviderId' is distinct from contract->>'canonicalProvider'
  or contract->>'adjustment' is distinct from 'qfq' or contract->>'priceBasis' is distinct from 'adjusted'
  or contract->>'interval' is distinct from 'daily' or contract->>'normalizationVersion' is distinct from 'python-round-6-v1'
  or coalesce(contract->>'providerVersion','')='' or contract->>'market' is distinct from (case when c->>'symbol' like '%.HK' then 'HK' else 'CN' end)
  then raise exception 'invalid_source_contract'; end if;
 select jsonb_object_agg(provider,fields) into units from (select a.key provider,jsonb_object_agg(b.key,jsonb_build_object('unit',b.value->'unit','currency',b.value->'currency','scale',b.value->'scale')) fields from jsonb_each(contract->'units') a cross join lateral jsonb_each(a.value) b group by a.key) u;
 if sem-'bars'-'contract'<>'{}'::jsonb or sem->'contract' is distinct from jsonb_build_object('symbol',contract->'symbol','canonicalProvider',contract->'canonicalProvider','providerVersion',contract->'providerVersion','adjustment',contract->'adjustment','priceBasis',contract->'priceBasis','market',contract->'market','interval',contract->'interval','historyWindow',contract->'historyWindow','normalizationVersion',contract->'normalizationVersion','units',units)
  then raise exception 'content_contract_mismatch'; end if;
 if jsonb_typeof(c#>'{stock,priceHistory}') is distinct from 'array' or jsonb_array_length(c#>'{stock,priceHistory}') not between 1 and 3000
  or jsonb_array_length(sem->'bars') is distinct from jsonb_array_length(c#>'{stock,priceHistory}')
  or (c#>'{stock}')-array['priceHistory','marketDataFreshness','technicalData','technicalIndicators']<>'{}'::jsonb
  or base-array['priceHistory','marketDataFreshness','technicalData','technicalIndicators']<>'{}'::jsonb
  then raise exception 'invalid_bundle'; end if;
 for row in select value from jsonb_array_elements(c#>'{stock,priceHistory}') loop
  sr:=sem->'bars'->n; n:=n+1;
  if coalesce(row->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' or (row->>'date')::date::text is distinct from row->>'date' or row->>'date'<=prior
   or row->>'is_complete_bar' is distinct from 'true' or row->>'adjustment' is distinct from 'qfq' or row->>'price_basis' is distinct from 'adjusted'
   or row->>'provider' is distinct from contract->>'canonicalProvider'
   or row->>'rawProviderId' is distinct from contract->>'canonicalProvider' or row->>'canonicalProviderId' is distinct from contract->>'canonicalProvider'
   or sr-array['date','open','high','low','close','volume','amount','provider','adjustment','priceBasis','complete']<>'{}'::jsonb
   or sr->>'date' is distinct from row->>'date' or sr->>'provider' is distinct from row->>'provider' or sr->>'adjustment' is distinct from 'qfq'
   or sr->>'priceBasis' is distinct from 'adjusted' or sr->>'complete' is distinct from 'true'
   then raise exception 'invalid_migration_bar'; end if;
  foreach field in array array['open','high','low','close','volume','amount'] loop
   if field in ('open','high','low','close') then
    if jsonb_typeof(row->field) is distinct from 'number' or (row->>field)::numeric<=0
     or jsonb_typeof(sr->field) is distinct from 'string' or (sr->>field)::numeric is distinct from round((row->>field)::numeric,6)
     then raise exception 'content_bar_mismatch'; end if;
   elsif (row->field is null or row->field='null'::jsonb) then
    if sr->field is distinct from 'null'::jsonb then raise exception 'content_bar_mismatch'; end if;
   elsif jsonb_typeof(row->field) is distinct from 'number' or (row->>field)::numeric<0 or jsonb_typeof(sr->field) is distinct from 'string' or (sr->>field)::numeric is distinct from (row->>field)::numeric then raise exception 'content_bar_mismatch';
   end if;
  end loop;
  if (row->>'high')::numeric<greatest((row->>'open')::numeric,(row->>'low')::numeric,(row->>'close')::numeric)
   or (row->>'low')::numeric>least((row->>'open')::numeric,(row->>'close')::numeric) then raise exception 'invalid_migration_bar'; end if;
  prior:=row->>'date';
 end loop;
 if contract#>>'{historyWindow,start}' is distinct from c#>>'{stock,priceHistory,0,date}' or contract#>>'{historyWindow,end}' is distinct from prior or c->>'barCount' is distinct from n::text
  or c#>'{stock,marketDataFreshness,sourceContract}' is distinct from contract then raise exception 'unaligned_migration'; end if;
 tv:=market_private.migration_hash(p->>'technical');
 if (p->>'technical')::jsonb is distinct from jsonb_build_object('contentHash',c->'contentHash','technical',c->'technicalPreview') then raise exception 'technical_hash_mismatch'; end if;
 foreach field in array array['marketDataFreshness','technicalData','technicalIndicators'] loop
  if c#>>array['stock',field,'dataContentVersion'] is distinct from c->>'contentHash' or c#>>array['stock',field,'technicalVersion'] is distinct from tv
   or c#>>array['stock',field,'latestCompleteBar'] is distinct from prior then raise exception 'unaligned_migration'; end if;
 end loop;
 if (c#>'{stock,technicalData}')-array['dataContentVersion','technicalVersion','latestCompleteBar'] is distinct from (c#>'{technicalPreview,technicalData}')-array['dataContentVersion','technicalVersion','latestCompleteBar']
  or (c#>'{stock,technicalIndicators}')-array['dataContentVersion','technicalVersion','latestCompleteBar'] is distinct from (c#>'{technicalPreview,indicators}')-array['dataContentVersion','technicalVersion','latestCompleteBar'] then raise exception 'technical_preview_mismatch'; end if;
 if c->>'schemaVersion'='4' then perform market_private.canonical_baseline(c,base); end if;
 return c||jsonb_build_object('candidateHash',ch,'candidateId','rebase_'||ch);
end $$;

create or replace function market_private.migration_stage(p_owner uuid,p_capsule jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare c jsonb; r market_private.migration_records; h market_private.migration_heads; anchor uuid; s text; b jsonb;
begin
 c:=market_private.migration_validate(p_capsule); if c->>'schemaVersion'<>'4' then raise exception 'legacy_approval_requires_refreeze'; end if; s:=c->>'symbol'; b:=(p_capsule->>'base')::jsonb;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text,1));
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||s,0));
 select * into r from market_private.migration_records where owner=p_owner and candidate_hash=c->>'candidateHash';
 if found then return jsonb_build_object('migrationId',r.id,'status',r.status,'idempotent',true); end if;
 if exists(select 1 from market_private.tasks where owner=p_owner and symbol=s and status in ('queued','running')) then raise exception 'active_task_conflict'; end if;
 select version into anchor from market_private.results where owner=p_owner and symbol=s order by completed_at desc,version desc limit 1;
 if anchor is not null and exists(select 1 from market_private.results where version=anchor and
  (payload#>'{stock,priceHistory}' is distinct from b->'priceHistory' or payload#>'{stock,marketDataFreshness}' is distinct from b->'marketDataFreshness')) then raise exception 'daily_baseline_conflict'; end if;
 select * into h from market_private.migration_heads where owner=p_owner and symbol=s for update;
 if found then
  if h.current_version<>c->>'baseHash' then raise exception 'version_conflict'; end if;
  if not exists(select 1 from market_private.migration_versions v where v.owner=p_owner and v.symbol=s and v.version=h.current_version and v.bundle=b) then raise exception 'version_conflict'; end if;
 else
  insert into market_private.migration_versions(owner,symbol,version,bundle) values(p_owner,s,c->>'baseHash',b);
  insert into market_private.migration_heads(owner,symbol,current_version) values(p_owner,s,c->>'baseHash') returning * into h;
 end if;
 insert into market_private.migration_records(owner,symbol,candidate_hash,content_hash,package_hash,expected_version,expected_generation,daily_anchor,capsule,guard_version)
 values(p_owner,s,c->>'candidateHash',c->>'contentHash',c->>'approvalPackageHash',h.current_version,h.generation,anchor,p_capsule,market_private.migration_protocol()) returning * into r;
 insert into market_private.migration_events(migration_id,owner,symbol,action,detail) values(r.id,p_owner,s,'staged',jsonb_build_object('candidateHash',r.candidate_hash,'contentHash',r.content_hash,'approvalPackageHash',r.package_hash,'expectedVersion',r.expected_version));
 return jsonb_build_object('migrationId',r.id,'status',r.status,'candidateHash',r.candidate_hash);
end $$;
create or replace function market_private.migration_account(p_action text,p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); r market_private.migration_records; h market_private.migration_heads; c jsonb; s text; anchor uuid; b jsonb; prior jsonb; k text; response jsonb;
begin
 if u is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then raise exception 'authentication_required' using errcode='42501'; end if;
 if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'invalid_input'; end if;
 if p_action in ('read','current') then
  if p_input-array['symbol','migrationId']<>'{}'::jsonb or coalesce(p_input->>'symbol','') !~ '^(?:[0-9]{6}\.(?:SS|SZ)|[0-9]{4,5}\.HK)$' then raise exception 'invalid_input'; end if;
  if p_action='current' then
   select * into h from market_private.migration_heads where owner=u and symbol=p_input->>'symbol';
   if not found or h.generation=0 then return null; end if;
   return market_private.migration_view(u,p_input->>'symbol',h.migration_id);
  end if;
  return market_private.migration_view(u,p_input->>'symbol',(p_input->>'migrationId')::uuid);
 end if;
 if p_action not in ('approve','apply','rollback') or p_input-array['migrationId','symbol','candidateHash','contentHash','approvalPackageHash','expectedCurrentVersion','expectedGeneration','guardVersion','approvalId','phrase','provider','resolutions','reason']<>'{}'::jsonb then raise exception 'invalid_action'; end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,1));
 select * into r from market_private.migration_records where owner=u and id=(p_input->>'migrationId')::uuid for update;
 if not found then raise exception 'migration_not_owned' using errcode='42501'; end if;
 s:=r.symbol;
 perform pg_advisory_xact_lock(hashtextextended(u::text||s,0));
 if p_input->>'symbol' is distinct from s or p_input->>'candidateHash' is distinct from r.candidate_hash or p_input->>'contentHash' is distinct from r.content_hash
  or p_input->>'approvalPackageHash' is distinct from r.package_hash or p_input->>'guardVersion' is distinct from market_private.migration_protocol()
  or r.guard_version is distinct from market_private.migration_protocol() then raise exception 'approval_binding_mismatch'; end if;
 c:=market_private.migration_validate(r.capsule);
 if p_action in ('approve','apply') and c->>'schemaVersion'<>'4' then raise exception 'legacy_approval_requires_refreeze'; end if;
 if c->>'candidateHash' is distinct from r.candidate_hash or c->>'contentHash' is distinct from r.content_hash or c->>'approvalPackageHash' is distinct from r.package_hash then raise exception 'approval_binding_mismatch'; end if;
 select * into h from market_private.migration_heads where owner=u and symbol=s for update;
 if p_action='apply' and r.status='applied' and h.current_version=r.candidate_hash and h.migration_id=r.id and p_input->>'approvalId'=r.approval_id::text then
  return market_private.migration_view(u,s,r.id)||jsonb_build_object('idempotent',true);
 end if;
 if p_input->>'expectedCurrentVersion' is distinct from h.current_version or p_input->>'expectedGeneration' is distinct from h.generation::text then raise exception 'version_conflict'; end if;
 select version into anchor from market_private.results where owner=u and symbol=s order by completed_at desc,version desc limit 1;
 if anchor is distinct from r.daily_anchor then raise exception 'daily_version_conflict'; end if;
 if exists(select 1 from market_private.tasks where owner=u and symbol=s and status in ('queued','running')) then raise exception 'active_task_conflict'; end if;
 if p_action='approve' then
  if r.status='approved' then return market_private.migration_view(u,s,r.id); end if;
  if r.status<>'staged' or h.current_version<>r.expected_version or h.generation<>r.expected_generation then raise exception 'approval_not_available'; end if;
  if p_input->>'phrase' is distinct from 'Approve candidate '||r.candidate_hash or p_input->>'provider' is distinct from c#>>'{sourceContract,canonicalProvider}' or jsonb_typeof(p_input->'resolutions') is distinct from 'object' then raise exception 'explicit_approval_required'; end if;
  for k in select jsonb_array_elements_text(c->'reviewItems') loop
   if length(trim(coalesce(p_input#>>array['resolutions',k],'')))=0 then raise exception 'unresolved_review_items'; end if;
  end loop;
  update market_private.migration_records set status='approved',approval_id=gen_random_uuid(),approved_at=clock_timestamp(),approval=jsonb_build_object('actor',u,'candidateHash',r.candidate_hash,'contentHash',r.content_hash,'approvalPackageHash',r.package_hash,'provider',p_input->'provider','resolutions',p_input->'resolutions') where id=r.id returning * into r;
  insert into market_private.migration_events(migration_id,owner,symbol,action,detail) values(r.id,u,s,'approved',r.approval||jsonb_build_object('approvalId',r.approval_id));
 elsif p_action='apply' then
  if r.status<>'approved' or r.approval_id is null or p_input->>'approvalId' is distinct from r.approval_id::text or r.applied_at is not null then raise exception 'approval_not_available'; end if;
  if h.current_version<>r.expected_version or h.generation<>r.expected_generation then raise exception 'version_conflict'; end if;
  if exists(select 1 from market_private.migration_records where owner=u and symbol=s and id<>r.id and status in ('staged','approved')) then raise exception 'active_migration_conflict'; end if;
  select bundle into prior from market_private.migration_versions where owner=u and symbol=s and version=h.current_version;
  perform market_private.canonical_baseline(c,prior);
  b:=c->'stock';
  b:=jsonb_set(b,'{marketDataFreshness}',(b->'marketDataFreshness')||jsonb_build_object('kline_status','current','technical_analysis_stale',false,'revisionStatus','applied','dataVersion',r.candidate_hash,'resultVersion',r.candidate_hash,'sourceMigration',jsonb_build_object('migrationId',r.id,'previousVersion',h.current_version,'currentVersion',r.candidate_hash,'generation',h.generation+1,'aiJudgmentStatus','needs_review','approvalPackageHash',r.package_hash,'reason',case when c->>'type'='provider_rebase' then 'history_source_changed' else 'same_source_history_revision' end)));
  b:=jsonb_set(b,'{technicalData}',(b->'technicalData')||jsonb_build_object('technicalDataStatus','fresh','dataQuality','validated','dataVersion',r.candidate_hash,'aiJudgmentStatus','needs_review'));
  b:=jsonb_set(b,'{technicalIndicators}',(b->'technicalIndicators')||jsonb_build_object('dataVersion',r.candidate_hash));
  insert into market_private.migration_versions(owner,symbol,version,bundle) values(u,s,r.candidate_hash,b);
  update market_private.migration_heads set previous_version=current_version,current_version=r.candidate_hash,generation=generation+1,migration_id=r.id where owner=u and symbol=s;
  update market_private.migration_records set status='applied',applied_at=clock_timestamp() where id=r.id;
  insert into market_private.migration_events(migration_id,owner,symbol,action,detail) values(r.id,u,s,'applied',jsonb_build_object('fromVersion',h.current_version,'toVersion',r.candidate_hash,'approvalId',r.approval_id,'generation',h.generation+1));
 elsif p_action='rollback' then
  if r.status<>'applied' or h.migration_id is distinct from r.id or h.current_version<>r.candidate_hash or h.previous_version is null
   or p_input->>'approvalId' is distinct from r.approval_id::text then raise exception 'rollback_not_available'; end if;
  if p_input->>'phrase' is distinct from 'Rollback '||h.current_version||' to '||h.previous_version or length(trim(coalesce(p_input->>'reason','')))=0 then raise exception 'explicit_rollback_required'; end if;
  update market_private.migration_heads set current_version=previous_version,previous_version=current_version,generation=generation+1 where owner=u and symbol=s;
  update market_private.migration_records set status='rolled_back' where id=r.id;
  insert into market_private.migration_events(migration_id,owner,symbol,action,detail) values(r.id,u,s,'rolled_back',jsonb_build_object('fromVersion',h.current_version,'toVersion',h.previous_version,'generation',h.generation+1,'reason',left(p_input->>'reason',1000),'approvalId',r.approval_id));
 end if;
 return market_private.migration_view(u,s,r.id);
end $$;
create or replace function market_private.migration_release_binding() returns jsonb language sql immutable security invoker set search_path='' as $$ select jsonb_build_object('rpcVersion','approved-provider-migration-v1','guardHash','2b95be757867fe4b45e193d68368a68a46448a2314c0b02bdddf35ffed062ab3','assetVersion','market-data-canonical-hash-v1-20261008') $$;

create or replace function market_private.migration_view(p_owner uuid,p_symbol text,p_id uuid default null) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare r market_private.migration_records; h market_private.migration_heads; bundle jsonb; previous jsonb; c jsonb; anchor uuid; ready boolean;
begin
 select * into r from market_private.migration_records where owner=p_owner and symbol=p_symbol and (p_id is null or id=p_id) order by created_at desc,id desc limit 1;
 if not found then return null; end if;
 select * into h from market_private.migration_heads where owner=p_owner and symbol=p_symbol;
 select v.bundle into bundle from market_private.migration_versions v where v.owner=p_owner and v.symbol=p_symbol and v.version=h.current_version;
 select v.bundle into previous from market_private.migration_versions v where v.owner=p_owner and v.symbol=p_symbol and v.version=h.previous_version;
 c:=(r.capsule->>'candidate')::jsonb;
 select version into anchor from market_private.results where owner=p_owner and symbol=p_symbol order by completed_at desc,version desc limit 1;
 ready:=r.status='approved' and h.current_version=r.expected_version and h.generation=r.expected_generation and anchor is not distinct from r.daily_anchor
  and r.guard_version=market_private.migration_protocol() and not exists(select 1 from market_private.tasks where owner=p_owner and symbol=p_symbol and status in ('queued','running'));
 return jsonb_build_object('protocol',market_private.migration_protocol(),'owner',p_owner,'symbol',p_symbol,'migrationId',r.id,'status',r.status,'readyToApply',ready,
 'canonicalSerializationVersion',case when c->>'schemaVersion'='4' then 'MARKET_DATA_CANONICAL_SERIALIZATION_V1' else null end,
 'currentCanonicalHash',case when c->>'schemaVersion'='4' and bundle is not null then market_private.canonical_hash(bundle::json) else null end,
 'previousCanonicalHash',case when c->>'schemaVersion'='4' and previous is not null then market_private.canonical_hash(previous::json) else null end,
 'candidateId','rebase_'||r.candidate_hash,'candidateHash',r.candidate_hash,'contentHash',r.content_hash,'approvalPackageHash',r.package_hash,
 'expectedCurrentVersion',r.expected_version,'expectedGeneration',r.expected_generation,'currentVersion',h.current_version,'previousVersion',h.previous_version,'generation',h.generation,
 'approvalId',r.approval_id,'approvedAt',r.approved_at,'appliedAt',r.applied_at,'targetSourceContract',c->'sourceContract','guardVersion',r.guard_version,
 'bundle',case when h.generation>0 and h.migration_id=r.id then bundle else null end,'previousBundle',case when h.generation>0 and h.migration_id=r.id then previous else null end,
 'candidate',c||jsonb_build_object('candidateHash',r.candidate_hash,'canonicalSerializationVersion',case when c->>'schemaVersion'='4' then 'MARKET_DATA_CANONICAL_SERIALIZATION_V1' else null end,
 'currentCanonicalHash',case when c->>'schemaVersion'='4' and bundle is not null then market_private.canonical_hash(bundle::json) else null end,
 'previousCanonicalHash',case when c->>'schemaVersion'='4' and previous is not null then market_private.canonical_hash(previous::json) else null end,
 'candidateId','rebase_'||r.candidate_hash),'baseBundle',(r.capsule->>'base')::jsonb,'dailyAdvanced',anchor is distinct from r.daily_anchor,'release',c#>'{evidence,productionDeployment}');
end $$;
