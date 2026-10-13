-- Run as one transaction in the existing LEARNING Supabase SQL Editor.
-- No existing training_notes rows, owners, policies or grants are changed.
begin;
create table if not exists public.training_resource_grants (
  issuer text not null,
  subject_id uuid not null,
  permission text not null check (permission = 'announcement_editor'),
  primary key (issuer, subject_id, permission)
);
create table if not exists public.training_announcements (
  id uuid primary key,
  title text not null check (char_length(title) between 1 and 160),
  content text not null check (char_length(content) between 1 and 10000),
  author_issuer text not null,
  author_id uuid not null,
  created_at timestamptz not null default now()
);
alter table public.training_resource_grants enable row level security;
alter table public.training_announcements enable row level security;
revoke all on public.training_resource_grants, public.training_announcements from public, anon, authenticated;
grant select on public.training_resource_grants to service_role;
grant select on public.training_announcements to service_role;

create or replace function public.write_training_announcement(
  p_issuer text, p_subject uuid, p_id uuid, p_title text, p_content text, p_create boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  result public.training_announcements%rowtype;
begin
  -- Lock the grant so concurrent revocation cannot race this mutation.
  perform 1 from public.training_resource_grants
    where issuer = p_issuer and subject_id = p_subject and permission = 'announcement_editor'
    for share;
  if not found then return jsonb_build_object('status', 'forbidden'); end if;
  if p_create then
    insert into public.training_announcements(id, title, content, author_issuer, author_id)
      values (p_id, p_title, p_content, p_issuer, p_subject)
      on conflict (id) do nothing returning * into result;
    if not found then return jsonb_build_object('status', 'conflict'); end if;
  else
    update public.training_announcements set title = p_title, content = p_content
      where id = p_id returning * into result;
    if not found then return jsonb_build_object('status', 'not_found'); end if;
  end if;
  return jsonb_build_object('status', 'written', 'id', result.id,
    'title', result.title, 'content', result.content);
end;
$$;
revoke all on function public.write_training_announcement(text, uuid, uuid, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.write_training_announcement(text, uuid, uuid, text, text, boolean) to service_role;
-- No automatic teacher grants, fixture accounts or fictional notice bodies.
-- An administrator grants an existing instructor account in this same DB:
-- training_resource_grants: issuer = verified Auth issuer,
-- subject_id = that account's UUID, permission = announcement_editor.
-- Never use a browser-provided role, user_metadata, or the judge A/B label.
commit;
