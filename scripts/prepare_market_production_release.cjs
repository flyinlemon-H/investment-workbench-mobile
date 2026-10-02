'use strict';
// File generation only: no database/network client and no execution path.
const fs=require('node:fs'),path=require('node:path');
const migrations=[
 {file:'20261001155527_market_data_orchestrator_v1.sql',version:'20261002020030',name:'market_data_orchestrator_v1'},
 {file:'20261002021235_market_data_worker_capability_lock.sql',version:'20261002021340',name:'market_data_worker_capability_lock'}
];
function buildRelease(){
 const sql=migrations.map(m=>fs.readFileSync(path.join(__dirname,'../supabase/migrations',m.file),'utf8').replace(/\r\n/g,'\n').trim());
 const quote=s=>"'"+s.replace(/'/g,"''")+"'";
 return `-- REVIEWED PLAN ONLY. DO NOT EXECUTE WITHOUT A NEW EXPLICIT PRODUCTION AUTHORIZATION.
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
${sql[0]}

-- M2 (unmodified reviewed SQL; no intermediate COMMIT)
${sql[1]}

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

${migrations.map((m,i)=>`insert into supabase_migrations.schema_migrations(version,name,statements) values (${quote(m.version)},${quote(m.name)},array[${quote(sql[i])}]);`).join('\n')}
commit;
`;
}
if(require.main===module){const target=path.join(__dirname,'../supabase/review/market_data_orchestrator_production.sql');fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,buildRelease());console.log('Generated review-only SQL; nothing executed: '+target)}
module.exports={buildRelease,migrations};
