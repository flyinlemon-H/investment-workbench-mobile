'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {createDatabase,OWNER,OTHER}=require('./market-db.cjs');
const root=path.resolve(__dirname,'../..');
const migration=path.join(root,'supabase/migrations/20261005152256_approved_provider_migration_v1.sql');
function fixtures(){execFileSync('python',[path.join(__dirname,'migration-fixture.py')],{cwd:root});return ['9999.HK','9998.HK'].map(s=>JSON.parse(fs.readFileSync(path.join(root,'.rebase/approved-migration-delivery/fixture-'+s+'.json'),'utf8')))}
function exact(v){return Object.fromEntries(['migrationId','symbol','candidateHash','contentHash','approvalPackageHash','expectedCurrentVersion','expectedGeneration','guardVersion','approvalId'].map(k=>[k,v[k]]))}
function approval(v){const c=JSON.parse(v.capsule?.candidate||'{}');return {...exact(v),phrase:'Approve candidate '+v.candidateHash,provider:'yahoo',resolutions:Object.fromEntries((c.reviewItems||[]).map(x=>[x,'synthetic review']))}}
async function database(){const h=await createDatabase();await h.db.exec('create role service_role');await h.db.exec(fs.readFileSync(migration,'utf8'));await h.db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20261005154638_approved_provider_migration_release_binding_v1.sql'),'utf8'));return {...h,stage:async(p,owner=OWNER)=>(await h.db.query('select market_private.migration_stage($1,$2) as value',[owner,p])).rows[0].value,migration:async(action,input,owner=OWNER,role='authenticated')=>h.db.transaction(async tx=>{await tx.exec('set local role '+role);await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[owner||'']);return (await tx.query('select public.market_data_migration($1,$2) as value',[action,input])).rows[0].value})}}
module.exports={root,migration,fixtures,exact,approval,database,OWNER,OTHER};
