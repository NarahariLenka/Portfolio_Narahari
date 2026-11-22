-- =============================================================================
-- Narahari Lenka portfolio — Supabase CMS schema
-- STATUS: PROPOSAL FOR REVIEW. Do not run until approved.
--
-- Run once in the Supabase SQL Editor (it runs as the `postgres` role).
-- The whole script is wrapped in a transaction: it applies fully or not at all.
-- It is written to be re-runnable (IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS).
--
-- Security model in one paragraph
--   • Every table has Row Level Security ON. With RLS on and no matching policy,
--     a request is denied — so anything not explicitly allowed below is blocked.
--   • Visitors (the `anon` role, i.e. the publishable key) can only SELECT rows that
--     are status = 'published' AND is_visible = true.
--   • Writes are allowed only for signed-in users whose auth.uid() is listed in
--     public.admins. That check lives in one function, public.is_admin().
--   • Nobody can add themselves to public.admins through the API: that table has no
--     INSERT/UPDATE/DELETE policy. Admins are added only from the SQL Editor
--     (see "ADMIN BOOTSTRAP" at the bottom).
--   • The secret / service-role key is never needed by the website.
--   • Table privileges are set explicitly (section 11): visitors get SELECT only,
--     signed-in users get exactly the writes the admin policies can allow, and
--     nobody but the database owner / service role can TRUNCATE.
--
-- IMPORTANT — this is a create script, not a migration
--   `create table if not exists` skips a table that already exists, even if that
--   existing table has different columns, types or constraints. The script will
--   NOT alter or migrate it, and the policies/indexes below may then fail or not
--   match. Run this on a project where these tables do not exist yet. If any of
--   them already exist, compare them with the definitions below first and migrate
--   them deliberately (or drop them, if they hold nothing you need).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Shared building blocks
-- -----------------------------------------------------------------------------

-- Draft/published workflow for every editable record.
do $$ begin
  create type public.content_status as enum ('draft', 'published');
exception when duplicate_object then null; end $$;

-- Keeps updated_at correct on every UPDATE, whoever makes it.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Trigger-only helper: nobody needs to call it directly.
revoke all on function public.set_updated_at() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 1. admins
-- Purpose: the list of Supabase Auth users allowed to edit the site.
--          One row per admin, keyed by their auth user id (not by email, which
--          can change). Deleting the auth user removes the admin row too.
-- -----------------------------------------------------------------------------
create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  note       text check (char_length(note) <= 200),   -- e.g. "owner"
  created_at timestamptz not null default now()
);

-- Single source of truth for "is the current request from an admin?"
--   • SECURITY DEFINER: runs with the owner's rights so it can read public.admins,
--     which ordinary users cannot read (except their own row). It takes no
--     arguments and only ever answers about the CALLER (auth.uid()), returning a
--     bare true/false — it cannot be used to probe whether someone else is admin.
--   • search_path = '': nothing is resolved through the search path; every object
--     is schema-qualified (public.admins, auth.uid), so a malicious object named
--     "admins" or "uid" in another schema cannot be substituted.
--   • Owner pinned to postgres (the role the SQL Editor uses), so the definer
--     rights are well-defined and not those of whoever happens to run the script.
--   • EXECUTE: Postgres grants it to PUBLIC by default and Supabase's default
--     privileges grant it to anon/authenticated, so all are revoked first. Only
--     `authenticated` gets it back: every policy that calls is_admin() is scoped
--     `to authenticated`; visitors (anon) never evaluate it.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admins a where a.user_id = (select auth.uid())
  );
$$;

alter function public.is_admin() owner to postgres;
revoke all on function public.is_admin() from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;

-- -----------------------------------------------------------------------------
-- 2. site_settings
-- Purpose: site-wide values that appear once — browser tab title, search
--          description, owner name, footer text and small UI labels.
--          Exactly one row (id is always 1), so the app never has to choose.
--          Replaces content/site.json + content/footer.json.
-- -----------------------------------------------------------------------------
create table if not exists public.site_settings (
  id                smallint primary key default 1 check (id = 1),
  site_title        text not null default 'Narahari Lenka — Portfolio' check (char_length(site_title) <= 120),
  meta_description  text check (char_length(meta_description) <= 300),
  owner_name        text not null default 'Narahari Lenka' check (char_length(owner_name) <= 80),
  location          text check (char_length(location) <= 80),
  footer_copyright  text check (char_length(footer_copyright) <= 160),
  footer_signoff    text check (char_length(footer_signoff) <= 160),
  footer_back_to_top text check (char_length(footer_back_to_top) <= 40),
  -- Small UI strings ("Project preview", "View credential", icon tooltips…).
  -- JSONB here because it is a flat, open-ended set of labels that grows with the UI;
  -- one column per label would mean a migration for every new button.
  ui_labels         jsonb not null default '{}'::jsonb check (jsonb_typeof(ui_labels) = 'object'),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

insert into public.site_settings (id) values (1) on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- 3. sections
-- Purpose: the six page sections (home, about, skills, projects, certificates,
--          contact). Holds each section's number ("02"), heading, menu label,
--          order and visibility. The slug matches the HTML section id used by the
--          navigation, so it is fixed in format and unique.
-- -----------------------------------------------------------------------------
create table if not exists public.sections (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z][a-z0-9-]{1,40}$'),
  number      text check (number ~ '^[0-9]{1,3}$'),          -- "02"
  title       text not null check (char_length(title) <= 80),
  nav_label   text check (char_length(nav_label) <= 40),
  sort_order  integer not null default 0,
  is_visible  boolean not null default true,
  status      public.content_status not null default 'draft',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Seed: the six sections that already exist on the site, using only the
-- structural values already in the live content files (slug = section id,
-- number, heading, menu label). No portfolio text is added.
-- Seeded as DRAFT so nothing becomes public until you deliberately publish it.
-- `on conflict do nothing` never overwrites a section you have already edited.
insert into public.sections (slug, number, title, nav_label, sort_order, is_visible, status) values
  ('home',         null, 'Home',         'Home',         10, true, 'draft'),
  ('about',        '02', 'About',        'About',        20, true, 'draft'),
  ('skills',       '03', 'Skills',       'Skills',       30, true, 'draft'),
  ('projects',     '04', 'Projects',     'Projects',     40, true, 'draft'),
  ('certificates', '05', 'Certificates', 'Certificates', 50, true, 'draft'),
  ('contact',      '06', 'Contact',      'Contact',      60, true, 'draft')
on conflict (slug) do nothing;

-- -----------------------------------------------------------------------------
-- 4. content_blocks
-- Purpose: the free text inside a section that isn't a list item — e.g.
--          home.greeting, home.portrait, about.main_sentence, about.paragraph,
--          contact.headline. Addressed by (section, key) so the UI can ask for
--          "about / paragraph" and an admin edits exactly that one block.
--          Text goes in `body`; an optional image path in `image_path`; `data`
--          (JSONB) only for small structured values such as the headline's word list.
-- -----------------------------------------------------------------------------
create table if not exists public.content_blocks (
  id          uuid primary key default gen_random_uuid(),
  section_id  uuid not null references public.sections (id) on delete cascade,
  key         text not null check (key ~ '^[a-z][a-z0-9_]{1,60}$'),
  body        text check (char_length(body) <= 5000),
  image_path  text check (image_path is null or image_path !~* '^[a-z][a-z0-9+.-]*://'),
  image_alt   text check (char_length(image_alt) <= 300),
  data        jsonb check (data is null or jsonb_typeof(data) in ('object', 'array')),
  sort_order  integer not null default 0,
  is_visible  boolean not null default true,
  status      public.content_status not null default 'draft',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (section_id, key)
);

-- -----------------------------------------------------------------------------
-- 5. skills
-- Purpose: the skills spiral (Python, Java, SQL…). One row per skill with its
--          short description and the tools listed under it.
--          `tools` is text[] — an ordered list of short labels, simpler and
--          stricter than JSONB.
-- -----------------------------------------------------------------------------
create table if not exists public.skills (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,60}$'),
  name         text not null check (char_length(name) <= 60),
  description  text check (char_length(description) <= 400),
  tools        text[] not null default '{}' check (cardinality(tools) <= 30),
  sort_order   integer not null default 0,
  is_visible   boolean not null default true,
  status       public.content_status not null default 'draft',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 6. projects
-- Purpose: the project showcase. Title, description, technologies, screenshot
--          (Storage path), alt text and optional GitHub / live links.
--          `is_featured` marks the large first card.
-- -----------------------------------------------------------------------------
create table if not exists public.projects (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,80}$'),
  title         text not null check (char_length(title) <= 120),
  description   text check (char_length(description) <= 1500),
  technologies  text[] not null default '{}' check (cardinality(technologies) <= 20),
  image_path    text check (image_path is null or image_path !~* '^[a-z][a-z0-9+.-]*://'),
  image_alt     text check (char_length(image_alt) <= 300),
  github_url    text check (github_url is null or github_url ~* '^https://'),
  live_url      text check (live_url is null or live_url ~* '^https://'),
  is_featured   boolean not null default false,
  sort_order    integer not null default 0,
  is_visible    boolean not null default true,
  status        public.content_status not null default 'draft',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 7. certificates
-- Purpose: the certificate gallery. Each certificate can have a picture
--          (shown in the accordion) and/or a PDF (downloadable original), both
--          stored as Storage paths, plus issuer, date and a credential link.
--          `issued_label` is free text ("March 2026") because certificates show
--          dates in many forms; `issued_on` is an optional real date for sorting.
-- -----------------------------------------------------------------------------
create table if not exists public.certificates (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,80}$'),
  title           text not null check (char_length(title) <= 160),
  issuer          text check (char_length(issuer) <= 120),
  issued_on       date,
  issued_label    text check (char_length(issued_label) <= 40),
  image_path      text check (image_path is null or image_path !~* '^[a-z][a-z0-9+.-]*://'),
  image_alt       text check (char_length(image_alt) <= 300),
  pdf_path        text check (pdf_path is null or (pdf_path !~* '^[a-z][a-z0-9+.-]*://' and pdf_path ~* '\.pdf$')),
  credential_url  text check (credential_url is null or credential_url ~* '^https://'),
  sort_order      integer not null default 0,
  is_visible      boolean not null default true,
  status          public.content_status not null default 'draft',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 8. social_links
-- Purpose: the Contact dock (GitHub, LinkedIn, Email…). One row per platform;
--          `platform` is unique so there's never a duplicate icon. Email is
--          stored as a mailto: URL so every row is "a link".
-- -----------------------------------------------------------------------------
create table if not exists public.social_links (
  id          uuid primary key default gen_random_uuid(),
  platform    text not null unique check (platform ~ '^[a-z][a-z0-9-]{1,30}$'),  -- github, linkedin, email
  label       text not null check (char_length(label) <= 40),                   -- tooltip text
  url         text not null check (url ~* '^(https://|mailto:)'),
  sort_order  integer not null default 0,
  is_visible  boolean not null default true,
  status      public.content_status not null default 'draft',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 9. updated_at triggers
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['site_settings','sections','content_blocks','skills','projects','certificates','social_links']
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format('create trigger set_updated_at before update on public.%I
                    for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 10. Indexes
-- Partial indexes match exactly what the public site asks for:
-- "published, visible rows in display order". Admin screens use the PK/unique keys.
-- -----------------------------------------------------------------------------
create index if not exists sections_public_order_idx
  on public.sections (sort_order) where status = 'published' and is_visible;
create index if not exists content_blocks_section_idx          -- FK lookups / cascades
  on public.content_blocks (section_id, sort_order);
create index if not exists skills_public_order_idx
  on public.skills (sort_order) where status = 'published' and is_visible;
create index if not exists projects_public_order_idx
  on public.projects (sort_order) where status = 'published' and is_visible;
create index if not exists certificates_public_order_idx
  on public.certificates (sort_order) where status = 'published' and is_visible;
create index if not exists social_links_public_order_idx
  on public.social_links (sort_order) where status = 'published' and is_visible;
-- At most one featured project.
create unique index if not exists projects_one_featured_idx
  on public.projects (is_featured) where is_featured;

-- -----------------------------------------------------------------------------
-- 11. Table privileges
-- RLS decides WHICH ROWS a role may touch; privileges decide WHICH OPERATIONS
-- it may attempt at all. RLS does not apply to TRUNCATE (nor to REFERENCES /
-- TRIGGER), and Supabase's default privileges grant ALL on new public tables to
-- anon and authenticated — so everything is revoked first and only what the
-- policies are designed for is granted back. The owner (postgres) and the
-- service_role keep full access for dashboard/maintenance work.
-- -----------------------------------------------------------------------------
revoke all on
  public.admins, public.site_settings, public.sections, public.content_blocks,
  public.skills, public.projects, public.certificates, public.social_links
from public, anon, authenticated;

-- Visitors and signed-in users may read; RLS limits them to published rows
-- (admins additionally see drafts through their policy).
grant select on
  public.site_settings, public.sections, public.content_blocks,
  public.skills, public.projects, public.certificates, public.social_links
to anon, authenticated;

-- Writes: granted to signed-in users only, and every write is still filtered by
-- the "admin full access" / "admin update" policies (is_admin()), so a signed-in
-- non-admin can attempt a write but it affects zero rows / is rejected.
grant insert, update, delete on
  public.sections, public.content_blocks, public.skills,
  public.projects, public.certificates, public.social_links
to authenticated;
-- site_settings is a single fixed row: update only, never insert/delete via API.
grant update on public.site_settings to authenticated;

-- admins: readable only by a signed-in user, and RLS restricts that to their own
-- row. No write privilege at all through the API; anon gets nothing.
grant select on public.admins to authenticated;

-- (TRUNCATE, REFERENCES and TRIGGER are deliberately never granted to anon or
-- authenticated; the `revoke all` above removed any default grants.)

-- -----------------------------------------------------------------------------
-- 12. Row Level Security
-- -----------------------------------------------------------------------------
alter table public.admins          enable row level security;
alter table public.site_settings   enable row level security;
alter table public.sections        enable row level security;
alter table public.content_blocks  enable row level security;
alter table public.skills          enable row level security;
alter table public.projects        enable row level security;
alter table public.certificates    enable row level security;
alter table public.social_links    enable row level security;

-- admins: a signed-in user may see only their own row (lets the admin UI check
-- "am I an admin?"). No insert/update/delete policies exist, so the API can
-- never add or remove admins — only the SQL Editor can.
drop policy if exists "admins: read own row" on public.admins;
create policy "admins: read own row" on public.admins
  for select to authenticated
  using (user_id = (select auth.uid()));

-- site_settings: always public to read (it holds no drafts); admins may update.
-- No INSERT/DELETE policy: the single row is created above and never removed.
drop policy if exists "site_settings: public read" on public.site_settings;
create policy "site_settings: public read" on public.site_settings
  for select to anon, authenticated
  using (true);
drop policy if exists "site_settings: admin update" on public.site_settings;
create policy "site_settings: admin update" on public.site_settings
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- For every list table the same pair of policies:
--   "<table>: public read published" — anyone sees published + visible rows.
--   "<table>: admin full access"     — admins see drafts and can insert/update/delete.
-- content_blocks additionally requires its parent section to be published+visible,
-- so hiding a section hides all of its text.
do $$
declare t text;
begin
  foreach t in array array['sections','skills','projects','certificates','social_links']
  loop
    execute format('drop policy if exists "%s: public read published" on public.%I', t, t);
    execute format($p$create policy "%s: public read published" on public.%I
                      for select to anon, authenticated
                      using (status = 'published' and is_visible)$p$, t, t);
    execute format('drop policy if exists "%s: admin full access" on public.%I', t, t);
    execute format($p$create policy "%s: admin full access" on public.%I
                      for all to authenticated
                      using ((select public.is_admin()))
                      with check ((select public.is_admin()))$p$, t, t);
  end loop;
end $$;

drop policy if exists "content_blocks: public read published" on public.content_blocks;
create policy "content_blocks: public read published" on public.content_blocks
  for select to anon, authenticated
  using (
    status = 'published' and is_visible
    and exists (
      select 1 from public.sections s
      where s.id = content_blocks.section_id and s.status = 'published' and s.is_visible
    )
  );
drop policy if exists "content_blocks: admin full access" on public.content_blocks;
create policy "content_blocks: admin full access" on public.content_blocks
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- -----------------------------------------------------------------------------
-- 13. Storage: one bucket for all portfolio media
-- Purpose: holds the portrait, project screenshots, certificate images and PDFs.
-- Folder convention (the table columns store these paths, e.g.
-- 'projects/retinax.webp' — never a full URL):
--     portrait/…      projects/…      certificates/images/…      certificates/pdfs/…
-- The bucket is PUBLIC so the site can show files via their public URL with no
-- login. Consequence: anyone who knows a file's exact path can open it, even if
-- its database row is still a draft — so don't upload anything private here.
-- Size and type limits are enforced by Storage itself.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'portfolio-media', 'portfolio-media', true,
  10485760,  -- 10 MB per file
  array['image/jpeg','image/png','image/webp','image/avif','application/pdf']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Storage access policies (on storage.objects, which already has RLS enabled).
-- No public SELECT policy is needed: public-bucket files are served by URL
-- without one, and leaving it out stops visitors from LISTING the bucket.
-- Admins get SELECT too, because uploads that overwrite (upsert) and deletes
-- need to see the object first.
drop policy if exists "portfolio-media: admin read" on storage.objects;
create policy "portfolio-media: admin read" on storage.objects
  for select to authenticated
  using (bucket_id = 'portfolio-media' and (select public.is_admin()));

drop policy if exists "portfolio-media: admin upload" on storage.objects;
create policy "portfolio-media: admin upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'portfolio-media'
    and (select public.is_admin())
    and (storage.foldername(name))[1] in ('portrait', 'projects', 'certificates')
  );

-- UPDATE (overwrite, or move/rename): the folder rule is applied to BOTH the
-- object as it exists now (USING) and the object after the change (WITH CHECK),
-- so a file can't be moved into, out of, or between unapproved locations.
drop policy if exists "portfolio-media: admin update" on storage.objects;
create policy "portfolio-media: admin update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'portfolio-media'
    and (select public.is_admin())
    and (storage.foldername(name))[1] in ('portrait', 'projects', 'certificates')
  )
  with check (
    bucket_id = 'portfolio-media'
    and (select public.is_admin())
    and (storage.foldername(name))[1] in ('portrait', 'projects', 'certificates')
  );

-- DELETE: same approved folders only.
drop policy if exists "portfolio-media: admin delete" on storage.objects;
create policy "portfolio-media: admin delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'portfolio-media'
    and (select public.is_admin())
    and (storage.foldername(name))[1] in ('portrait', 'projects', 'certificates')
  );

commit;

-- =============================================================================
-- ADMIN BOOTSTRAP (do this once, by hand, after the script above has run)
-- =============================================================================
-- 1. Supabase dashboard → Authentication → Users → "Add user" → create YOUR
--    account with email + a strong password (tick "Auto confirm user").
-- 2. Authentication → Sign In / Providers → turn OFF "Allow new users to sign up",
--    so strangers can't even create accounts. (They still couldn't edit anything,
--    but there's no reason to let them in.)
-- 3. In Authentication → Users, open your user and COPY its User UID.
--    Granting by the exact UID (not by email) means a look-alike, duplicate,
--    unconfirmed, anonymous or SSO account can never be picked up by mistake.
--
-- 4. In the SQL Editor, run the block below with BOTH values filled in. It grants
--    admin only if the UID exists AND belongs to the expected email AND that
--    account is confirmed, not anonymous, not SSO and not deleted. Otherwise it
--    stops with an error and grants nothing:
--
--      do $$
--      declare
--        v_uid   uuid := 'PASTE-USER-UID-HERE';
--        v_email text := 'YOUR-ADMIN-EMAIL-HERE';
--        v_ok    boolean;
--      begin
--        select (u.email_confirmed_at is not null
--                and coalesce(u.is_anonymous, false) = false
--                and coalesce(u.is_sso_user, false) = false
--                and u.deleted_at is null
--                and lower(u.email) = lower(v_email))
--          into v_ok
--          from auth.users u where u.id = v_uid;
--        if not found then
--          raise exception 'No auth user with id %', v_uid;
--        elsif not coalesce(v_ok, false) then
--          raise exception 'User % does not match the email, or is unconfirmed/anonymous/SSO/deleted', v_uid;
--        end if;
--        insert into public.admins (user_id, note) values (v_uid, 'owner')
--        on conflict (user_id) do nothing;
--        raise notice 'Admin granted to %', v_uid;
--      end $$;
--
--    Then confirm the list is exactly what you expect:
--      select a.user_id, u.email, a.created_at
--      from public.admins a join auth.users u on u.id = a.user_id;
--
-- 5. To remove an admin later:
--      delete from public.admins where user_id = '<their-user-id>';
--
-- Why this is safe: public.admins has no write policy and no write privilege
-- for anon/authenticated, so only someone already logged into your Supabase
-- dashboard (the SQL Editor runs as `postgres`) can grant admin rights. The
-- website and its publishable key cannot.
--
-- =============================================================================
-- QUICK CHECKS after applying (all read-only; run in the SQL Editor)
-- =============================================================================
--   select relname, relrowsecurity from pg_class
--   where relnamespace = 'public'::regnamespace and relkind = 'r';   -- all should be true
--
--   select tablename, policyname, cmd, roles from pg_policies
--   where schemaname in ('public', 'storage') order by 1, 2;
--
--   -- anon should have only SELECT; authenticated SELECT/INSERT/UPDATE/DELETE
--   -- (UPDATE only on site_settings, SELECT only on admins); nobody TRUNCATE:
--   select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type)
--   from information_schema.role_table_grants
--   where table_schema = 'public' and grantee in ('anon', 'authenticated')
--   group by 1, 2 order by 1, 2;
