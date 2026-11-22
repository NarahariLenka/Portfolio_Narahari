-- =============================================================================
-- Migration 002 — CMS phase 1
-- STATUS: PROPOSAL FOR REVIEW — NOT APPLIED. Do not run until approved.
--
-- Run ONCE in the Supabase SQL Editor (as `postgres`), BEFORE migration 003.
-- Transactional: it applies fully or not at all.
-- Not re-runnable by design: it first checks that nothing it creates already
-- exists and stops with an error (changing nothing) if anything does — so it can
-- never silently adopt or alter a column, constraint or policy made by hand.
-- After applying: regenerate src/lib/database.types.ts.
--
-- The site already works without this migration; it enables two features:
--   A. projects.image_position (how a screenshot is cropped in its frame)
--   B. published sections can be hidden without being mistaken for drafts
--
-- Changes NOTHING else: no grants, no admin policies, no Storage, no auth,
-- no existing rows (the new column starts NULL = today's default crop).
--
-- Every object created here carries a comment starting with "cms-migration-002:".
-- The rollback at the bottom removes only objects carrying that marker.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Pre-existence check — stop if anything this migration creates already exists.
-- -----------------------------------------------------------------------------
do $$
declare
  existing text[];
begin
  select array_agg(item) into existing from (
    select 'column public.projects.image_position' as item
      from pg_attribute
     where attrelid = 'public.projects'::regclass
       and attname = 'image_position' and attnum > 0 and not attisdropped
    union all
    select 'constraint projects_image_position_check'
      from pg_constraint
     where conrelid = 'public.projects'::regclass
       and conname = 'projects_image_position_check'
    union all
    select 'policy "sections: public read published incl hidden"'
      from pg_policy
     where polrelid = 'public.sections'::regclass
       and polname = 'sections: public read published incl hidden'
  ) found;

  if existing is not null then
    raise exception 'Migration 002 stopped: already exists: %. Nothing was changed. Inspect these objects and compare them with this file before continuing.',
      array_to_string(existing, ', ');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- A. projects.image_position
-- CSS object-position for the project screenshot. NULL = the site's default
-- ("50% 0%", top of the image). Only valid object-position values are accepted,
-- with percentages limited to 0–100%:
--   one value:   50% | left | center | right | top | bottom
--   two values:  <horizontal> <vertical>   e.g. '50% 0%', 'left top', '20% center'
--                horizontal = 0–100% | left | center | right
--                vertical   = 0–100% | top  | center | bottom
--   keyword pair in the other order: (top|center|bottom) (left|center|right)
--                                        e.g. 'top left'
-- Rejected: '120%', '05%', 'top 50%', 'left left', ' 50%', anything else.
-- The frontend (src/data/projects.ts) re-checks the value before using it and
-- falls back to the default if it is ever invalid.
-- -----------------------------------------------------------------------------
alter table public.projects
  add column image_position text;

alter table public.projects add constraint projects_image_position_check check (
  image_position is null
  or (
    char_length(image_position) <= 20
    and (
         image_position ~ '^((100|[1-9]?[0-9])%|left|center|right|top|bottom)$'
      or image_position ~ '^((100|[1-9]?[0-9])%|left|center|right) ((100|[1-9]?[0-9])%|top|center|bottom)$'
      or image_position ~ '^(top|center|bottom) (left|center|right)$'
    )
  )
);

comment on column public.projects.image_position is
  'cms-migration-002: CSS object-position for the screenshot crop (NULL = site default "50% 0%").';
comment on constraint projects_image_position_check on public.projects is
  'cms-migration-002: valid CSS object-position values only, percentages 0-100%.';

-- -----------------------------------------------------------------------------
-- B. Public read policy for sections: published rows, visible OR hidden.
--
-- Why: the original policy ("sections: public read published") returns only rows
-- that are published AND visible. A published-but-hidden section is then
-- invisible to visitors exactly like a draft, so the site falls back to local
-- JSON and still SHOWS it. Visitors must be able to read the published row
-- (with is_visible = false) for the site to hide the section and its menu item.
--
-- What becomes readable: only the structural metadata of PUBLISHED sections
-- (slug, number, heading, menu label, order, is_visible). Drafts stay unreadable.
-- A hidden section's TEXT stays private: the content_blocks policy (unchanged)
-- still requires its parent section to be published AND visible.
--
-- Why a NEW policy name: schema.sql re-creates "sections: public read published"
-- (published AND visible) every time it is run. Using a different name here means
-- a later re-run of schema.sql only adds that narrower policy back next to this
-- one. Both are PERMISSIVE and permissive policies are OR-ed, so the effective
-- rule stays exactly "status = 'published'" — the re-run cannot silently undo this
-- migration, and it can never widen access beyond published rows either.
-- -----------------------------------------------------------------------------
drop policy if exists "sections: public read published" on public.sections;
create policy "sections: public read published incl hidden" on public.sections
  as permissive
  for select to anon, authenticated
  using (status = 'published');

comment on policy "sections: public read published incl hidden" on public.sections is
  'cms-migration-002: visitors read PUBLISHED sections, visible or hidden; drafts stay private.';

commit;

-- =============================================================================
-- READ-ONLY CHECKS after applying (SQL Editor)
-- =============================================================================
--   -- column, constraint and their markers
--   select column_name, data_type, is_nullable,
--          col_description('public.projects'::regclass, ordinal_position::int) as marker
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'projects' and column_name = 'image_position';
--   select conname, pg_get_constraintdef(oid), obj_description(oid, 'pg_constraint') as marker
--   from pg_constraint where conname = 'projects_image_position_check';
--
--   -- sections policies: expect "sections: admin full access" and
--   -- "sections: public read published incl hidden" (PERMISSIVE, qual: status = 'published')
--   select policyname, permissive, cmd, roles, qual from pg_policies
--   where schemaname = 'public' and tablename = 'sections' order by policyname;
--
--   -- nothing else changed: content_blocks still checks s.is_visible
--   select policyname, qual from pg_policies where tablename = 'content_blocks';
--
-- =============================================================================
-- ROLLBACK (only if needed). Restores the original sections policy exactly as
-- schema.sql defines it, and removes image_position — but ONLY objects that carry
-- the "cms-migration-002:" marker, i.e. that this migration created. If anything
-- with these names exists without the marker, it stops and changes nothing.
--
-- It also inspects the ORIGINAL policy "sections: public read published" (which
-- schema.sql may have recreated after this migration). That policy is dropped and
-- recreated below, so it must be the expected one:
--   PERMISSIVE, FOR SELECT, TO exactly {anon, authenticated},
--   USING (status = 'published' AND is_visible), no WITH CHECK.
-- If it exists but differs in any of these, the rollback stops and changes nothing
-- (someone customised it; review it by hand). If it does not exist, it is created.
-- The USING condition is compared against a temporary reference policy built from
-- the expected SQL, so both are rendered by PostgreSQL the same way (no fragile
-- string matching). The reference exists only inside this transaction.
--
-- Every check runs before the first change. Any failure aborts the transaction.
-- Note: deletes any crop values saved in image_position since applying.
-- =============================================================================
--   begin;
--
--   do $$
--   declare
--     foreign_objects  text[];
--     original_exists  boolean;
--     orig_permissive  boolean;
--     orig_cmd         "char";
--     orig_roles       oid[];
--     orig_qual        text;
--     orig_has_check   boolean;
--     expected_roles   oid[];
--     expected_qual    text;
--   begin
--     -- 1. Ownership markers: every migration-002 object that exists must carry its marker.
--     select array_agg(item) into foreign_objects from (
--       select 'column public.projects.image_position' as item
--         from pg_attribute
--        where attrelid = 'public.projects'::regclass
--          and attname = 'image_position' and attnum > 0 and not attisdropped
--          and coalesce(col_description(attrelid, attnum), '') not like 'cms-migration-002:%'
--       union all
--       select 'constraint projects_image_position_check'
--         from pg_constraint
--        where conrelid = 'public.projects'::regclass
--          and conname = 'projects_image_position_check'
--          and coalesce(obj_description(oid, 'pg_constraint'), '') not like 'cms-migration-002:%'
--       union all
--       select 'policy "sections: public read published incl hidden"'
--         from pg_policy
--        where polrelid = 'public.sections'::regclass
--          and polname = 'sections: public read published incl hidden'
--          and coalesce(obj_description(oid, 'pg_policy'), '') not like 'cms-migration-002:%'
--     ) hits;
--     if foreign_objects is not null then
--       raise exception 'Rollback 002 stopped: not created by migration 002: %. Nothing was changed.',
--         array_to_string(foreign_objects, ', ');
--     end if;
--
--     -- 2. The original policy, if it exists, must match schema.sql exactly.
--     select exists (
--       select 1 from pg_policy
--        where polrelid = 'public.sections'::regclass and polname = 'sections: public read published'
--     ) into original_exists;
--
--     if original_exists then
--       select polpermissive, polcmd,
--              array(
--                select role_oid
--                from unnest(polroles) as u(role_oid)
--                order by role_oid
--              ),
--              pg_get_expr(polqual, polrelid),
--              polwithcheck is not null
--         into orig_permissive, orig_cmd, orig_roles, orig_qual, orig_has_check
--         from pg_policy
--        where polrelid = 'public.sections'::regclass and polname = 'sections: public read published';
--
--       select array(select oid from pg_roles where rolname in ('anon', 'authenticated') order by oid)
--         into expected_roles;
--
--       -- Reference policy with the expected condition, rendered by PostgreSQL itself.
--       create policy "cms-002 rollback reference" on public.sections
--         as permissive for select to anon, authenticated
--         using (status = 'published' and is_visible);
--       select pg_get_expr(polqual, polrelid) into expected_qual
--         from pg_policy
--        where polrelid = 'public.sections'::regclass and polname = 'cms-002 rollback reference';
--       drop policy "cms-002 rollback reference" on public.sections;
--
--       if not (orig_permissive
--               and orig_cmd = 'r'                                   -- 'r' = SELECT
--               and cardinality(expected_roles) = 2
--               and orig_roles = expected_roles
--               and orig_qual is not distinct from expected_qual
--               and not orig_has_check) then
--         raise exception 'Rollback 002 stopped: policy "sections: public read published" exists but differs from the expected definition (PERMISSIVE, SELECT, TO anon, authenticated, USING status = published AND is_visible). Found: permissive=%, cmd=%, roles=%, using=%, with_check=%. Nothing was changed.',
--           orig_permissive, orig_cmd,
--           array(select rolname from pg_roles where oid = any(orig_roles) order by rolname),
--           orig_qual, orig_has_check;
--       end if;
--     end if;
--   end $$;
--
--   -- All checks passed. Both names are dropped, so this also works after schema.sql
--   -- was re-run (the original policy, verified above, is recreated identically).
--   drop policy if exists "sections: public read published incl hidden" on public.sections;
--   drop policy if exists "sections: public read published" on public.sections;
--   create policy "sections: public read published" on public.sections
--     for select to anon, authenticated using (status = 'published' and is_visible);
--
--   alter table public.projects drop constraint if exists projects_image_position_check;
--   alter table public.projects drop column if exists image_position;
--
--   commit;
