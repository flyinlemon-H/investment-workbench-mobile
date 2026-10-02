'use strict';
// Offline production-review evidence. All DDL below runs ONLY inside an in-memory PGlite.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {createDatabase}=require('./helpers/market-db.cjs');
const first=fs.readFileSync('supabase/migrations/20261001155527_market_data_orchestrator_v1.sql','utf8');
const second=fs.readFileSync('supabase/migrations/20261002021235_market_data_worker_capability_lock.sql','utf8');
async function empty(){const api=await createDatabase();await api.db.exec(`drop function public.market_data_account(text,jsonb);drop function public.market_data_worker(text,text,jsonb);drop schema market_private cascade;
 create table public.review_existing_business(id int primary key, payload text);insert into public.review_existing_business values(1,'preserve');grant select on public.review_existing_business to authenticated;`);return api}
async function functions(db){return (await db.query(`select n.nspname,p.proname,p.prosecdef,p.proconfig,p.proacl::text,md5(pg_get_functiondef(p.oid)) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='market_private' or (n.nspname='public' and p.proname in ('market_data_account','market_data_worker')) order by 1,2`)).rows}
test('dry schema inventory and direct table privileges match the reviewed allowlist',async()=>{
 const api=await empty();try{
  await api.db.transaction(tx=>tx.exec(first));await api.db.transaction(tx=>tx.exec(second));
  const tables=(await api.db.query(`select relname,relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='market_private' and relkind='r' order by relname`)).rows;
  assert.deepEqual(tables.map(t=>t.relname),['results','tasks','workers']);assert(tables.every(t=>t.relrowsecurity));
  assert.equal((await api.db.query("select count(*)::int n from pg_indexes where schemaname='market_private'")).rows[0].n,8);
  const policies=(await api.db.query("select cmd,qual,with_check from pg_policies where schemaname='market_private'")).rows;
  assert.equal(policies.length,3);assert(policies.every(p=>p.cmd==='ALL'&&p.qual==='false'&&p.with_check==='false'));
  const funcs=await functions(api.db);assert.equal(funcs.length,5);assert.equal(funcs.filter(f=>f.prosecdef).length,2);assert(funcs.every(f=>f.proconfig.includes('search_path=""')));
  for(const role of ['anon','authenticated'])for(const table of tables)for(const privilege of ['SELECT','INSERT','UPDATE','DELETE']){
   const access=await api.db.query('select has_table_privilege($1,$2,$3) allowed',[role,'market_private.'+table.relname,privilege]);assert.equal(access.rows[0].allowed,false);
  }
  assert.equal((await api.db.query('select payload from public.review_existing_business')).rows[0].payload,'preserve');
  assert.equal((await api.db.query("select has_table_privilege('authenticated','public.review_existing_business','SELECT') allowed")).rows[0].allowed,true);
 }finally{await api.db.close()}
});
test('explicit transaction rolls back all objects and grants after migration failure',async()=>{
 const api=await empty();try{
  await assert.rejects(api.db.transaction(tx=>tx.exec(first+'\nselect 1/0;')),/division by zero/);
  assert.equal((await api.db.query("select count(*)::int n from pg_namespace where nspname='market_private'")).rows[0].n,0);assert.deepEqual(await functions(api.db),[]);
  await api.db.transaction(tx=>tx.exec(first));const before=await functions(api.db);
  await assert.rejects(api.db.transaction(tx=>tx.exec(second+'\nselect 1/0;')),/division by zero/);
  assert.deepEqual(await functions(api.db),before);
  assert.equal((await api.db.query('select payload from public.review_existing_business')).rows[0].payload,'preserve');
 }finally{await api.db.close()}
});
test('first migration fails safely on repeat; second preserves definitions and ACLs on repeat',async()=>{
 const api=await createDatabase();try{
  const before=await functions(api.db);
  await assert.rejects(api.db.transaction(tx=>tx.exec(first)),/already exists/);assert.deepEqual(await functions(api.db),before);
  await api.db.transaction(tx=>tx.exec(second));assert.deepEqual(await functions(api.db),before);
 }finally{await api.db.close()}
});
test('catalog baseline collector runs read-only and includes grants, definitions and triggers',async()=>{
 const api=await createDatabase();try{
  const output=await api.db.exec(fs.readFileSync('scripts/market_data_review_baseline.sql','utf8'));
  const catalog=output.find(result=>result.rows[0]?.catalog)?.rows[0].catalog;
  assert(catalog);assert.equal(catalog.functions.filter(f=>f.schema==='market_private').length,3);
  assert(catalog.policies.some(p=>p.policyname==='no_direct_results'));
  assert(catalog.triggers.some(t=>t.internal));assert(catalog.defaultPrivileges===null||Array.isArray(catalog.defaultPrivileges));
 }finally{await api.db.close()}
});
test('one release transaction never publishes M1 when M2 or postchecks fail',async()=>{
 const api=await empty();try{
  await assert.rejects(api.db.transaction(tx=>tx.exec(first+'\n'+second+'\nselect 1/0;')),/division by zero/);
  assert.equal((await api.db.query("select count(*)::int n from pg_namespace where nspname='market_private'")).rows[0].n,0);
  assert.deepEqual(await functions(api.db),[]);
  await api.db.transaction(tx=>tx.exec(first+'\n'+second));
  assert.equal((await functions(api.db)).length,5);
 }finally{await api.db.close()}
});
test('production catalog replay preserves existing definitions, policies, grants and ledger',async()=>{
 const {createProductionCatalog,snapshot}=require('./helpers/market-production-catalog.cjs'),{buildRelease}=require('../scripts/prepare_market_production_release.cjs');
 const {db}=await createProductionCatalog();try{
  await assert.rejects(db.query('select public.rls_auto_enable()'),/trigger functions can only be called as triggers/);
  const before=await snapshot(db),ledger=(await db.query('select * from supabase_migrations.schema_migrations order by version')).rows;
  const release=buildRelease();assert.equal(fs.readFileSync('supabase/review/market_data_orchestrator_production.sql','utf8').replace(/\r\n/g,'\n'),release);
  await db.exec(release);const after=await snapshot(db);
  const delta={tables:after.relations.filter(r=>r.kind==='r').length-before.relations.filter(r=>r.kind==='r').length,indexes:after.indexes.length-before.indexes.length,functions:after.functions.length-before.functions.length,policies:after.policies.length-before.policies.length};
  assert.deepEqual(delta,{tables:3,indexes:8,functions:5,policies:3});
  for(const key of ['schemas','relations','columns','constraints','indexes','functions','triggers','policies','defaultPrivileges','eventTriggers'])for(const value of before[key]||[])assert((after[key]||[]).some(a=>JSON.stringify(a)===JSON.stringify(value)),key+' changed existing object');
  assert.deepEqual((await db.query("select * from supabase_migrations.schema_migrations where version<'20261001' order by version")).rows,ledger);
  const added=(await db.query("select version,name from supabase_migrations.schema_migrations where version>'20261001' order by version")).rows;
  assert.deepEqual(added.map(r=>r.version),['20261002020030','20261002021340']);
  assert.equal((await db.query('select payload from public.input_queue')).rows[0].payload.fixture,'preserve-local-only');
  fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/market-production-live-dry-diff.json',JSON.stringify({kind:'local catalog reconstruction; no production data',delta,existingDefinitionsPoliciesGrantsPreserved:true,existingLedgerRowsPreserved:true,newLedgerVersions:added.map(r=>r.version),eventTriggerOrdinaryCallRejected:true},null,2));
  await assert.rejects(db.exec(release),/market_objects_already_exist/);await db.exec('rollback');
  assert.equal((await db.query('select count(*)::int n from supabase_migrations.schema_migrations')).rows[0].n,4);
 }finally{await db.close()}
});
test('production release failure rolls back both migrations and both ledger entries',async()=>{
 const {createProductionCatalog}=require('./helpers/market-production-catalog.cjs'),{buildRelease}=require('../scripts/prepare_market_production_release.cjs');
 const {db}=await createProductionCatalog();try{
  const broken=buildRelease().replace(/commit;\s*$/,'select 1/0;\ncommit;');
  await assert.rejects(db.exec(broken),/division by zero/);await db.exec('rollback');
  assert.equal((await db.query("select to_regnamespace('market_private') missing")).rows[0].missing,null);
  assert.equal((await db.query('select count(*)::int n from supabase_migrations.schema_migrations')).rows[0].n,2);
 }finally{await db.close()}
});
