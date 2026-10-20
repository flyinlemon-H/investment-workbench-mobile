"""Build a rollback-only test-project SQL acceptance transaction; never execute it."""
import argparse,json
from pathlib import Path

SQL=r'''
begin;
set local statement_timeout='120s';
do $accept$
declare u uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
 f jsonb:=$fixture$__FIXTURE__$fixture$::jsonb; b jsonb; p jsonb; baseline jsonb; q jsonb; task jsonb; result jsonb; current_head jsonb; restored jsonb;
 token text:=md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text); caught boolean; checks jsonb:='[]'; h text; oldcount integer; nextcount integer;
begin
 insert into auth.users(id,email) values(u,'bounded-'||u||'@example.invalid'),(outsider,'bounded-'||outsider||'@example.invalid');
 b:=f#>'{baseline,bundle}';p:=f->'submission';
 insert into market_private.migration_versions(owner,symbol,version,bundle) values(u,'2899.HK',f->>'rebaseVersion',b);
 insert into market_private.migration_heads(owner,symbol,current_version,generation) values(u,'2899.HK',f->>'rebaseVersion',1);
 baseline:=market_private.daily_bootstrap(u,f->>'rebaseVersion',f#>'{baseline,observation}');
 if baseline->>'enabled'<>'false' then raise exception 'enabled_by_default';end if;
 update market_private.daily_heads set enabled=true where owner=u;
 select md5(row_to_json(m)::text) into h from market_private.migration_heads m where owner=u;
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 perform public.market_data_account('register_worker',jsonb_build_object('token',token));
 task:=public.market_data_account('request','{"symbol":"2899.HK","taskType":"UPDATE_DAILY_MARKET_DATA"}');
 if task->>'status'<>'queued' then raise exception 'offline_not_queued';end if;
 q:=public.market_data_account('request','{"symbol":"2899.HK","taskType":"UPDATE_DAILY_MARKET_DATA"}');
 if q->>'taskId'<>task->>'taskId' then raise exception 'duplicate_execution';end if;
 execute 'reset role';checks:=checks||'["default_disabled","offline_queued","duplicate_active_suppressed"]';
 execute 'set local role anon';
 caught:=false;begin perform public.market_data_daily_current('2899.HK');exception when insufficient_privilege then caught:=true;end;if not caught then raise exception 'anonymous_read_allowed';end if;
 task:=public.market_data_worker(token,'claim','{}');
 if task->>'status'<>'running' then raise exception 'not_running';end if;
 baseline:=public.market_data_daily_worker(token,'current','{"symbol":"2899.HK"}');
 execute 'reset role';checks:=checks||'["anonymous_read_denied","claimed_running","worker_current_owner_bound"]';
 p:=p||jsonb_build_object('taskId',task->>'taskId','expectedVersion',baseline->>'versionId','expectedGeneration',baseline->'generation','expectedHash',baseline->>'bundleHash');
 p:=jsonb_set(p,'{bundle,marketDataFreshness,resultVersion}',task->'taskId');
 p:=p||jsonb_build_object('bundleHash',market_private.canonical_hash((p->'bundle')::json));
 perform set_config('request.jwt.claim.sub',outsider::text,true);
 execute 'set local role authenticated';
 if public.market_data_daily_current('2899.HK') is not null then raise exception 'outsider_read';end if;
 caught:=false;begin perform public.market_data_daily_worker(token,'finish',p);exception when insufficient_privilege then caught:=true;end;if not caught then raise exception 'browser_submit_allowed';end if;
 caught:=false;begin perform 1 from market_private.daily_versions;exception when insufficient_privilege then caught:=true;end;if not caught then raise exception 'direct_read_allowed';end if;
 caught:=false;begin update market_private.daily_heads set enabled=true;exception when insufficient_privilege then caught:=true;end;if not caught then raise exception 'direct_write_allowed';end if;
 caught:=false;begin perform market_private.daily_restore(u,(baseline->>'versionId')::uuid,(baseline->>'versionId')::uuid,'forbidden browser');exception when insufficient_privilege then caught:=true;end;if not caught then raise exception 'browser_restore_allowed';end if;
 execute 'reset role';checks:=checks||'["outsider_no_read","browser_no_submit","private_tables_denied","browser_no_restore"]';
 execute 'set local role anon';
 caught:=false;begin perform public.market_data_daily_worker(token,'finish',p||'{"expectedGeneration":9}');exception when others then if sqlerrm<>'VERSION_CONFLICT' then raise;end if;caught:=true;end;if not caught then raise exception 'CAS_allowed';end if;
 caught:=false;begin perform public.market_data_daily_worker(token,'finish',p||'{"policyVersion":"forged"}');exception when others then if sqlerrm<>'DAILY_PROTOCOL_MISMATCH' then raise;end if;caught:=true;end;if not caught then raise exception 'fake_policy_allowed';end if;
 caught:=false;begin perform public.market_data_daily_worker(token,'finish',jsonb_set(p,'{bundle,technicalData,ma5}','999'));exception when others then if sqlerrm<>'DAILY_FACTS_MISMATCH' then raise;end if;caught:=true;end;if not caught then raise exception 'fake_facts_allowed';end if;
 caught:=false;begin perform public.market_data_daily_worker(token,'finish',p||jsonb_build_object('bundleHash',repeat('a',64)));exception when others then if sqlerrm<>'DAILY_FACTS_MISMATCH' then raise;end if;caught:=true;end;if not caught then raise exception 'fake_hash_allowed';end if;
 execute 'reset role';checks:=checks||'["CAS_denied","policy_allowlist","technical_tamper_denied","hash_mismatch_denied"]';
 -- Submission succeeds inside a deliberately aborted subtransaction. Every effect must disappear.
 select count(*) into oldcount from market_private.daily_versions where owner=u;
 caught:=false;begin
  execute 'set local role anon';result:=public.market_data_daily_worker(token,'finish',p);execute 'reset role';
  if result->>'status'<>'succeeded' then raise exception 'unexpected_submit_result';end if;
  raise exception 'injected_after_atomic_write';
 exception when others then if sqlerrm<>'injected_after_atomic_write' then raise;end if;caught:=true;end;
 execute 'reset role';
 select count(*) into nextcount from market_private.daily_versions where owner=u;
 if nextcount<>oldcount or exists(select 1 from market_private.results where owner=u) or (select current_id::text from market_private.daily_heads where owner=u)<>baseline->>'versionId' then raise exception 'atomic_write_residue';end if;
 checks:=checks||'["failure_injection_all_effects_rollback"]';
 execute 'set local role anon';result:=public.market_data_daily_worker(token,'finish',p);q:=public.market_data_daily_worker(token,'finish',p);
 if result<>q or result->>'status'<>'succeeded' then raise exception 'duplicate_or_submit_failed';end if;
 execute 'reset role';
 perform set_config('request.jwt.claim.sub',u::text,true);
 execute 'set local role authenticated';current_head:=public.market_data_daily_current('2899.HK');execute 'reset role';
 if current_head->'bundle' is distinct from p->'bundle' or current_head->>'bundleHash'<>p->>'bundleHash' or jsonb_array_length(current_head#>'{bundle,priceHistory}')<>436
  or current_head#>>'{receipt,tier}'<>f->>'expectedTier' or current_head->>'previousId'<>baseline->>'versionId'
  or current_head?'observation' or current_head#>'{receipt,observations}' is not null then raise exception 'readback_mismatch';end if;
 checks:=checks||'["succeeded","idempotent_submit","436_bar_exact_readback","previous_retained","private_raw_not_exposed"]';
 caught:=false;begin update market_private.daily_versions set bundle='{}' where owner=u;exception when others then if sqlerrm<>'immutable_migration' then raise;end if;caught:=true;end;if not caught then raise exception 'immutable_not_enforced';end if;
 -- Failed restore remains completely atomic; successful restore appends, never erases.
 begin perform market_private.daily_restore(u,(current_head->>'versionId')::uuid,(baseline->>'versionId')::uuid,'isolated failure injection');raise exception 'injected_restore';
 exception when others then if sqlerrm<>'injected_restore' then raise;end if;end;
 if (select current_id::text from market_private.daily_heads where owner=u)<>current_head->>'versionId' then raise exception 'restore_failure_residue';end if;
 restored:=market_private.daily_restore(u,(current_head->>'versionId')::uuid,(baseline->>'versionId')::uuid,'isolated remote recovery acceptance');
 if restored->'bundle' is distinct from baseline->'bundle' or restored->>'generation'<>'2' or restored->>'enabled'<>'false' or restored->>'previousId'<>current_head->>'versionId' then raise exception 'restore_mismatch';end if;
 if (select md5(row_to_json(m)::text) from market_private.migration_heads m where owner=u)<>h then raise exception 'original_rebase_changed';end if;
 checks:=checks||'["immutable_audit","restore_failure_atomic","restore_full_facts_new_generation","original_rebase_unchanged"]';
 execute 'set local role authenticated';perform public.market_data_account('revoke_worker','{}');execute 'reset role';
 execute 'set local role anon';caught:=false;begin perform public.market_data_daily_worker(token,'finish',p);exception when insufficient_privilege then caught:=true;end;if not caught then raise exception 'revoked_capability_accepted';end if;
 execute 'reset role';checks:=checks||'["revoked_capability_denied"]';
 perform set_config('daily.acceptance',jsonb_build_object('status','PASS','mode',f->>'expectedTier','checks',checks,'count',jsonb_array_length(checks),'accounts','two random ephemeral Auth users','cleanup','transaction rollback','productionWritten',false)::text,true);
end $accept$;
select current_setting('daily.acceptance')::jsonb as acceptance;
rollback;
'''

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--stable',action='store_true');args=parser.parse_args()
    root=Path(__file__).resolve().parents[1];f=json.loads((root/'.rebase/bounded-daily-v1/fixture.json').read_text(encoding='utf-8'))
    if args.stable:f['baseline']=f['stableBaseline'];f['submission']=f['stableSubmission']
    value={k:f[k] for k in ('baseline','submission','rebaseVersion')};value['expectedTier']='NORMAL_UPDATE' if args.stable else 'AUDITED_REVISION'
    text=json.dumps(value,ensure_ascii=False,separators=(',',':'));assert '$fixture$' not in text
    output=root/'.rebase/bounded-daily-v1'/('remote-append.sql' if args.stable else 'remote-revision.sql');output.write_text(SQL.replace('__FIXTURE__',text),encoding='utf-8')
    print(json.dumps({'path':str(output),'bytes':output.stat().st_size,'rollbackOnly':True}))
if __name__=='__main__':main()
