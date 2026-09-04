begin;
insert into auth.users(id) values
 ('ab000000-0000-4000-8000-000000000001'),('ab000000-0000-4000-8000-000000000002');
set local role authenticated;
select set_config('request.jwt.claim.sub','ab000000-0000-4000-8000-000000000001',true);

do $$
declare payload jsonb := jsonb_build_object(
  'investmentThesis','精简投资逻辑','coreDrivers',jsonb_build_array('驱动一'),
  'keyRisks',jsonb_build_array('风险一'),'reviewTriggers',jsonb_build_array('条件一'),
  'logicStatus','valid','confidence','medium','nextReviewDate','2026-12-01'
); result jsonb;
begin
  result:=public.publish_analysis_module('long_term_logic','1810.HK','long-term-logic.v2','sha256:'||repeat('a',64),payload,0,null);
  if result->>'status'<>'published' or (result->'module'->>'revision')::bigint<>1 then raise exception 'first publication failed'; end if;
  result:=public.publish_analysis_module('long_term_logic','1810.HK','long-term-logic.v2','sha256:'||repeat('a',64),payload,1,'sha256:'||repeat('a',64));
  if result->>'status'<>'no_change' or (result->'module'->>'revision')::bigint<>1 then raise exception 'no-change inflated revision'; end if;
  result:=public.publish_analysis_module('long_term_logic','1810.HK','long-term-logic.v2','sha256:'||repeat('b',64),payload||jsonb_build_object('investmentThesis','新逻辑'),0,null);
  if result->>'status'<>'conflict' then raise exception 'stale publication was accepted'; end if;
  result:=public.publish_analysis_module('long_term_logic','1810.HK','long-term-logic.v2','sha256:'||repeat('b',64),payload||jsonb_build_object('investmentThesis','新逻辑'),1,'sha256:'||repeat('a',64));
  if result->>'status'<>'published' or (result->'module'->>'revision')::bigint<>2 then raise exception 'revision two failed'; end if;
  if jsonb_array_length(public.list_analysis_modules())<>1 then raise exception 'duplicate current row'; end if;
  begin perform public.publish_analysis_module('bad type','1810.HK','long-term-logic.v2','sha256:'||repeat('c',64),payload,0,null);raise exception 'malformed module accepted';exception when others then if sqlerrm='malformed module accepted' then raise;end if;end;
  begin perform public.publish_analysis_module('long_term_logic','1810.HK','long-term-logic.v3','sha256:'||repeat('c',64),payload,2,'sha256:'||repeat('b',64));raise exception 'future schema accepted';exception when others then if sqlerrm='future schema accepted' then raise;end if;end;
  begin perform public.publish_analysis_module('long_term_logic','1810.HK','long-term-logic.v2','sha256:'||repeat('c',64),payload||jsonb_build_object('shares',100),2,'sha256:'||repeat('b',64));raise exception 'private payload key accepted';exception when others then if sqlerrm='private payload key accepted' then raise;end if;end;
end $$;

select set_config('request.jwt.claim.sub','ab000000-0000-4000-8000-000000000002',true);
do $$ begin
  if jsonb_array_length(public.list_analysis_modules())<>0 then raise exception 'cross-owner read allowed'; end if;
  if public.get_analysis_module('long_term_logic','1810.HK') is not null then raise exception 'cross-owner module read allowed'; end if;
end $$;
select public.publish_analysis_module(
  'long_term_logic','1810.HK','long-term-logic.v2','sha256:'||repeat('e',64),
  jsonb_build_object('investmentThesis','B 自己的逻辑','coreDrivers',jsonb_build_array('驱动'),
    'keyRisks',jsonb_build_array('风险'),'reviewTriggers',jsonb_build_array('条件'),
    'logicStatus','valid','confidence','medium','nextReviewDate','2026-12-01'),0,null
);
select set_config('request.jwt.claim.sub','ab000000-0000-4000-8000-000000000001',true);
do $$ declare own_module jsonb; begin
  own_module:=public.get_analysis_module('long_term_logic','1810.HK');
  if (own_module->>'revision')::bigint<>2 or own_module->>'payloadHash'<>(('sha256:'||repeat('b',64))) then raise exception 'cross-owner overwrite allowed'; end if;
end $$;

set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
  begin perform public.list_analysis_modules();raise exception 'anonymous list allowed';exception when insufficient_privilege then null;end;
  begin perform public.get_analysis_module('long_term_logic','1810.HK');raise exception 'anonymous read allowed';exception when insufficient_privilege then null;end;
  begin perform public.publish_analysis_module('long_term_logic','1810.HK','long-term-logic.v2','sha256:'||repeat('d',64),'{}'::jsonb,0,null);raise exception 'anonymous publish allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
select 'PASS: owner isolation, anonymous denial, payload/schema guards, no-change, CAS revision and unique current row; fixtures rolled back' as result;
