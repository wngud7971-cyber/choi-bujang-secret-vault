-- Step 5: review, then run this entire file in the LEARNING Supabase SQL Editor.
-- Only public.training_notes client privileges and RLS enablement are changed.
-- Preserve all notes, owners, policies, other tables and service_role grants.
-- No keys, tokens, email addresses or note contents are required or returned.
begin;

-- Effective privileges include permissions inherited from roles and PUBLIC.
create temporary view step5_note_permission_state as
select
  r.role_name,
  has_table_privilege(r.role_name, 'public.training_notes', 'SELECT') as can_select,
  has_table_privilege(r.role_name, 'public.training_notes', 'INSERT') as can_insert,
  has_table_privilege(r.role_name, 'public.training_notes', 'UPDATE') as can_update,
  has_table_privilege(r.role_name, 'public.training_notes', 'DELETE') as can_delete,
  has_table_privilege(r.role_name, 'public.training_notes',
    'TRUNCATE,REFERENCES,TRIGGER' || case
      when current_setting('server_version_num')::integer >= 170000 then ',MAINTAIN'
      else '' end) as has_extra_privileges,
  has_any_column_privilege(r.role_name, 'public.training_notes',
    'SELECT,INSERT,UPDATE,REFERENCES') as has_column_access,
  exists (
    select 1 from pg_class c
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where c.oid = 'public.training_notes'::regclass and a.grantee = 0
    union all
    select 1 from pg_attribute col
    cross join lateral aclexplode(col.attacl) a
    where col.attrelid = 'public.training_notes'::regclass
      and col.attnum > 0 and not col.attisdropped and a.grantee = 0
  ) as public_has_grants,
  (select c.relrowsecurity from pg_class c
    where c.oid = 'public.training_notes'::regclass) as rls_enabled
from (values ('anon'::text), ('authenticated'::text), ('service_role'::text)) r(role_name);

create temporary table step5_note_permission_audit on commit drop as
select 'before'::text as phase, s.* from step5_note_permission_state s;

-- Stop if the existing server setup lacks CRUD permissions.
-- Repair of server grants is outside this client-permission change.
do $$
begin
  if exists (
    select 1 from step5_note_permission_audit
    where role_name = 'service_role'
      and not (can_select and can_insert and can_update and can_delete)
  ) then
    raise exception 'Existing server CRUD permissions are missing. No changes committed.';
  end if;
end;
$$;

-- REVOKE on the table also revokes its corresponding column privileges.
-- No CASCADE: do not revoke dependent grants on behalf of other roles.
revoke all privileges on table public.training_notes from public, anon, authenticated;
alter table public.training_notes enable row level security;

insert into step5_note_permission_audit
select 'after', s.* from step5_note_permission_state s;

-- Inherited permissions must not leave a direct client path open.
-- A failed check rolls back this entire transaction; do not modify other roles.
do $$
begin
  if exists (
    select 1 from step5_note_permission_audit
    where phase = 'after' and (
      not rls_enabled or public_has_grants
      or (role_name in ('anon', 'authenticated') and
        (can_select or can_insert or can_update or can_delete
          or has_extra_privileges or has_column_access))
      or (role_name = 'service_role' and
        not (can_select and can_insert and can_update and can_delete))
    )
  ) then
    raise exception 'Permission check failed. No changes committed. Review training_notes grants and role inheritance.';
  end if;
end;
$$;

-- Six result rows: before/after for each role. No note or account data.
-- AFTER: anon/authenticated access columns false; public_has_grants false;
--        service_role CRUD columns true; rls_enabled true for every row.
select * from step5_note_permission_audit
order by case phase when 'before' then 0 else 1 end, role_name;

drop view step5_note_permission_state;
commit;

-- This checks DB permissions, not deployed app behavior or judge results.
-- After execution, check A's own CRUD in the app, B's denial for A's note,
-- and a logged-out /api/notes request returning 401 without note data.
-- The original HTTPS resource path has no query string:
-- https://tdltpkfewovnxnxhvbkd.supabase.co/rest/v1/training_notes
-- A direct request with the public key must return no notes; a permission
-- error (401/403) is expected. An authenticated client is also denied.
