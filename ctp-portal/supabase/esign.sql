-- ============================================================
-- CLEAR TECH PARTNER — E-SIGNATURE SCHEMA (CTP-SPEC-0002)
-- Run this entire file in: Supabase Dashboard > SQL Editor > New query
-- Requires the base portal schema (schema.sql) to be in place.
-- Safe to run once on a project that already has the base schema.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- TABLES ----------

create table public.envelopes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  language text not null default 'en' check (language in ('en','es')),
  status text not null default 'draft' check (status in ('draft','sent','viewed','signed','completed','declined','voided')),
  client_id uuid references public.clients(id) on delete set null,
  signing_mode text not null default 'sequential' check (signing_mode in ('sequential','parallel')),
  message text,
  source_path text,
  sealed_path text,
  certificate_path text,
  source_hash text,
  sealed_hash text,
  -- PDF bytes kept in-row so the tokenised signer path can read and seal
  -- without portal auth or the service role key (see esign_* functions).
  source_pdf bytea,
  sealed_pdf bytea,
  certificate_pdf bytea,
  void_reason text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  completed_at timestamptz,
  voided_at timestamptz
);

create table public.envelope_signers (
  id uuid primary key default gen_random_uuid(),
  envelope_id uuid not null references public.envelopes(id) on delete cascade,
  name text not null,
  email text not null,
  sign_order int not null default 1,
  status text not null default 'pending' check (status in ('pending','sent','viewed','consented','signed','declined')),
  token text unique,
  token_expires_at timestamptz,
  disclosure_id uuid,
  signature_kind text check (signature_kind in ('drawn','typed')),
  signature_data text,
  decline_reason text,
  ip text,
  user_agent text,
  sent_at timestamptz,
  viewed_at timestamptz,
  consented_at timestamptz,
  signed_at timestamptz,
  declined_at timestamptz,
  created_at timestamptz not null default now()
);

create index envelope_signers_envelope_idx on public.envelope_signers(envelope_id);
create index envelope_signers_token_idx on public.envelope_signers(token);

create table public.envelope_fields (
  id uuid primary key default gen_random_uuid(),
  envelope_id uuid not null references public.envelopes(id) on delete cascade,
  signer_id uuid not null references public.envelope_signers(id) on delete cascade,
  type text not null check (type in ('signature','initials','date','text','checkbox')),
  page int not null default 1 check (page >= 1),
  x numeric(9,6) not null check (x >= 0 and x <= 1),
  y numeric(9,6) not null check (y >= 0 and y <= 1),
  w numeric(9,6) not null check (w > 0 and w <= 1),
  h numeric(9,6) not null check (h > 0 and h <= 1),
  required boolean not null default true,
  label text,
  value text,
  created_at timestamptz not null default now()
);

create index envelope_fields_envelope_idx on public.envelope_fields(envelope_id);

create table public.envelope_events (
  id bigint generated always as identity primary key,
  envelope_id uuid not null references public.envelopes(id) on delete cascade,
  event_type text not null,
  actor text,
  ip text,
  user_agent text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index envelope_events_envelope_idx on public.envelope_events(envelope_id);

create table public.envelope_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  language text not null default 'en' check (language in ('en','es')),
  category text not null default 'proposal' check (category in ('proposal','contract')),
  source_ref text not null,
  field_layout jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table public.envelope_disclosures (
  id uuid primary key default gen_random_uuid(),
  language text not null check (language in ('en','es')),
  version int not null default 1,
  text text not null,
  created_at timestamptz not null default now(),
  unique (language, version)
);

-- ---------- APPEND-ONLY GUARD ON THE AUDIT TRAIL ----------
-- envelope_events is the legal audit trail. Update and delete are blocked
-- at the database level for every role, including table owner paths.

create or replace function public.esign_events_block_mod() returns trigger
language plpgsql as $$
begin
  raise exception 'envelope_events is append-only';
end; $$;

create trigger envelope_events_no_update
  before update on public.envelope_events
  for each row execute function public.esign_events_block_mod();

create trigger envelope_events_no_delete
  before delete on public.envelope_events
  for each row execute function public.esign_events_block_mod();

revoke update, delete on public.envelope_events from anon, authenticated;

-- ---------- ROW LEVEL SECURITY ----------
-- Internal-only on every table. Signers never touch tables directly;
-- they go through the token-validated esign_signer_* functions below.

alter table public.envelopes enable row level security;
alter table public.envelope_signers enable row level security;
alter table public.envelope_fields enable row level security;
alter table public.envelope_events enable row level security;
alter table public.envelope_templates enable row level security;
alter table public.envelope_disclosures enable row level security;

create policy "internal all envelopes" on public.envelopes for all to authenticated
  using (public.is_internal()) with check (public.is_internal());
create policy "internal all envelope signers" on public.envelope_signers for all to authenticated
  using (public.is_internal()) with check (public.is_internal());
create policy "internal all envelope fields" on public.envelope_fields for all to authenticated
  using (public.is_internal()) with check (public.is_internal());
create policy "internal read envelope events" on public.envelope_events for select to authenticated
  using (public.is_internal());
create policy "internal insert envelope events" on public.envelope_events for insert to authenticated
  with check (public.is_internal());
create policy "internal all envelope templates" on public.envelope_templates for all to authenticated
  using (public.is_internal()) with check (public.is_internal());
create policy "internal read disclosures" on public.envelope_disclosures for select to authenticated
  using (public.is_internal());
create policy "internal insert disclosures" on public.envelope_disclosures for insert to authenticated
  with check (public.is_internal());

-- ---------- STORAGE ----------
-- Private bucket for source, sealed and certificate PDFs.
-- Access is internal-only, always via signed expiring URLs.

insert into storage.buckets (id, name, public)
values ('esign','esign', false)
on conflict (id) do nothing;

create policy "internal all esign objects" on storage.objects for all to authenticated
  using (bucket_id = 'esign' and public.is_internal())
  with check (bucket_id = 'esign' and public.is_internal());

-- ---------- INTERNAL HELPER FUNCTIONS (portal JWT, is_internal gated) ----------

-- Store the source PDF bytes and compute the SHA-256 in one place.
create or replace function public.esign_put_source(p_envelope_id uuid, p_b64 text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_bytes bytea;
  v_hash text;
begin
  if not public.is_internal() then
    raise exception 'Internal access only';
  end if;
  v_bytes := decode(p_b64, 'base64');
  v_hash := encode(digest(v_bytes, 'sha256'), 'hex');
  update envelopes
     set source_pdf = v_bytes, source_hash = v_hash
   where id = p_envelope_id;
  if not found then
    raise exception 'Envelope not found';
  end if;
  return jsonb_build_object('source_hash', v_hash);
end; $$;

-- Fetch stored PDF bytes as base64 for internal download / storage mirror.
create or replace function public.esign_get_pdf(p_envelope_id uuid, p_kind text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_out text;
begin
  if not public.is_internal() then
    raise exception 'Internal access only';
  end if;
  select encode(
    case p_kind
      when 'source' then source_pdf
      when 'sealed' then sealed_pdf
      when 'certificate' then certificate_pdf
    end, 'base64')
  into v_out
  from envelopes where id = p_envelope_id;
  return v_out;
end; $$;

-- ---------- SIGNER FUNCTIONS (token validated, no portal auth) ----------
-- These are the only paths an external signer can take. Each one validates
-- the signer token, so the anon key alone grants nothing.

-- Resolve and validate a token. Raises on unknown or expired tokens.
create or replace function public.esign_resolve_token(p_token text)
returns table (signer_id uuid, envelope_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_signer envelope_signers%rowtype;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'Invalid link';
  end if;
  select * into v_signer from envelope_signers where token = p_token;
  if not found then
    raise exception 'Invalid link';
  end if;
  if v_signer.token_expires_at is not null and v_signer.token_expires_at < now() then
    raise exception 'This signing link has expired';
  end if;
  return query select v_signer.id, v_signer.envelope_id;
end; $$;

-- True when it is this signer's turn (sequential mode waits for earlier signers).
create or replace function public.esign_is_turn(p_signer_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when e.signing_mode = 'parallel' then true
    else not exists (
      select 1 from envelope_signers s2
      where s2.envelope_id = s.envelope_id
        and s2.sign_order < s.sign_order
        and s2.status <> 'signed'
    )
  end
  from envelope_signers s
  join envelopes e on e.id = s.envelope_id
  where s.id = p_signer_id;
$$;

-- Everything the signer screen needs, in one call.
create or replace function public.esign_signer_load(p_token text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_signer_id uuid;
  v_envelope_id uuid;
  v_signer envelope_signers%rowtype;
  v_env envelopes%rowtype;
  v_disclosure jsonb;
  v_fields jsonb;
  v_signers jsonb;
begin
  select r.signer_id, r.envelope_id into v_signer_id, v_envelope_id
  from esign_resolve_token(p_token) r;

  select * into v_signer from envelope_signers where id = v_signer_id;
  select * into v_env from envelopes where id = v_envelope_id;

  -- Disclosure: the version recorded at consent, else the latest for the language.
  if v_signer.disclosure_id is not null then
    select jsonb_build_object('id', d.id, 'version', d.version, 'text', d.text)
      into v_disclosure from envelope_disclosures d where d.id = v_signer.disclosure_id;
  else
    select jsonb_build_object('id', d.id, 'version', d.version, 'text', d.text)
      into v_disclosure from envelope_disclosures d
     where d.language = v_env.language
     order by d.version desc limit 1;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', f.id, 'signer_id', f.signer_id, 'type', f.type, 'page', f.page,
      'x', f.x, 'y', f.y, 'w', f.w, 'h', f.h,
      'required', f.required, 'label', f.label, 'value', f.value,
      'mine', f.signer_id = v_signer_id
    ) order by f.page, f.y, f.x), '[]'::jsonb)
    into v_fields
    from envelope_fields f where f.envelope_id = v_envelope_id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name, 'sign_order', s.sign_order, 'status', s.status,
      'signature_data', case when s.status = 'signed' then s.signature_data end,
      'signed_at', s.signed_at
    ) order by s.sign_order), '[]'::jsonb)
    into v_signers
    from envelope_signers s where s.envelope_id = v_envelope_id;

  return jsonb_build_object(
    'envelope', jsonb_build_object(
      'id', v_env.id, 'name', v_env.name, 'language', v_env.language,
      'status', v_env.status, 'signing_mode', v_env.signing_mode,
      'message', v_env.message, 'source_hash', v_env.source_hash
    ),
    'signer', jsonb_build_object(
      'id', v_signer.id, 'name', v_signer.name, 'email', v_signer.email,
      'status', v_signer.status, 'sign_order', v_signer.sign_order,
      'consented_at', v_signer.consented_at
    ),
    'my_turn', esign_is_turn(v_signer_id),
    'disclosure', v_disclosure,
    'fields', v_fields,
    'signers', v_signers,
    'source_pdf', case
      when v_env.status in ('sent','viewed','signed') then encode(v_env.source_pdf, 'base64')
    end
  );
end; $$;

-- Record a signer event: 'viewed' or 'consented'. IP and user agent are
-- supplied by the Netlify function from request headers, not by the browser.
create or replace function public.esign_signer_event(
  p_token text, p_event_type text, p_ip text, p_ua text, p_metadata jsonb default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_signer_id uuid;
  v_envelope_id uuid;
  v_signer envelope_signers%rowtype;
  v_env envelopes%rowtype;
  v_disclosure_id uuid;
  v_disclosure_version int;
  v_meta jsonb;
begin
  select r.signer_id, r.envelope_id into v_signer_id, v_envelope_id
  from esign_resolve_token(p_token) r;
  select * into v_signer from envelope_signers where id = v_signer_id;
  select * into v_env from envelopes where id = v_envelope_id;

  if p_event_type not in ('viewed','consented') then
    raise exception 'Unsupported event type';
  end if;
  if v_env.status not in ('sent','viewed','signed') then
    raise exception 'This document is no longer open for signing';
  end if;
  if v_signer.status in ('signed','declined') then
    raise exception 'This document has already been completed by you';
  end if;

  v_meta := coalesce(p_metadata, '{}'::jsonb);

  if p_event_type = 'viewed' then
    update envelope_signers
       set status = case when status = 'sent' then 'viewed' else status end,
           viewed_at = coalesce(viewed_at, now())
     where id = v_signer_id;
    if v_env.status = 'sent' then
      update envelopes set status = 'viewed' where id = v_envelope_id;
    end if;
  end if;

  if p_event_type = 'consented' then
    select d.id, d.version into v_disclosure_id, v_disclosure_version
      from envelope_disclosures d
     where d.language = v_env.language
     order by d.version desc limit 1;
    if v_disclosure_id is null then
      raise exception 'No disclosure configured for language %', v_env.language;
    end if;
    update envelope_signers
       set status = 'consented',
           consented_at = now(),
           disclosure_id = v_disclosure_id
     where id = v_signer_id;
    v_meta := v_meta || jsonb_build_object('disclosure_version', v_disclosure_version, 'language', v_env.language);
  end if;

  insert into envelope_events (envelope_id, event_type, actor, ip, user_agent, metadata)
  values (v_envelope_id, p_event_type, v_signer.email, p_ip, p_ua, v_meta);

  return jsonb_build_object('ok', true);
end; $$;

-- Decline. Terminal for the envelope.
create or replace function public.esign_signer_decline(
  p_token text, p_reason text, p_ip text, p_ua text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_signer_id uuid;
  v_envelope_id uuid;
  v_signer envelope_signers%rowtype;
  v_env envelopes%rowtype;
begin
  select r.signer_id, r.envelope_id into v_signer_id, v_envelope_id
  from esign_resolve_token(p_token) r;
  select * into v_signer from envelope_signers where id = v_signer_id;
  select * into v_env from envelopes where id = v_envelope_id;

  if v_env.status not in ('sent','viewed','signed') then
    raise exception 'This document is no longer open for signing';
  end if;
  if v_signer.status in ('signed','declined') then
    raise exception 'Already completed';
  end if;

  update envelope_signers
     set status = 'declined', declined_at = now(), decline_reason = p_reason,
         ip = p_ip, user_agent = p_ua
   where id = v_signer_id;
  update envelopes set status = 'declined' where id = v_envelope_id;

  insert into envelope_events (envelope_id, event_type, actor, ip, user_agent, metadata)
  values (v_envelope_id, 'declined', v_signer.email, p_ip, p_ua,
          jsonb_build_object('reason', p_reason));

  return jsonb_build_object('ok', true, 'envelope_name', v_env.name);
end; $$;

-- Finish: save field values, adopt the signature, mark the signer signed.
-- Returns what the serverless sealer needs to know next.
create or replace function public.esign_signer_finish(
  p_token text, p_values jsonb, p_signature_data text, p_signature_kind text,
  p_ip text, p_ua text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_signer_id uuid;
  v_envelope_id uuid;
  v_signer envelope_signers%rowtype;
  v_env envelopes%rowtype;
  v_field record;
  v_val text;
  v_missing int := 0;
  v_all_signed boolean;
  v_next jsonb;
begin
  select r.signer_id, r.envelope_id into v_signer_id, v_envelope_id
  from esign_resolve_token(p_token) r;
  select * into v_signer from envelope_signers where id = v_signer_id;
  select * into v_env from envelopes where id = v_envelope_id;

  if v_env.status not in ('sent','viewed','signed') then
    raise exception 'This document is no longer open for signing';
  end if;
  if v_signer.status in ('signed','declined') then
    raise exception 'Already completed';
  end if;
  if v_signer.consented_at is null then
    raise exception 'Consent to electronic records is required before signing';
  end if;
  if not esign_is_turn(v_signer_id) then
    raise exception 'It is not your turn to sign yet';
  end if;
  if p_signature_kind not in ('drawn','typed') then
    raise exception 'Invalid signature kind';
  end if;
  if p_signature_data is null or p_signature_data !~ '^data:image/png;base64,' then
    raise exception 'Invalid signature data';
  end if;

  -- Write submitted values into this signer's fields; enforce required.
  for v_field in
    select * from envelope_fields
    where envelope_id = v_envelope_id and signer_id = v_signer_id
  loop
    v_val := p_values ->> (v_field.id::text);
    if v_field.type in ('signature','initials') then
      -- Signature and initials render from the adopted signature; value marks completion.
      v_val := coalesce(v_val, 'signed');
    end if;
    if v_field.required and (v_val is null or v_val = '' or (v_field.type = 'checkbox' and v_val <> 'true')) then
      v_missing := v_missing + 1;
    else
      update envelope_fields set value = v_val where id = v_field.id;
    end if;
  end loop;
  if v_missing > 0 then
    raise exception 'Required fields are missing (%)', v_missing;
  end if;

  update envelope_signers
     set status = 'signed', signed_at = now(),
         signature_kind = p_signature_kind, signature_data = p_signature_data,
         ip = p_ip, user_agent = p_ua
   where id = v_signer_id;

  insert into envelope_events (envelope_id, event_type, actor, ip, user_agent, metadata)
  values (v_envelope_id, 'signed', v_signer.email, p_ip, p_ua,
          jsonb_build_object('signature_kind', p_signature_kind, 'sign_order', v_signer.sign_order));

  select not exists (
    select 1 from envelope_signers where envelope_id = v_envelope_id and status <> 'signed'
  ) into v_all_signed;

  if v_all_signed then
    update envelopes set status = 'signed' where id = v_envelope_id;
    v_next := null;
  else
    select jsonb_build_object('id', s.id, 'name', s.name, 'email', s.email, 'token', s.token)
      into v_next
      from envelope_signers s
     where s.envelope_id = v_envelope_id and s.status <> 'signed'
       and (v_env.signing_mode = 'parallel' or esign_is_turn(s.id))
       and s.sent_at is null
     order by s.sign_order limit 1;
  end if;

  return jsonb_build_object(
    'ok', true,
    'all_signed', v_all_signed,
    'next_signer', v_next,
    'envelope', jsonb_build_object('id', v_env.id, 'name', v_env.name, 'language', v_env.language)
  );
end; $$;

-- Everything the sealer needs to build the sealed PDF and the certificate.
-- Only available once every signer has signed.
create or replace function public.esign_seal_data(p_token text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_signer_id uuid;
  v_envelope_id uuid;
  v_env envelopes%rowtype;
begin
  select r.signer_id, r.envelope_id into v_signer_id, v_envelope_id
  from esign_resolve_token(p_token) r;
  select * into v_env from envelopes where id = v_envelope_id;

  if v_env.status not in ('signed','completed') then
    raise exception 'Envelope is not fully signed yet';
  end if;

  return jsonb_build_object(
    'envelope', jsonb_build_object(
      'id', v_env.id, 'name', v_env.name, 'language', v_env.language,
      'status', v_env.status, 'source_hash', v_env.source_hash,
      'sent_at', v_env.sent_at, 'completed_at', v_env.completed_at,
      'client_id', v_env.client_id
    ),
    'source_pdf', encode(v_env.source_pdf, 'base64'),
    'signers', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'name', s.name, 'email', s.email, 'sign_order', s.sign_order,
        'status', s.status, 'signature_kind', s.signature_kind, 'signature_data', s.signature_data,
        'consented_at', s.consented_at, 'signed_at', s.signed_at,
        'ip', s.ip, 'user_agent', s.user_agent,
        'disclosure_version', (select d.version from envelope_disclosures d where d.id = s.disclosure_id)
      ) order by s.sign_order), '[]'::jsonb)
      from envelope_signers s where s.envelope_id = v_envelope_id
    ),
    'fields', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', f.id, 'signer_id', f.signer_id, 'type', f.type, 'page', f.page,
        'x', f.x, 'y', f.y, 'w', f.w, 'h', f.h, 'value', f.value, 'label', f.label
      ) order by f.page, f.y), '[]'::jsonb)
      from envelope_fields f where f.envelope_id = v_envelope_id
    )
  );
end; $$;

-- Store the sealed PDF and the certificate; computes the sealed hash in-db
-- and closes the envelope. Idempotent per envelope: refuses a second seal.
create or replace function public.esign_store_sealed(
  p_token text, p_sealed_b64 text, p_cert_b64 text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_signer_id uuid;
  v_envelope_id uuid;
  v_env envelopes%rowtype;
  v_sealed bytea;
  v_cert bytea;
  v_hash text;
begin
  select r.signer_id, r.envelope_id into v_signer_id, v_envelope_id
  from esign_resolve_token(p_token) r;
  select * into v_env from envelopes where id = v_envelope_id;

  if v_env.status <> 'signed' then
    raise exception 'Envelope is not ready to seal (status %)', v_env.status;
  end if;

  v_sealed := decode(p_sealed_b64, 'base64');
  v_cert := decode(p_cert_b64, 'base64');
  v_hash := encode(digest(v_sealed, 'sha256'), 'hex');

  update envelopes
     set sealed_pdf = v_sealed,
         certificate_pdf = v_cert,
         sealed_hash = v_hash,
         status = 'completed',
         completed_at = now()
   where id = v_envelope_id;

  insert into envelope_events (envelope_id, event_type, actor, metadata)
  values (v_envelope_id, 'completed', 'system',
          jsonb_build_object('sealed_hash', v_hash, 'source_hash', v_env.source_hash));

  return jsonb_build_object('ok', true, 'sealed_hash', v_hash);
end; $$;

-- Mark a signer's link as sent (called by the send function when a
-- sequential follow-up email goes out).
create or replace function public.esign_mark_sent(p_token text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_signer_id uuid;
  v_envelope_id uuid;
begin
  select r.signer_id, r.envelope_id into v_signer_id, v_envelope_id
  from esign_resolve_token(p_token) r;
  update envelope_signers
     set status = case when status = 'pending' then 'sent' else status end,
         sent_at = coalesce(sent_at, now())
   where id = v_signer_id;
  insert into envelope_events (envelope_id, event_type, actor, metadata)
  values (v_envelope_id, 'sent', 'system',
          (select jsonb_build_object('signer', s.email, 'sign_order', s.sign_order)
             from envelope_signers s where s.id = v_signer_id));
  return jsonb_build_object('ok', true);
end; $$;

-- Function execute grants: token functions are callable by anon (the token
-- is the credential); internal helpers stay locked to signed-in users.
revoke all on function public.esign_resolve_token(text) from public, anon, authenticated;
revoke all on function public.esign_is_turn(uuid) from public, anon, authenticated;
revoke all on function public.esign_events_block_mod() from public, anon, authenticated;

revoke all on function public.esign_put_source(uuid, text) from public, anon;
grant execute on function public.esign_put_source(uuid, text) to authenticated;
revoke all on function public.esign_get_pdf(uuid, text) from public, anon;
grant execute on function public.esign_get_pdf(uuid, text) to authenticated;

grant execute on function public.esign_signer_load(text) to anon, authenticated;
grant execute on function public.esign_signer_event(text, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.esign_signer_decline(text, text, text, text) to anon, authenticated;
grant execute on function public.esign_signer_finish(text, jsonb, text, text, text, text) to anon, authenticated;
grant execute on function public.esign_seal_data(text) to anon, authenticated;
grant execute on function public.esign_store_sealed(text, text, text) to anon, authenticated;
grant execute on function public.esign_mark_sent(text) to anon, authenticated;

-- ---------- DISCLOSURES (version 1, EN + ES) ----------

insert into public.envelope_disclosures (language, version, text) values
('en', 1,
'Consent to electronic records and signatures

You have been asked to review and sign this document electronically. Before you continue, please read and accept the following.

1. Electronic signature. By selecting "I agree" you consent to sign this document by electronic means. Your electronic signature will be as valid and enforceable as a handwritten signature, to the extent permitted by applicable law, including EU Regulation 910/2014 (eIDAS) and the US ESIGN Act and UETA.

2. Electronic records. You agree to receive this document, and any related notices, in electronic form. You may request a paper copy from the sender at any time.

3. Audit trail. To protect both parties, we record the date and time of each action you take on this document, together with your IP address and browser details. This record forms part of the signed document''s evidence.

4. Withdrawing consent. You may decline to sign electronically by choosing "Decline" on the signing screen and contacting the sender to arrange an alternative. Declining before you finish signing has no legal effect on you.

5. Requirements. You need a current web browser and a valid email address to sign electronically. If you cannot access this document, contact the sender.

By selecting "I agree and consent to sign electronically" you confirm that you have read this notice and that you consent to the use of electronic records and signatures for this document.'),
('es', 1,
'Consentimiento para registros y firmas electrónicos

Se te ha pedido revisar y firmar este documento por vía electrónica. Antes de continuar, lee y acepta lo siguiente.

1. Firma electrónica. Al seleccionar "Acepto" consientes en firmar este documento por medios electrónicos. Tu firma electrónica será tan válida y exigible como una firma manuscrita, en la medida permitida por la legislación aplicable, incluido el Reglamento (UE) 910/2014 (eIDAS) y las leyes estadounidenses ESIGN y UETA.

2. Registros electrónicos. Aceptas recibir este documento, y cualquier aviso relacionado, en formato electrónico. Puedes solicitar una copia en papel al remitente en cualquier momento.

3. Registro de auditoría. Para proteger a ambas partes, registramos la fecha y hora de cada acción que realizas sobre este documento, junto con tu dirección IP y los datos de tu navegador. Este registro forma parte de la evidencia del documento firmado.

4. Retirada del consentimiento. Puedes negarte a firmar electrónicamente eligiendo "Rechazar" en la pantalla de firma y contactando con el remitente para acordar una alternativa. Rechazar antes de terminar la firma no tiene ningún efecto legal sobre ti.

5. Requisitos. Necesitas un navegador web actualizado y una dirección de correo electrónico válida para firmar electrónicamente. Si no puedes acceder a este documento, contacta con el remitente.

Al seleccionar "Acepto y consiento firmar electrónicamente" confirmas que has leído este aviso y que consientes el uso de registros y firmas electrónicos para este documento.');
