'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {database,OWNER,OTHER,root}=require('./migration-db.cjs');
const migration=path.join(root,'supabase/migrations/20261020033733_bounded_daily_revision_v1.sql');
async function setup(stable=false){
 const h=await database();await h.db.exec(fs.readFileSync(migration,'utf8'));
 if(!fs.existsSync(path.join(root,'.rebase/bounded-daily-v1/fixture.json')))execFileSync(process.env.PYTHON_EXECUTABLE||'python',['-B',path.join(root,'tests/helpers/bounded-daily-fixture.py')],{cwd:root});
 const f=JSON.parse(fs.readFileSync(path.join(root,'.rebase/bounded-daily-v1/fixture.json'),'utf8'));
 if(stable){f.baseline=f.stableBaseline;f.submission=f.stableSubmission;f.observations.A=f.baseline.observation;}
 for(const [version,bundle]of [[f.previousVersion,f.previousBundle],[f.rebaseVersion,f.baseline.bundle]])
  await h.db.query('insert into market_private.migration_versions(owner,symbol,version,bundle) values($1,$2,$3,$4)',[OWNER,'2899.HK',version,bundle]);
 await h.db.query('insert into market_private.migration_heads(owner,symbol,current_version,previous_version,generation) values($1,$2,$3,$4,1)',[OWNER,'2899.HK',f.rebaseVersion,f.previousVersion]);
 // Bootstrap reads the existing trusted head; no Stage/Approve/Apply in this fixture.
 const baseline=(await h.db.query('select market_private.daily_bootstrap($1,$2,$3) as v',[OWNER,f.rebaseVersion,f.observations.A])).rows[0].v;
 await h.db.query('update market_private.daily_heads set enabled=true where owner=$1',[OWNER]);
 async function rpc(fn,args,role='anon',owner=null){return h.db.transaction(async tx=>{
  if(!['anon','authenticated','service_role'].includes(role))throw Error('invalid_test_role');
  await tx.exec('set local role '+role);await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[owner||'']);
  return (await tx.query(`select public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as v`,args)).rows[0].v;
 })}
 return {...h,f,baseline,daily:(token,action,p)=>rpc('market_data_daily_worker',[token,action,p]),read:(owner=OWNER)=>rpc('market_data_daily_current',['2899.HK'],'authenticated',owner),rawrpc:rpc};
}
module.exports={setup,OWNER,OTHER,root,migration};
