-- Apply once in the same LEARNING Supabase SQL Editor. No previous rows or policies are replaced.
begin;
create table if not exists public.training_devices (
  id text primary key check (id ~ '^[A-Za-z0-9_-]+$' and length(id) between 1 and 2048),
  owner_key text not null check (owner_key ~ '^[a-f0-9]{64}$'),
  public_key text not null check (public_key ~ '^[A-Za-z0-9_-]+$' and length(public_key) between 1 and 4096),
  counter bigint not null check (counter between 0 and 4294967295),
  state text not null default 'pending' check (state in ('pending', 'approved', 'revoked')),
  created_at timestamptz not null default now()
);
create table if not exists public.training_device_challenges (
  id uuid primary key,
  owner_key text not null check (owner_key ~ '^[a-f0-9]{64}$'),
  token_sha256 text not null check (token_sha256 ~ '^[a-f0-9]{64}$'),
  challenge text not null unique check (challenge ~ '^[A-Za-z0-9_-]{32,200}$'),
  kind text not null check (kind in ('registration', 'status', 'request')),
  method text, path text, body_sha256 text,
  expires_at timestamptz not null default (now() + interval '2 minutes'),
  used boolean not null default false,
  check ((kind = 'request' and method in ('GET','POST','PUT','DELETE') and path like '/api/%'
    and body_sha256 ~ '^[a-f0-9]{64}$') or (kind != 'request' and method is null and path is null and body_sha256 is null))
);
create table if not exists public.training_device_audit (
  sequence bigint generated always as identity primary key,
  credential_fingerprint text not null, owner_key text not null,
  event text not null, at timestamptz not null default now()
);
alter table public.training_devices enable row level security;
alter table public.training_device_challenges enable row level security;
alter table public.training_device_audit enable row level security;
revoke all on public.training_devices, public.training_device_challenges, public.training_device_audit
  from public, anon, authenticated, service_role;
grant select on public.training_devices, public.training_device_challenges to service_role;

create or replace function public.issue_training_device_challenge(p_record jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  -- Serialize issue/register on the account; cap concurrent unexpired prompts.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_record->>'owner_key', 11));
  select count(*) into n from public.training_device_challenges
    where owner_key = p_record->>'owner_key' and not used and expires_at > now();
  if n >= 12 then raise exception 'device_challenge_limit'; end if;
  insert into public.training_device_challenges(id, owner_key, token_sha256, challenge, kind, method, path, body_sha256)
    values ((p_record->>'id')::uuid, p_record->>'owner_key', p_record->>'token_sha256', p_record->>'challenge',
      p_record->>'kind', p_record->>'method', p_record->>'path', p_record->>'body_sha256');
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.register_training_device(p_record jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.training_device_challenges%rowtype; n integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_record->>'owner_key', 11));
  select * into c from public.training_device_challenges
    where id = (p_record->>'challenge_id')::uuid for update;
  if not found or c.used or c.expires_at <= now() or c.kind != 'registration'
    or c.owner_key is distinct from p_record->>'owner_key' or c.token_sha256 is distinct from p_record->>'token_sha256'
    then return jsonb_build_object('ok', false); end if;
  select count(*) into n from public.training_devices where owner_key = c.owner_key;
  if n >= 20 or exists(select 1 from public.training_devices where id = p_record->>'credential_id')
    then return jsonb_build_object('ok', false); end if;
  insert into public.training_devices(id, owner_key, public_key, counter)
    values(p_record->>'credential_id', c.owner_key, p_record->>'public_key', (p_record->>'counter')::bigint);
  update public.training_device_challenges set used = true where id = c.id;
  insert into public.training_device_audit(credential_fingerprint, owner_key, event)
    values(encode(sha256(convert_to(p_record->>'credential_id','UTF8')),'hex'), c.owner_key, 'registration_pending');
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.consume_training_device_challenge(p_record jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.training_device_challenges%rowtype; d public.training_devices%rowtype; new_counter bigint;
begin
  select * into c from public.training_device_challenges
    where id = (p_record->>'challenge_id')::uuid for update;
  if not found or c.used or c.expires_at <= now() or c.kind not in ('status','request')
    or c.kind is distinct from p_record->>'kind' or c.owner_key is distinct from p_record->>'owner_key'
    or c.token_sha256 is distinct from p_record->>'token_sha256' then return jsonb_build_object('ok', false); end if;
  select * into d from public.training_devices where id = p_record->>'credential_id' for update;
  if not found or d.owner_key is distinct from c.owner_key or d.counter is distinct from (p_record->>'old_counter')::bigint
    or (c.kind = 'request' and d.state != 'approved') then return jsonb_build_object('ok', false); end if;
  new_counter := (p_record->>'new_counter')::bigint;
  if new_counter is null or new_counter < 0 or (new_counter != 0 or d.counter != 0) and new_counter <= d.counter
    then return jsonb_build_object('ok', false); end if;
  update public.training_devices set counter = new_counter where id = d.id;
  update public.training_device_challenges set used = true where id = c.id;
  return jsonb_build_object('ok', true, 'state', d.state);
end;
$$;

-- Approval/revocation is an operator SQL Editor action. Not callable by any app role.
-- Supply the credential fingerprint shown in the app, after checking the intended device with its user.
create or replace function public.decide_training_device(p_fingerprint text, p_state text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.training_devices%rowtype;
begin
  if p_state not in ('approved','revoked') or p_fingerprint !~ '^[a-f0-9]{16}$'
    then raise exception 'invalid_device_decision'; end if;
  select * into d from public.training_devices
    where left(encode(sha256(convert_to(id,'UTF8')),'hex'),16) = p_fingerprint for update;
  if not found then return jsonb_build_object('ok', false); end if;
  if (select count(*) from public.training_devices
      where left(encode(sha256(convert_to(id,'UTF8')),'hex'),16) = p_fingerprint) != 1
    then raise exception 'ambiguous_device'; end if;
  if d.state = 'revoked' and p_state = 'approved' then raise exception 'register_new_device'; end if;
  update public.training_devices set state = p_state where id = d.id;
  insert into public.training_device_audit(credential_fingerprint, owner_key, event)
    values(encode(sha256(convert_to(d.id,'UTF8')),'hex'), d.owner_key, p_state);
  return jsonb_build_object('ok', true, 'state', p_state);
end;
$$;

revoke all on function public.issue_training_device_challenge(jsonb), public.register_training_device(jsonb),
  public.consume_training_device_challenge(jsonb), public.decide_training_device(text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.issue_training_device_challenge(jsonb), public.register_training_device(jsonb),
  public.consume_training_device_challenge(jsonb) to service_role;
-- Existing note, announcement, recovery and audit data stay intact.
commit;
