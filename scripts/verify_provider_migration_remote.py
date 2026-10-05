"""Generate a rollback-only remote acceptance transaction with synthetic symbols.
No real credentials, production symbols or persistent acceptance objects.
"""
import json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
p=root/'.rebase/approved-migration-delivery'
c=json.loads((p/'fixture-9999.HK.json').read_text())
q='''begin;
do $accept$
declare owner_id uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid(); p jsonb:= $capsule$CAPSULE$capsule$::jsonb;
 c jsonb:=(p->>'candidate')::jsonb; v jsonb; a jsonb; applied jsonb; i jsonb; bad jsonb; k text; x text; n int; g bigint; caught boolean; event_count int; versions int; rows_before jsonb; checks jsonb:='[]';
begin
 -- Accounts exist only inside this rolled-back transaction; no passwords/emails.
 insert into auth.users(id) values(owner_id),(other_id);
 perform market_private.migration_stage(owner_id,p);
 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 set local role authenticated;
 v:=public.market_data_migration('read',jsonb_build_object('symbol','9999.HK'));
 if v->>'status'<>'staged' or v->>'generation'<>'0' or v->'bundle'<>'null'::jsonb then raise exception 'staging_changed_current'; end if;
 i:=jsonb_build_object('migrationId',v->'migrationId','symbol','9999.HK','candidateHash',v->'candidateHash','contentHash',v->'contentHash','approvalPackageHash',v->'approvalPackageHash','expectedCurrentVersion',v->'expectedCurrentVersion','expectedGeneration',v->'expectedGeneration','guardVersion',v->'guardVersion');
 caught:=false;begin perform public.market_data_migration('apply',i);exception when others then if sqlerrm<>'approval_not_available' then raise;end if;caught:=true;end;if not caught then raise exception 'unapproved_apply';end if;
 checks:=checks||'["staging_without_switch","approval_required"]';
 foreach k in array array['candidateHash','contentHash','approvalPackageHash'] loop
  caught:=false;begin perform public.market_data_migration('approve',i||jsonb_build_object(k,repeat('0',64)));exception when others then if sqlerrm<>'approval_binding_mismatch' then raise;end if;caught:=true;end;if not caught then raise exception 'hash_mismatch_accepted';end if;
 end loop;
 checks:=checks||'["three_hash_mismatches_rejected"]';
 caught:=false;begin perform public.market_data_migration('apply',i||'{"applyIntent":"provider_rebase_apply","approved":true}');exception when others then if sqlerrm<>'invalid_action' then raise;end if;caught:=true;end;if not caught then raise exception 'client_claim_trusted';end if;
 checks:=checks||'["client_self_approval_rejected"]';
 reset role;
 perform set_config('request.jwt.claim.sub',other_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',other_id,'role','authenticated')::text,true);
 set local role authenticated;
 if public.market_data_migration('read','{"symbol":"9999.HK"}') is not null then raise exception 'outsider_read';end if;
 foreach x in array array['approve','apply','rollback'] loop
  caught:=false;begin perform public.market_data_migration(x,i);exception when others then if sqlerrm<>'migration_not_owned' then raise;end if;caught:=true;end;if not caught then raise exception 'outsider_mutation';end if;
 end loop;
 checks:=checks||'["outsider_read_approve_apply_rollback_denied"]';
 reset role;set local role anon;
 caught:=false;begin perform public.market_data_migration('read','{"symbol":"9999.HK"}');exception when insufficient_privilege then caught:=true;end;if not caught then raise exception 'anonymous_access';end if;
 reset role;
 foreach k in array array['migration_versions','migration_heads','migration_records','migration_events'] loop
  if not (select relrowsecurity from pg_class where oid=('market_private.'||k)::regclass) then raise exception 'rls_disabled';end if;
  foreach x in array array['anon','authenticated','service_role'] loop
   if has_table_privilege(x,'market_private.'||k,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'direct_table_access';end if;
  end loop;
 end loop;
 if has_function_privilege('authenticated','market_private.migration_stage(uuid,jsonb)','EXECUTE') or has_function_privilege('anon','market_private.migration_account(text,jsonb)','EXECUTE') or has_function_privilege('service_role','market_private.migration_stage(uuid,jsonb)','EXECUTE') then raise exception 'privileged_stage_exposed';end if;
 checks:=checks||'["anonymous_denied","four_table_rls_and_grants","operator_staging_not_exposed"]';
 bad:=p||jsonb_build_object('base','{}');caught:=false;begin perform market_private.migration_stage(other_id,bad);exception when others then if sqlerrm<>'hash_binding_mismatch' then raise;end if;caught:=true;end;if not caught then raise exception 'capsule_forged';end if;
 checks:=checks||'["server_rehashes_capsule"]';
 foreach k in array array['guard','release'] loop
  bad:=p||jsonb_build_object('candidate',case when k='guard' then jsonb_set(c,'{guardImplementationHash}',to_jsonb(repeat('0',64)))::text else jsonb_set(c,'{evidence,productionDeployment,assetVersion}','"obsolete"')::text end);
  caught:=false;begin perform market_private.migration_stage(other_id,bad);exception when others then if sqlerrm<>'migration_release_binding_mismatch' then raise;end if;caught:=true;end;if not caught then raise exception 'old_release_accepted';end if;
 end loop;
 checks:=checks||'["stale_guard_rejected","stale_release_rejected"]';

 perform set_config('request.jwt.claim.sub',owner_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 set local role authenticated;
 select jsonb_object_agg(value,'isolated fixture review') into bad from jsonb_array_elements_text(c->'reviewItems');
 a:=public.market_data_migration('approve',i||jsonb_build_object('phrase','Approve candidate '||(v->>'candidateHash'),'provider',c#>'{sourceContract,canonicalProvider}','resolutions',bad));
 i:=i||jsonb_build_object('approvalId',a->'approvalId');
 if a->>'status'<>'approved' or a->>'readyToApply'<>'true' then raise exception 'approval_failed';end if;
 caught:=false;begin perform public.market_data_migration('apply',i||'{"expectedGeneration":123}');exception when others then if sqlerrm<>'version_conflict' then raise;end if;caught:=true;end;if not caught then raise exception 'version_conflict_accepted';end if;
 checks:=checks||'["owner_exact_approval","version_conflict_rejected"]';
 reset role;
 insert into market_private.tasks(owner,symbol,status) values(owner_id,'9999.HK','queued');
 set local role authenticated;
 caught:=false;begin perform public.market_data_migration('apply',i);exception when others then if sqlerrm<>'active_task_conflict' then raise;end if;caught:=true;end;if not caught then raise exception 'active_task_accepted';end if;
 reset role;update market_private.tasks set status='failed' where owner=owner_id;
 checks:=checks||'["active_task_conflict_rejected"]';
 select count(*) into event_count from market_private.migration_events where owner=owner_id;
 select count(*) into versions from market_private.migration_versions where owner=owner_id;
 -- Raise after full RPC execution but before outer transaction commit.
 set local role authenticated;
 begin
  perform public.market_data_migration('apply',i);
  raise exception 'injected_after_pointer_before_commit';
 exception when others then if sqlerrm<>'injected_after_pointer_before_commit' then raise;end if;
 end;
 reset role;
 if (select count(*) from market_private.migration_events where owner=owner_id)<>event_count or (select count(*) from market_private.migration_versions where owner=owner_id)<>versions
  or (select generation from market_private.migration_heads where owner=owner_id)<>0 or (select status from market_private.migration_records where owner=owner_id)<>'approved' then raise exception 'failure_not_atomic';end if;
 checks:=checks||'["failure_after_pointer_rolls_back_all_objects"]';
 set local role authenticated;
 applied:=public.market_data_migration('apply',i);
 if applied->>'status'<>'applied' or applied->>'generation'<>'1' or applied->'previousBundle' is distinct from (p->>'base')::jsonb
  or applied#>'{bundle,priceHistory}' is distinct from c#>'{stock,priceHistory}' or applied#>>'{bundle,technicalData,technicalVersion}' is distinct from applied#>>'{bundle,marketDataFreshness,technicalVersion}' then raise exception 'apply_not_complete';end if;
 if public.market_data_migration('apply',i)->>'idempotent'<>'true' then raise exception 'duplicate_not_idempotent';end if;
 checks:=checks||'["atomic_complete_apply","technical_and_content_aligned","duplicate_apply_idempotent"]';
 -- Ephemeral random capability is never returned or logged.
 x:=replace(gen_random_uuid()::text,'-','')||replace(gen_random_uuid()::text,'-','');
 perform public.market_data_account('register_worker',jsonb_build_object('token',x));
 reset role;set local role anon;
 bad:=public.market_data_migration_current(x,'9999.HK');
 if bad->>'owner'<>owner_id::text or bad->>'currentVersion'<>applied->>'currentVersion' then raise exception 'worker_read_wrong_owner';end if;
 reset role;set local role authenticated;perform public.market_data_account('revoke_worker','{}');reset role;set local role anon;
 caught:=false;begin perform public.market_data_migration_current(x,'9999.HK');exception when others then if sqlerrm<>'worker_unauthorized' then raise;end if;caught:=true;end;if not caught then raise exception 'revoked_worker_read';end if;
 reset role;
 checks:=checks||'["worker_capability_read_only","capability_revoke"]';
 caught:=false;begin delete from market_private.migration_versions where owner=owner_id;exception when others then if sqlerrm<>'immutable_migration' then raise;end if;caught:=true;end;if not caught then raise exception 'immutable_version_deleted';end if;
 caught:=false;begin delete from market_private.migration_events where owner=owner_id;exception when others then if sqlerrm<>'immutable_migration' then raise;end if;caught:=true;end;if not caught then raise exception 'audit_deleted';end if;
 checks:=checks||'["immutable_versions_and_append_only_audit"]';
 set local role authenticated;
 bad:=i||jsonb_build_object('expectedCurrentVersion',applied->'currentVersion','expectedGeneration',applied->'generation','phrase','Rollback '||(applied->>'currentVersion')||' to '||(applied->>'previousVersion'),'reason','isolated rollback-only acceptance');
 v:=public.market_data_migration('rollback',bad);
 if v->>'status'<>'rolled_back' or v->'bundle' is distinct from (p->>'base')::jsonb or v->'previousBundle' is distinct from applied->'bundle' then raise exception 'rollback_not_complete';end if;
 caught:=false;begin perform public.market_data_migration('apply',i||jsonb_build_object('expectedCurrentVersion',v->'currentVersion','expectedGeneration',v->'generation'));exception when others then if sqlerrm<>'approval_not_available' then raise;end if;caught:=true;end;if not caught then raise exception 'consumed_approval_replayed';end if;
 reset role;
 checks:=checks||'["rollback_restores_all_old_facts","consumed_approval_cannot_replay"]';
 perform set_config('migration.acceptance_result',jsonb_build_object('status','PASS','checks',checks,'count',jsonb_array_length(checks),'isolation','random accounts / synthetic 9999.HK / transaction rollback','formalDataWritten',false)::text,true);
end $accept$;
select current_setting('migration.acceptance_result')::jsonb as acceptance;
rollback;
'''.replace('CAPSULE',json.dumps(c,ensure_ascii=False))
(p/'remote-acceptance.sql').write_text(q,encoding='utf-8')
print('Remote acceptance transaction generated')
