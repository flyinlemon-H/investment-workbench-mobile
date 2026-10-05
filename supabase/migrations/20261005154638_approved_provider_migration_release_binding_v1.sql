-- Pin only the new migration control plane to this reviewed release.
-- Existing daily RPC, continuity guard and revision guard are unchanged.
create function market_private.migration_release_binding() returns jsonb language sql immutable security invoker set search_path='' as $$
 select jsonb_build_object('rpcVersion','approved-provider-migration-v1','guardHash','c409012a55076d0c9955009cbad70d8a69d94261eca7f0f98184f091f99732b8','assetVersion','approved-provider-rebase-apply-v1-20261005')
$$;
revoke all on function market_private.migration_release_binding() from public,anon,authenticated,service_role;
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
 if c->>'schemaVersion' is distinct from '3' or coalesce(c->>'type','') not in ('provider_rebase','same_provider_revision')
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
 return c||jsonb_build_object('candidateHash',ch,'candidateId','rebase_'||ch);
end $$;
