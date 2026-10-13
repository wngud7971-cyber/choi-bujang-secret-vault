-- Step 4 / Production 3. Review, then run the entire file in Supabase SQL Editor.
-- No emails, passwords, tokens, keys or note contents are needed.
-- Only public.training_notes grants and policies are changed.
-- Existing notes, owners and service_role grants are preserved.
-- The temporary view/table below only retain permission metadata until commit.
begin;

-- Capture catalog grants and effective rights (including inherited/PUBLIC rights).
-- role_table_grants omits PUBLIC grants; has_table_privilege checks effective rights.
create temporary view step4_note_permission_state as
select
  r.role_name,
  array(
    select distinct g.privilege_type::text
    from information_schema.role_table_grants g
    where g.table_schema = 'public' and g.table_name = 'training_notes'
      and g.grantee = r.role_name
    order by g.privilege_type::text
  ) as recorded_grants,
  has_table_privilege(r.role_name, 'public.training_notes', 'SELECT') as can_select,
  has_table_privilege(r.role_name, 'public.training_notes', 'INSERT') as can_insert,
  has_table_privilege(r.role_name, 'public.training_notes', 'UPDATE') as can_update,
  has_table_privilege(r.role_name, 'public.training_notes', 'DELETE') as can_delete,
  has_table_privilege(r.role_name, 'public.training_notes',
    'TRUNCATE,REFERENCES,TRIGGER' || case
      when current_setting('server_version_num')::integer >= 170000 then ',MAINTAIN'
      else '' end) as has_extra_privileges,
  has_table_privilege(r.role_name, 'public.training_notes',
    'SELECT WITH GRANT OPTION,INSERT WITH GRANT OPTION,UPDATE WITH GRANT OPTION,DELETE WITH GRANT OPTION') as can_grant_crud,
  (select c.relrowsecurity from pg_class c
   where c.oid = 'public.training_notes'::regclass) as rls_enabled
from (values ('anon'::text), ('authenticated'::text)) r(role_name);

create temporary table step4_note_permission_audit on commit drop as
select 'before'::text as phase, s.* from step4_note_permission_state s;

-- Reset client grants on this table only, then grant exactly the four operations.
revoke all on table public.training_notes from public, anon, authenticated;
grant select, insert, update, delete on table public.training_notes to authenticated;
alter table public.training_notes enable row level security;

-- Replace this table's existing policies so an older permissive policy cannot
-- combine with the new policies and allow access to another owner's rows.
do $$
declare
  p record;
begin
  for p in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'training_notes'
  loop
    execute format('drop policy %I on public.training_notes', p.policyname);
  end loop;
end;
$$;

create policy training_notes_select_own
on public.training_notes for select to authenticated
using (auth.uid() = owner_id);

create policy training_notes_insert_own
on public.training_notes for insert to authenticated
with check (auth.uid() = owner_id);

create policy training_notes_update_own
on public.training_notes for update to authenticated
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

create policy training_notes_delete_own
on public.training_notes for delete to authenticated
using (auth.uid() = owner_id);

insert into step4_note_permission_audit
select 'after', s.* from step4_note_permission_state s;

-- Refuse to commit if an inherited privilege or remaining grant breaks the goal.
-- Do not change other roles, tables, or schemas to conceal such a failure.
do $$
begin
  if exists (
    select 1 from step4_note_permission_audit
    where phase = 'after' and (
      not rls_enabled or has_extra_privileges or can_grant_crud
      or (role_name = 'anon' and (can_select or can_insert or can_update or can_delete))
      or (role_name = 'authenticated' and not (can_select and can_insert and can_update and can_delete))
    )
  ) then
    raise exception 'Permission check failed; all changes are rolled back. Review this table grants and role inheritance.';
  end if;
end;
$$;

-- Four result rows: before/after for anon/authenticated. No user or note data.
select * from step4_note_permission_audit
order by case phase when 'before' then 0 else 1 end, role_name;

drop view step4_note_permission_state;
commit;

-- These are database permission checks, not live Data API or judge results.
-- After deploying the API change, check each account's own CRUD in the app.
-- Foreign note URLs must return 404; owner_id changes in PUT must return 400.
-- Direct Data API scoring checks use only an anon key. Authenticated role
-- configuration above does not constitute a judge-reproducible direct API test.
