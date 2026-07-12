-- CTP | Multi-client access migration | run once

-- 1. Join table
create table public.profile_clients (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, client_id)
);

alter table public.profile_clients enable row level security;

create policy "internal manage profile_clients" on public.profile_clients
  for all to authenticated
  using (public.is_internal()) with check (public.is_internal());

create policy "read own profile_clients" on public.profile_clients
  for select to authenticated
  using (profile_id = auth.uid());

-- 2. Helper: all clients this profile can access
create or replace function public.my_client_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select client_id from profile_clients where profile_id = auth.uid();
$$;

-- 3. Switching: clients may update ONLY their own client_id, and only
--    to a client they are linked to in profile_clients.
--    (The existing "own language update" policy already allows self-update;
--    this trigger constrains WHICH values are legal.)
create or replace function public.enforce_client_switch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- internal users unrestricted
  if public.is_internal() then return new; end if;

  -- clients may not change role or their profile_clients links via this path
  if new.role is distinct from old.role then
    raise exception 'role change not permitted';
  end if;

  -- if client_id is changing, it must be one of their linked clients
  if new.client_id is distinct from old.client_id then
    if new.client_id is null
       or not exists (
         select 1 from profile_clients
         where profile_id = auth.uid() and client_id = new.client_id
       ) then
      raise exception 'not linked to that client';
    end if;
  end if;

  return new;
end; $$;

drop trigger if exists on_profile_client_switch on public.profiles;
create trigger on_profile_client_switch
  before update on public.profiles
  for each row execute function public.enforce_client_switch();

-- 4. Backfill: every existing profile with a client_id gets a row
insert into public.profile_clients (profile_id, client_id)
select id, client_id from public.profiles where client_id is not null
on conflict do nothing;
