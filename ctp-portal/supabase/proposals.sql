-- ============================================================
-- CTP PORTAL | PROPOSAL GENERATOR + PROSPECT PIPELINE
-- Run this entire file in: Supabase Dashboard > SQL Editor > New query
-- Requires the base portal schema (schema.sql) and the task management
-- migration (task-management-v2.sql: is_staff(), profiles.is_admin).
-- Safe to run once on a project that already has both.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- 1 | PROSPECT SUPPORT ON CLIENTS ----------
-- client_status is separate from the legacy status column on purpose:
-- existing clients keep their pipeline label and default to active here.
-- location and tax_id carry the "Prepared for" block on proposals.

alter table public.clients add column if not exists client_status text not null default 'active'
  check (client_status in ('prospect','active'));
alter table public.clients add column if not exists location text;
alter table public.clients add column if not exists tax_id text;

-- ---------- 2 | TABLES ----------

create table public.proposal_services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.proposal_pricing (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.proposal_services(id) on delete cascade,
  tier_label text not null,
  base_price numeric(12,2) not null check (base_price >= 0),
  currency text not null default 'EUR' check (currency in ('EUR','USD')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index proposal_pricing_service_idx on public.proposal_pricing(service_id);

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  -- Formatted as CTP-PROP-XXXX in the UI and on the PDF.
  proposal_number int generated always as identity unique,
  project_title text not null,
  language text not null default 'en' check (language in ('en','es')),
  currency text not null default 'EUR' check (currency in ('EUR','USD')),
  status text not null default 'draft' check (status in ('draft','sent','viewed','signed')),
  content_json jsonb not null default '{}'::jsonb,
  pdf_url text,
  -- Signed PDF bytes kept in-row so the tokenised signer path can store
  -- the sealed document without portal auth or the service role key
  -- (same approach as envelopes.sealed_pdf in the e-sign module).
  signed_pdf bytea,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  signed_at timestamptz
);

create index proposals_client_idx on public.proposals(client_id);
create index proposals_status_idx on public.proposals(status);

create table public.proposal_tokens (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.proposals(id) on delete cascade,
  token text not null unique,
  expires_at timestamptz not null,
  viewed_at timestamptz,
  signed_at timestamptz,
  signer_name text,
  signature_kind text check (signature_kind in ('drawn','typed')),
  signature_data text,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index proposal_tokens_proposal_idx on public.proposal_tokens(proposal_id);
create index proposal_tokens_token_idx on public.proposal_tokens(token);

-- Keep updated_at honest on every edit.
create or replace function public.proposals_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end; $$;

create trigger proposals_touch_updated
  before update on public.proposals
  for each row execute function public.proposals_touch();

-- ---------- 3 | ROW LEVEL SECURITY: staff only ----------
-- Prospects never touch these tables directly; the public signing page
-- goes through the token-validated proposal_sign_* functions below.

alter table public.proposal_services enable row level security;
alter table public.proposal_pricing enable row level security;
alter table public.proposals enable row level security;
alter table public.proposal_tokens enable row level security;

create policy "staff all proposal services" on public.proposal_services
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy "staff all proposal pricing" on public.proposal_pricing
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy "staff all proposals" on public.proposals
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
create policy "staff all proposal tokens" on public.proposal_tokens
  for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ---------- 4 | TABLE PRIVILEGES ----------
-- Grants say what the role may attempt; the RLS policies above say which
-- rows it reaches. anon gets nothing: prospects only ever go through the
-- security definer proposal_sign_* functions.

grant select, insert, update, delete on public.proposal_services to authenticated;
grant select, insert, update, delete on public.proposal_pricing to authenticated;
grant select, insert, update, delete on public.proposals to authenticated;
grant select, insert, update, delete on public.proposal_tokens to authenticated;

-- ---------- 5 | SIGNER FUNCTIONS (token validated, no portal auth) ----------
-- These are the only paths a prospect can take. Each one validates the
-- signing token, so the anon key alone grants nothing.

-- Resolve and validate a token. Raises on unknown or expired tokens.
create or replace function public.proposal_resolve_token(p_token text)
returns table (token_id uuid, proposal_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_row proposal_tokens%rowtype;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'Invalid link';
  end if;
  select * into v_row from proposal_tokens where token = p_token;
  if not found then
    raise exception 'Invalid link';
  end if;
  if v_row.expires_at < now() then
    raise exception 'This signing link has expired';
  end if;
  return query select v_row.id, v_row.proposal_id;
end; $$;

-- Everything the public signing page needs, in one call.
create or replace function public.proposal_sign_load(p_token text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_token_id uuid;
  v_proposal_id uuid;
  v_p proposals%rowtype;
  v_client_name text;
begin
  select r.token_id, r.proposal_id into v_token_id, v_proposal_id
  from proposal_resolve_token(p_token) r;

  select * into v_p from proposals where id = v_proposal_id;
  select name into v_client_name from clients where id = v_p.client_id;

  return jsonb_build_object(
    'proposal', jsonb_build_object(
      'id', v_p.id,
      'proposal_number', v_p.proposal_number,
      'project_title', v_p.project_title,
      'language', v_p.language,
      'currency', v_p.currency,
      'status', v_p.status,
      -- discovery_notes are internal; never sent to the prospect.
      'content', v_p.content_json - 'discovery_notes',
      'sent_at', v_p.sent_at,
      'signed_at', v_p.signed_at
    ),
    'client_name', v_client_name,
    'already_signed', (select t.signed_at is not null from proposal_tokens t where t.id = v_token_id)
  );
end; $$;

-- Record the first open of the signing link. IP and user agent come from
-- the Netlify function's request headers, not from the browser.
create or replace function public.proposal_sign_event(
  p_token text, p_event_type text, p_ip text, p_ua text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_token_id uuid;
  v_proposal_id uuid;
  v_p proposals%rowtype;
begin
  select r.token_id, r.proposal_id into v_token_id, v_proposal_id
  from proposal_resolve_token(p_token) r;
  select * into v_p from proposals where id = v_proposal_id;

  if p_event_type <> 'viewed' then
    raise exception 'Unsupported event type';
  end if;

  update proposal_tokens
     set viewed_at = coalesce(viewed_at, now()),
         ip = coalesce(ip, p_ip),
         user_agent = coalesce(user_agent, p_ua)
   where id = v_token_id;

  if v_p.status = 'sent' then
    update proposals set status = 'viewed' where id = v_proposal_id;
  end if;

  return jsonb_build_object('ok', true);
end; $$;

-- Capture the signature and close the proposal. Returns everything the
-- serverless sealer needs to build the signed PDF.
create or replace function public.proposal_sign_finish(
  p_token text, p_signer_name text, p_signature_data text, p_signature_kind text,
  p_ip text, p_ua text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_token_id uuid;
  v_proposal_id uuid;
  v_p proposals%rowtype;
  v_client clients%rowtype;
begin
  select r.token_id, r.proposal_id into v_token_id, v_proposal_id
  from proposal_resolve_token(p_token) r;
  select * into v_p from proposals where id = v_proposal_id;

  if v_p.status = 'signed' then
    raise exception 'This proposal has already been signed';
  end if;
  if v_p.status not in ('sent','viewed') then
    raise exception 'This proposal is not open for signing';
  end if;
  if p_signature_kind not in ('drawn','typed') then
    raise exception 'Invalid signature kind';
  end if;
  if p_signature_data is null or p_signature_data !~ '^data:image/png;base64,' then
    raise exception 'Invalid signature data';
  end if;

  update proposal_tokens
     set signed_at = now(),
         signer_name = p_signer_name,
         signature_kind = p_signature_kind,
         signature_data = p_signature_data,
         ip = p_ip,
         user_agent = p_ua
   where id = v_token_id;

  update proposals
     set status = 'signed', signed_at = now()
   where id = v_proposal_id;

  select * into v_client from clients where id = v_p.client_id;

  insert into activity_log (actor_email, action, client_id, details)
  values (v_client.contact_email, 'proposal_signed', v_p.client_id,
          'CTP-PROP-' || lpad(v_p.proposal_number::text, 4, '0') || ' | ' || v_p.project_title);

  return jsonb_build_object(
    'ok', true,
    'proposal', jsonb_build_object(
      'id', v_p.id,
      'proposal_number', v_p.proposal_number,
      'project_title', v_p.project_title,
      'language', v_p.language,
      'currency', v_p.currency,
      'content', v_p.content_json - 'discovery_notes',
      'sent_at', v_p.sent_at
    ),
    'client', jsonb_build_object(
      'id', v_client.id,
      'name', v_client.name,
      'email', v_client.contact_email,
      'location', v_client.location,
      'tax_id', v_client.tax_id
    ),
    'signer', jsonb_build_object(
      'name', p_signer_name,
      'signature_data', p_signature_data,
      'signature_kind', p_signature_kind,
      'signed_at', now()
    )
  );
end; $$;

-- Store the signed PDF and file it in the prospect's Documents tab.
-- Idempotent per proposal: refuses a second store.
create or replace function public.proposal_store_signed(p_token text, p_pdf_b64 text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_token_id uuid;
  v_proposal_id uuid;
  v_p proposals%rowtype;
  v_bytes bytea;
  v_number text;
  v_path text;
begin
  select r.token_id, r.proposal_id into v_token_id, v_proposal_id
  from proposal_resolve_token(p_token) r;
  select * into v_p from proposals where id = v_proposal_id;

  if v_p.status <> 'signed' then
    raise exception 'Proposal is not signed yet';
  end if;
  if v_p.signed_pdf is not null then
    raise exception 'Signed PDF already stored';
  end if;

  v_bytes := decode(p_pdf_b64, 'base64');
  v_number := 'CTP-PROP-' || lpad(v_p.proposal_number::text, 4, '0');
  -- Marker path, not a storage object: the Documents tabs detect the
  -- proposal/ prefix and download through proposal_signed_pdf() instead
  -- of the client-docs bucket.
  v_path := 'proposal/' || v_p.id || '/signed.pdf';

  update proposals
     set signed_pdf = v_bytes, pdf_url = v_path
   where id = v_proposal_id;

  insert into documents (client_id, name, category, storage_path, size_bytes, uploaded_by)
  values (v_p.client_id, v_number || ' | ' || v_p.project_title || ' | Signed.pdf',
          'contract', v_path, length(v_bytes), 'internal');

  return jsonb_build_object('ok', true, 'path', v_path);
end; $$;

-- ---------- 6 | PORTAL-SIDE PDF FETCH (staff or the owning client) ----------
-- Lets the Documents tabs open a proposal-backed signed PDF without a
-- storage object. Base64 out, decoded to a blob in the browser.

create or replace function public.proposal_signed_pdf(p_proposal_id uuid)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_p proposals%rowtype;
begin
  select * into v_p from proposals where id = p_proposal_id;
  if not found or v_p.signed_pdf is null then
    raise exception 'No signed PDF for this proposal';
  end if;
  if not (public.is_staff() or v_p.client_id = public.my_client_id()) then
    raise exception 'Not allowed';
  end if;
  return encode(v_p.signed_pdf, 'base64');
end; $$;

-- ---------- 7 | FUNCTION EXECUTE GRANTS ----------
-- Token functions are callable by anon (the token is the credential);
-- the PDF fetch stays locked to signed-in users.

revoke all on function public.proposal_resolve_token(text) from public, anon, authenticated;
revoke all on function public.proposals_touch() from public, anon, authenticated;

grant execute on function public.proposal_sign_load(text) to anon, authenticated;
grant execute on function public.proposal_sign_event(text, text, text, text) to anon, authenticated;
grant execute on function public.proposal_sign_finish(text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.proposal_store_signed(text, text) to anon, authenticated;

revoke all on function public.proposal_signed_pdf(uuid) from public, anon;
grant execute on function public.proposal_signed_pdf(uuid) to authenticated;

-- ---------- 8 | SEED DATA ----------
-- Services offered on proposals. Pricing rows only where the figure is
-- confirmed (source: signed invoice CTP-0001). Everything else surfaces
-- as [VERIFY] in the proposal form until priced here or in Settings.

insert into public.proposal_services (name, description, sort_order) values
  ('Tech stack (Foundation)', 'Core systems setup for smaller properties', 10),
  ('Tech stack (Premier)', 'Full systems setup with integrations', 20),
  ('Guida deployment', 'After-hours AI concierge setup and deployment', 30),
  ('Monthly retainer', 'Maintenance, support and monthly reporting', 40),
  ('Consulting hours', 'Ad-hoc consulting and operations work', 50);

insert into public.proposal_pricing (service_id, tier_label, base_price, currency)
select id, 'Standard', 2000.00, 'USD' from public.proposal_services where name = 'Guida deployment';

insert into public.proposal_pricing (service_id, tier_label, base_price, currency)
select id, 'Standard', 150.00, 'USD' from public.proposal_services where name = 'Monthly retainer';

insert into public.proposal_pricing (service_id, tier_label, base_price, currency)
select id, 'Partner', 120.00, 'USD' from public.proposal_services where name = 'Monthly retainer';
