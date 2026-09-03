-- Synthetic users and credentials exist only inside this transaction; no email is sent.
begin;
insert into auth.users(id) values
 ('aa000000-0000-4000-8000-000000000001'),('aa000000-0000-4000-8000-000000000002');
set local role authenticated;
select set_config('request.jwt.claim.sub','aa000000-0000-4000-8000-000000000001',true);
insert into public.stock_universe_entries(user_id,symbol,display_name)
 values(auth.uid(),'600000.SS','synthetic A');
insert into public.stock_universe_entries(user_id,symbol,display_name)
 values(auth.uid(),'600000.SS','must not rename') on conflict(user_id,symbol) do nothing;
do $$ begin
 if (select count(*) from public.stock_universe_entries)<>1 then raise exception 'duplicate membership'; end if;
 if (select display_name from public.stock_universe_entries limit 1)<>'synthetic A' then raise exception 'rename occurred'; end if;
 begin
   insert into public.stock_universe_entries(user_id,symbol) values('aa000000-0000-4000-8000-000000000002','000001.SZ');
   raise exception 'cross-user insert allowed';
 exception when insufficient_privilege then null; end;
 begin
   insert into public.stock_universe_entries(user_id,symbol) values(auth.uid(),'600000.SH');
   raise exception 'noncanonical symbol accepted';
 exception when check_violation then null; end;
 begin
   update public.stock_universe_entries set display_name='not allowed';
   raise exception 'update allowed';
 exception when insufficient_privilege then null; end;
 begin
   delete from public.stock_universe_entries;
   raise exception 'delete allowed';
 exception when insufficient_privilege then null; end;
end $$;
select public.register_stock_universe_reader(repeat('a',64),'Synthetic PC');
select set_config('request.jwt.claim.sub','aa000000-0000-4000-8000-000000000002',true);
do $$ begin
 if (select count(*) from public.stock_universe_entries)<>0 then raise exception 'cross-user select allowed'; end if;
 if public.list_stock_universe_readers()<>'[]'::jsonb then raise exception 'cross-user credential list'; end if;
end $$;
insert into public.stock_universe_entries(user_id,symbol) values(auth.uid(),'000001.SZ');
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$ declare payload jsonb; begin
 begin
   perform * from universe_private.reader_credentials;
   raise exception 'anon credential table read allowed';
 exception when insufficient_privilege then null; end;
 begin
   perform * from public.stock_universe_entries;
   raise exception 'anon table read allowed';
 exception when insufficient_privilege then null; end;
 begin
   insert into public.stock_universe_entries(user_id,symbol) values('aa000000-0000-4000-8000-000000000001','000002.SZ');
   raise exception 'anon insert allowed';
 exception when insufficient_privilege then null; end;
 begin
   perform public.register_stock_universe_reader(repeat('b',64),'Forbidden');
   raise exception 'anon can issue credential';
 exception when insufficient_privilege then null; end;
 begin
   perform public.read_stock_universe(repeat('b',64));
   raise exception 'invalid credential accepted';
 exception when insufficient_privilege then null; end;
 payload:=public.read_stock_universe(repeat('a',64));
 if payload->>'userId'<>'aa000000-0000-4000-8000-000000000001' or jsonb_array_length(payload->'symbols')<>1 or payload->'symbols'->0->>'symbol'<>'600000.SS' then
   raise exception 'PC capability escaped owner';
 end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','aa000000-0000-4000-8000-000000000001',true);
select public.revoke_stock_universe_reader((public.list_stock_universe_readers()->0->>'id')::uuid);
set local role anon;
select set_config('request.jwt.claim.sub','',true);
do $$ begin
 begin
   perform public.read_stock_universe(repeat('a',64));
   raise exception 'revoked credential accepted';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'PASS: owner select/insert, duplicate ignore, canonical constraint, no update/delete, anonymous denial, scoped PC read and revocation; fixtures rolled back' as result;
