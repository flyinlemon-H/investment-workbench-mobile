'use strict';
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const OWNER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
async function createDatabase(){
 const db=new PGlite();
 await db.exec(`create role anon; create role authenticated; create schema auth; create schema extensions;
 create table auth.users(id uuid primary key);
 insert into auth.users values ('${OWNER}'),('${OTHER}');
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
 create function extensions.digest(text,text) returns bytea language sql immutable as $$ select sha256(convert_to($1,'UTF8')) $$;
 grant usage on schema auth to anon,authenticated; grant execute on all functions in schema auth to anon,authenticated;`);
 await db.exec(fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/20261001155527_market_data_orchestrator_v1.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/20261002021235_market_data_worker_capability_lock.sql'),'utf8'));
 // Each RPC runs in a real DB transaction under its actual caller role. Only Auth
 // JWT lookup and pgcrypto text digest are scaffolded in this local test engine.
 async function rpc(role,owner,fn,args){return db.transaction(async tx=>{
  await tx.exec(`set local role ${role}`);
  await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[owner||'']);
  const names={account:'public.market_data_account',worker:'public.market_data_worker'};
  return (await tx.query(`select ${names[fn]}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as data`,args)).rows[0].data;
 })}
 return {db,account:(action,input,owner=OWNER)=>rpc('authenticated',owner,'account',[action,input]),worker:(token,action,input)=>rpc('anon',null,'worker',[token,action,input]),rpc};
}
module.exports={createDatabase,OWNER,OTHER};
