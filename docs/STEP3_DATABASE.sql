-- Run once in the learning project's Supabase SQL Editor.
-- Preserve the existing table, notes, owners, and RLS settings.
begin;
alter table public.training_notes enable row level security;
revoke all privileges on table public.training_notes from public, anon, authenticated;
grant select, insert, update, delete on table public.training_notes to service_role;
commit;

-- Expected: all true for server permissions and browser permissions blocked.
select
  has_table_privilege('service_role', 'public.training_notes', 'SELECT') as server_read,
  has_table_privilege('service_role', 'public.training_notes', 'INSERT') as server_add,
  has_table_privilege('service_role', 'public.training_notes', 'UPDATE') as server_edit,
  has_table_privilege('service_role', 'public.training_notes', 'DELETE') as server_delete,
  not has_table_privilege('anon', 'public.training_notes', 'SELECT,INSERT,UPDATE,DELETE') as anonymous_blocked,
  not has_table_privilege('authenticated', 'public.training_notes', 'SELECT,INSERT,UPDATE,DELETE') as browser_blocked;
