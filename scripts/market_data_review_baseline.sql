-- Catalog-only production review. No application RPCs: account('read') can expire tasks.
-- A paused project must be made available separately; this script never restores it.
begin read only;
set local statement_timeout = '20s';
with namespaces as (
 select oid,nspname,nspowner,nspacl from pg_namespace
 where nspname !~ '^pg_' and nspname <> 'information_schema'
), custom_functions as (
 select p.*,n.nspname from pg_proc p join namespaces n on n.oid=p.pronamespace
 where p.prokind in ('f','p') and not exists (
  select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e'
 )
)
select jsonb_build_object(
 'capturedAt',current_timestamp,'database',current_database(),'version',version(),
 'schemas',(select jsonb_agg(jsonb_build_object('name',nspname,'owner',pg_get_userbyid(nspowner),'acl',nspacl::text) order by nspname) from namespaces),
 'relations',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,'kind',c.relkind,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'acl',c.relacl::text) order by n.nspname,c.relname) from pg_class c join namespaces n on n.oid=c.relnamespace where c.relkind in ('r','p','v','m','S')),
 'columns',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'acl',a.attacl::text) order by n.nspname,c.relname,a.attnum) from pg_attribute a join pg_class c on c.oid=a.attrelid join namespaces n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where c.relkind in ('r','p','v','m') and a.attnum>0 and not a.attisdropped),
 'constraints',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',k.conname,'definition',pg_get_constraintdef(k.oid)) order by n.nspname,c.relname,k.conname) from pg_constraint k join pg_class c on c.oid=k.conrelid join namespaces n on n.oid=c.relnamespace),
 'indexes',(select jsonb_agg(to_jsonb(i) order by schemaname,indexname) from pg_indexes i where schemaname in (select nspname from namespaces)),
 'functions',(select jsonb_agg(jsonb_build_object('schema',nspname,'name',proname,'arguments',pg_get_function_identity_arguments(oid),'returns',pg_get_function_result(oid),'owner',pg_get_userbyid(proowner),'definer',prosecdef,'config',proconfig,'acl',proacl::text,'definition',pg_get_functiondef(oid)) order by nspname,proname,oid) from custom_functions),
 'triggers',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',t.tgname,'internal',t.tgisinternal,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid)) order by n.nspname,c.relname,t.tgname) from pg_trigger t join pg_class c on c.oid=t.tgrelid join namespaces n on n.oid=c.relnamespace),
 'eventTriggers',(select jsonb_agg(jsonb_build_object('name',evtname,'event',evtevent,'function',evtfoid::regprocedure::text,'enabled',evtenabled,'tags',evttags)) from pg_event_trigger),
 'policies',(select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p),
 'defaultPrivileges',(select jsonb_agg(jsonb_build_object('owner',pg_get_userbyid(defaclrole),'schema',n.nspname,'type',defaclobjtype,'acl',defaclacl::text)) from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace),
 'extensions',(select jsonb_agg(jsonb_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname)) from pg_extension e join pg_namespace n on n.oid=e.extnamespace),
 'roles',(select jsonb_agg(jsonb_build_object('role',rolname,'superuser',rolsuper,'bypassRls',rolbypassrls,'inherit',rolinherit)) from pg_roles where rolname in ('postgres','anon','authenticated','service_role')),
 'roleMemberships',(select jsonb_agg(jsonb_build_object('role',pg_get_userbyid(roleid),'member',pg_get_userbyid(member),'admin',admin_option)) from pg_auth_members where pg_get_userbyid(member) in ('anon','authenticated','service_role')),
 'dataApiSchemasGuc',current_setting('pgrst.db_schemas',true)
) as catalog;
commit;
-- Retrieve migration history separately with the read-only list_migrations tool.
-- Auth configuration/plan and actual Data API exposed schemas require management-plane reads.
