-- Run this entire file once in the existing LEARNING Supabase SQL Editor.
-- Adds private backups and append-only recovery audit. Existing notes, RLS,
-- grants, other services, and audit records are preserved. No fixture data.
begin;

create table if not exists public.training_note_recovery_backups (
  note_id uuid primary key,
  owner_id uuid not null,
  run_id uuid not null,
  title text not null check (char_length(title) between 1 and 160),
  content text not null check (char_length(content) between 1 and 10000),
  position integer not null,
  note_created_at timestamptz not null,
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  backed_up_at timestamptz not null default now()
);
create table if not exists public.training_note_recovery_audit (
  event_id bigint generated always as identity primary key,
  note_id uuid not null,
  owner_id uuid not null,
  run_id uuid not null,
  phase text not null check (phase in ('backup_verified', 'note_restored')),
  content_sha256 text not null,
  occurred_at timestamptz not null default now()
);
alter table public.training_note_recovery_backups enable row level security;
alter table public.training_note_recovery_audit enable row level security;
revoke all on public.training_note_recovery_backups, public.training_note_recovery_audit
  from public, anon, authenticated, service_role;
revoke all on sequence public.training_note_recovery_audit_event_id_seq
  from public, anon, authenticated, service_role;

-- SHA-256 of UTF-8 title, one zero byte, UTF-8 content. Neither text may contain
-- a zero character in PostgreSQL, so the separator is unambiguous.
create or replace function public.create_training_note_with_backup(
  p_id uuid, p_owner uuid, p_run uuid, p_title text, p_content text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  note public.training_notes%rowtype;
  saved public.training_note_recovery_backups%rowtype;
  fingerprint text;
begin
  if p_id is null or p_owner is null or p_run is null
    or p_title is null or p_content is null
    or char_length(p_title) not between 1 and 160
    or char_length(p_content) not between 1 and 10000 then
    return jsonb_build_object('status', 'invalid');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text, 0));
  -- A repeated create must never replace the pre-damage backup.
  if exists(select 1 from public.training_note_recovery_backups where note_id = p_id)
    or exists(select 1 from public.training_notes where id = p_id) then
    return jsonb_build_object('status', 'conflict');
  end if;
  insert into public.training_notes(id, owner_id, title, content, position)
    values(p_id, p_owner, p_title, p_content, 0) returning * into note;
  fingerprint := encode(sha256(convert_to(note.title, 'UTF8') || decode('00', 'hex')
    || convert_to(note.content, 'UTF8')), 'hex');
  insert into public.training_note_recovery_backups
    (note_id, owner_id, run_id, title, content, position, note_created_at, content_sha256)
    values(note.id, note.owner_id, p_run, note.title, note.content, note.position,
      note.created_at, fingerprint);
  select * into saved from public.training_note_recovery_backups where note_id = p_id;
  if saved.note_id <> note.id or saved.owner_id <> note.owner_id
    or saved.content_sha256 <> encode(sha256(convert_to(saved.title, 'UTF8')
      || decode('00', 'hex') || convert_to(saved.content, 'UTF8')), 'hex') then
    raise exception 'Recovery backup validation failed';
  end if;
  insert into public.training_note_recovery_audit(note_id, owner_id, run_id, phase, content_sha256)
    values(p_id, p_owner, p_run, 'backup_verified', fingerprint);
  return jsonb_build_object('status', 'created', 'id', p_id, 'owner_id', p_owner,
    'run_id', p_run, 'content_sha256', fingerprint);
end;
$$;

create or replace function public.inspect_training_note_backup(p_id uuid, p_owner uuid, p_run uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare saved public.training_note_recovery_backups%rowtype;
begin
  select * into saved from public.training_note_recovery_backups
    where note_id = p_id and owner_id = p_owner and run_id = p_run;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if saved.content_sha256 <> encode(sha256(convert_to(saved.title, 'UTF8')
    || decode('00', 'hex') || convert_to(saved.content, 'UTF8')), 'hex') then
    return jsonb_build_object('status', 'invalid_backup');
  end if;
  return jsonb_build_object('status', 'verified', 'id', saved.note_id,
    'owner_id', saved.owner_id, 'run_id', saved.run_id, 'content_sha256', saved.content_sha256);
end;
$$;

create or replace function public.restore_training_note(
  p_id uuid, p_owner uuid, p_run uuid, p_expected_sha256 text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  saved public.training_note_recovery_backups%rowtype;
  note public.training_notes%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text, 0));
  select * into saved from public.training_note_recovery_backups
    where note_id = p_id and owner_id = p_owner and run_id = p_run for share;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if p_expected_sha256 is null or saved.content_sha256 <> p_expected_sha256
    or saved.content_sha256 <> encode(sha256(convert_to(saved.title, 'UTF8')
      || decode('00', 'hex') || convert_to(saved.content, 'UTF8')), 'hex') then
    return jsonb_build_object('status', 'invalid_backup');
  end if;
  -- A reused ID belonging to another owner must not be overwritten.
  insert into public.training_notes(id, owner_id, title, content, position, created_at)
    values(saved.note_id, saved.owner_id, saved.title, saved.content, saved.position, saved.note_created_at)
    on conflict(id) do update set title = excluded.title, content = excluded.content,
      position = excluded.position, created_at = excluded.created_at
    where training_notes.owner_id = excluded.owner_id returning * into note;
  if not found then return jsonb_build_object('status', 'owner_conflict'); end if;
  if note.id <> saved.note_id or note.owner_id <> saved.owner_id
    or encode(sha256(convert_to(note.title, 'UTF8') || decode('00', 'hex')
      || convert_to(note.content, 'UTF8')), 'hex') <> saved.content_sha256 then
    raise exception 'Restored note validation failed';
  end if;
  insert into public.training_note_recovery_audit(note_id, owner_id, run_id, phase, content_sha256)
    values(p_id, p_owner, p_run, 'note_restored', saved.content_sha256);
  return jsonb_build_object('status', 'restored', 'id', note.id, 'owner_id', note.owner_id,
    'run_id', p_run, 'content_sha256', saved.content_sha256);
end;
$$;
revoke all on function public.create_training_note_with_backup(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.inspect_training_note_backup(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.restore_training_note(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.create_training_note_with_backup(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.inspect_training_note_backup(uuid, uuid, uuid) to service_role;
grant execute on function public.restore_training_note(uuid, uuid, uuid, text) to service_role;
commit;

-- Metadata-only setup check. Both true; no notes or backup contents returned.
select
  has_function_privilege('service_role', 'public.restore_training_note(uuid,uuid,uuid,text)', 'EXECUTE') as server_restore,
  not has_table_privilege('anon', 'public.training_note_recovery_backups', 'SELECT') as private_backup;
