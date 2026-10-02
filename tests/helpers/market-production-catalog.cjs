'use strict';
// Reconstruct reviewed production application DEFINITIONS in local memory; never copy user rows.
const fs=require('node:fs'),{createDatabase}=require('./market-db.cjs');
const baseline=JSON.parse(fs.readFileSync('docs/market-data-production-live-baseline.json','utf8'));
const q=s=>'"'+s.replace(/"/g,'""')+'"',name=x=>q(x.schema)+'.'+q(x.name);
async function createProductionCatalog(){
 const api=await createDatabase(),db=api.db;
 await db.exec('drop function public.market_data_account(text,jsonb);drop function public.market_data_worker(text,text,jsonb);drop schema market_private cascade;create role service_role bypassrls;');
 for(const s of baseline.schemas)if(s.name!=='public')await db.exec('create schema '+q(s.name));
 for(const table of baseline.relations){
  const cols=baseline.columns.filter(c=>c.schema===table.schema&&c.table===table.name).map(c=>q(c.name)+' '+c.type+(c.default?' default '+c.default:'')+(c.notNull?' not null':''));
  await db.exec('create table '+name(table)+'('+cols.join(',')+')');
 }
 for(const type of ['PRIMARY KEY','UNIQUE','CHECK','FOREIGN KEY'])for(const c of baseline.constraints.filter(c=>c.definition.startsWith(type)))await db.exec('alter table '+q(c.schema)+'.'+q(c.table)+' add constraint '+q(c.name)+' '+c.definition);
 for(const i of baseline.indexes)if(!baseline.constraints.some(c=>c.name===i.indexname))await db.exec(i.indexdef);
 const privateFunctions=baseline.functions.filter(f=>f.schema!=='public');
 for(const f of privateFunctions.filter(f=>!f.definer))await db.exec(f.definition);
 for(const f of privateFunctions.filter(f=>f.definer))await db.exec(f.definition);
 for(const f of baseline.functions.filter(f=>f.schema==='public'))await db.exec(f.definition);
 // Reproduce the relevant production schema ACL and default privileges.
 await db.exec('revoke create on schema public from public,anon,authenticated;grant usage on schema public,extensions,universe_private to anon,authenticated;grant usage on schema analysis_private to authenticated;alter default privileges in schema public revoke all on functions from public,anon,authenticated,service_role;');
 for(const t of baseline.relations){
  await db.exec('alter table '+name(t)+' enable row level security;revoke all on '+name(t)+' from public,anon,authenticated,service_role');
  for(const role of ['anon','authenticated','service_role']){
   const acl=t.acl.match(new RegExp('(?:[{,])'+role+'=([^/]*)/'))?.[1]||'';
   const map={a:'INSERT',r:'SELECT',w:'UPDATE',d:'DELETE',D:'TRUNCATE',x:'REFERENCES',t:'TRIGGER',m:'MAINTAIN'};
   if(acl)await db.exec('grant '+[...acl].filter(c=>map[c]).map(c=>map[c]).join(',')+' on '+name(t)+' to '+role);
  }
 }
 for(const f of baseline.functions){
  const sig=name(f)+'('+f.arguments+')';if(f.acl===null)continue;
  await db.exec('revoke all on function '+sig+' from public,anon,authenticated,service_role');
  for(const role of ['anon','authenticated','service_role'])if(f.acl.includes(role+'=X/'))await db.exec('grant execute on function '+sig+' to '+role);
 }
 for(const p of baseline.policies)await db.exec('create policy '+q(p.policyname)+' on '+q(p.schemaname)+'.'+q(p.tablename)+' for '+p.cmd+' to '+p.roles.map(r=>r==='public'?'PUBLIC':q(r)).join(',')+(p.qual?' using ('+p.qual+')':'')+(p.with_check?' with check ('+p.with_check+')':''));
 await db.exec(`create event trigger ensure_rls on ddl_command_end when tag in ('CREATE TABLE','CREATE TABLE AS','SELECT INTO') execute function public.rls_auto_enable();
 create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text,created_by text,idempotency_key text unique,rollback text[]);
 insert into supabase_migrations.schema_migrations(version,name,statements) values ('20260903132654','stock_universe_auto_add_v1a',array['original-fixture-one']),('20260903132704','stock_universe_private_rpc_boundary',array['original-fixture-two']);
 insert into public.input_queue(id,payload) values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','{"fixture":"preserve-local-only"}');`);
 return api;
}
async function snapshot(db){const sets=await db.exec(fs.readFileSync('scripts/market_data_review_baseline.sql','utf8'));return sets.find(s=>s.rows[0]?.catalog).rows[0].catalog}
module.exports={createProductionCatalog,snapshot};
