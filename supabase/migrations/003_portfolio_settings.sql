-- =============================================================================
-- Migration 003 — Portfolio settings (appearance / animation / backgrounds)
-- STATUS: PROPOSAL FOR REVIEW — NOT APPLIED. Do not run until approved.
--
-- Run ONCE in the Supabase SQL Editor (as `postgres`), AFTER migration 002
-- (it does not depend on 002; the order just keeps history linear).
-- Transactional: it applies fully or not at all.
-- Not re-runnable by design: it first checks that none of the columns or
-- constraints it creates already exist and stops with an error (changing nothing)
-- if any do — so it can never silently adopt or alter a column made by hand.
-- After applying: regenerate src/lib/database.types.ts.
--
-- What it does
--   1. Creates three NEW JSONB columns on the existing single-row site_settings
--      table, each NOT NULL with default '{}':
--        appearance   — theme/typography/spacing choices   (src/config/portfolioSettings.ts)
--        animation    — Animation Registry settings         (src/animations/config.ts)
--        backgrounds  — background effect choices           (src/config/portfolioSettings.ts)
--      The site reads '{}' as "use the coded defaults", so the existing row and the
--      public site look exactly the same after applying.
--   2. Adds a size limit to the EXISTING ui_labels column (the column itself and its
--      original object-type check from schema.sql are left untouched).
--
-- What the database enforces (cheap structural rules only)
--   • each new column is NOT NULL and a JSON object;
--   • "version", if present, is a number;
--   • animation.global / animation.animations, if present, are objects;
--   • size, measured on the JSON text itself (octet_length(col::text)), so the
--     limit cannot be bypassed by values that compress well:
--        animation 16 KB · appearance 8 KB · backgrounds 8 KB · ui_labels 8 KB
--     (a maximal animation config for today's registry is ~1 KB; each further
--     animation adds roughly 0.4 KB, so 16 KB leaves room for ~35 more).
--
-- What the database does NOT enforce — and who does
--   The database cannot know which animation ids, parameter names or option names
--   exist; they live in the code. It therefore accepts any JSON object within the
--   limits above. The site validates every value on read (src/animations/config.ts,
--   src/config/portfolioSettings.ts): unknown ids/keys are ignored, numbers are
--   clamped to their declared ranges, options must be from fixed lists, and any
--   invalid value falls back to the coded default. These settings are only ever
--   treated as data — the site never evaluates them as code, CSS, shaders or URLs —
--   and the future admin saves only values that passed that same validation.
--
-- Security is unchanged: site_settings stays publicly readable (it holds no drafts;
-- note that anything saved here is therefore live immediately) and only admins can
-- update it (existing "site_settings: admin update" policy). Table-level grants
-- already cover new columns; no grant or policy is added or changed.
--
-- Every object created here carries a comment starting with "cms-migration-003:".
-- The rollback at the bottom removes only objects carrying that marker.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0. Pre-existence check — stop if any column or constraint this migration
--    creates already exists. (ui_labels is an existing column and is not checked;
--    only the NAME of its new size constraint is.)
-- -----------------------------------------------------------------------------
do $$
declare
  existing text[];
begin
  select array_agg(item) into existing from (
    select 'column public.site_settings.' || attname as item
      from pg_attribute
     where attrelid = 'public.site_settings'::regclass
       and attname in ('appearance', 'animation', 'backgrounds')
       and attnum > 0 and not attisdropped
    union all
    select 'constraint ' || conname
      from pg_constraint
     where conrelid = 'public.site_settings'::regclass
       and conname in ('site_settings_appearance_check', 'site_settings_animation_check',
                       'site_settings_backgrounds_check', 'site_settings_ui_labels_size_check')
  ) found;

  if existing is not null then
    raise exception 'Migration 003 stopped: already exists: %. Nothing was changed. Inspect these objects and compare them with this file before continuing.',
      array_to_string(existing, ', ');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 1. New columns — created here, so their type (jsonb), NOT NULL and '{}' default
--    are guaranteed. The existing row receives '{}' in each.
-- -----------------------------------------------------------------------------
alter table public.site_settings
  add column appearance  jsonb not null default '{}'::jsonb,
  add column animation   jsonb not null default '{}'::jsonb,
  add column backgrounds jsonb not null default '{}'::jsonb;

-- appearance ------------------------------------------------------------------
alter table public.site_settings add constraint site_settings_appearance_check check (
  appearance is not null
  and jsonb_typeof(appearance) = 'object'
  and (not (appearance ? 'version') or jsonb_typeof(appearance -> 'version') = 'number')
  and octet_length(appearance::text) <= 8192
);

-- animation (Animation Registry) ----------------------------------------------
-- Expected shape: { "version": 1, "global": {...}, "animations": { "<registered id>": {...} } }
alter table public.site_settings add constraint site_settings_animation_check check (
  animation is not null
  and jsonb_typeof(animation) = 'object'
  and (not (animation ? 'version') or jsonb_typeof(animation -> 'version') = 'number')
  and (not (animation ? 'global') or jsonb_typeof(animation -> 'global') = 'object')
  and (not (animation ? 'animations') or jsonb_typeof(animation -> 'animations') = 'object')
  and octet_length(animation::text) <= 16384
);

-- backgrounds -----------------------------------------------------------------
alter table public.site_settings add constraint site_settings_backgrounds_check check (
  backgrounds is not null
  and jsonb_typeof(backgrounds) = 'object'
  and (not (backgrounds ? 'version') or jsonb_typeof(backgrounds -> 'version') = 'number')
  and octet_length(backgrounds::text) <= 8192
);

-- ui_labels (existing column) -------------------------------------------------
-- The original object-type check from schema.sql is kept as it is; this adds a
-- separate size limit. It is validated against the existing row when added: if the
-- current value were larger, the whole migration would stop with an error and
-- change nothing (see pre-check B).
alter table public.site_settings add constraint site_settings_ui_labels_size_check check (
  octet_length(ui_labels::text) <= 8192
);

-- markers ---------------------------------------------------------------------
comment on column public.site_settings.appearance is
  'cms-migration-003: appearance settings (JSON object, validated by src/config/portfolioSettings.ts).';
comment on column public.site_settings.animation is
  'cms-migration-003: Animation Registry settings (JSON object, validated by src/animations/config.ts).';
comment on column public.site_settings.backgrounds is
  'cms-migration-003: background settings (JSON object, validated by src/config/portfolioSettings.ts).';
comment on constraint site_settings_appearance_check on public.site_settings is
  'cms-migration-003: object, numeric version, max 8192 bytes of JSON text.';
comment on constraint site_settings_animation_check on public.site_settings is
  'cms-migration-003: object, numeric version, object global/animations, max 16384 bytes of JSON text.';
comment on constraint site_settings_backgrounds_check on public.site_settings is
  'cms-migration-003: object, numeric version, max 8192 bytes of JSON text.';
comment on constraint site_settings_ui_labels_size_check on public.site_settings is
  'cms-migration-003: ui_labels max 8192 bytes of JSON text.';

commit;

-- =============================================================================
-- READ-ONLY PRE-CHECKS (before applying)
--   A. expect exactly one row: site_settings.ui_labels | jsonb | NO
--      select column_name, data_type, is_nullable, column_default
--      from information_schema.columns
--      where table_schema = 'public' and table_name = 'site_settings'
--        and column_name in ('appearance', 'animation', 'backgrounds', 'ui_labels');
--   B. ui_labels must be an object and ≤ 8192 bytes; expect exactly 1 row
--      select id, jsonb_typeof(ui_labels), octet_length(ui_labels::text) from public.site_settings;
--
-- READ-ONLY CHECKS after applying
--   select appearance, animation, backgrounds from public.site_settings;   -- {} {} {}
--   select column_name, data_type, is_nullable, column_default,
--          col_description('public.site_settings'::regclass, ordinal_position::int) as marker
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'site_settings'
--     and column_name in ('appearance', 'animation', 'backgrounds');            -- jsonb | NO | '{}'::jsonb
--   select conname, pg_get_constraintdef(oid), obj_description(oid, 'pg_constraint') as marker
--   from pg_constraint where conrelid = 'public.site_settings'::regclass order by conname;
--   select policyname, cmd from pg_policies where tablename = 'site_settings';  -- unchanged
--
-- =============================================================================
-- ROLLBACK (only if needed). Removes ONLY objects carrying the "cms-migration-003:"
-- marker, i.e. guaranteed to have been created by this migration. If a column or
-- constraint with one of these names exists without the marker, it stops and
-- changes nothing. ui_labels itself and its original check are never touched.
-- Note: deletes any appearance / animation / backgrounds settings saved since applying.
-- (Dropping a column also drops its own check constraint.)
-- =============================================================================
--   begin;
--
--   do $$
--   declare
--     foreign_objects text[];
--   begin
--     select array_agg(item) into foreign_objects from (
--       select 'column public.site_settings.' || attname as item
--         from pg_attribute
--        where attrelid = 'public.site_settings'::regclass
--          and attname in ('appearance', 'animation', 'backgrounds')
--          and attnum > 0 and not attisdropped
--          and coalesce(col_description(attrelid, attnum), '') not like 'cms-migration-003:%'
--       union all
--       select 'constraint ' || conname
--         from pg_constraint
--        where conrelid = 'public.site_settings'::regclass
--          and conname in ('site_settings_appearance_check', 'site_settings_animation_check',
--                          'site_settings_backgrounds_check', 'site_settings_ui_labels_size_check')
--          and coalesce(obj_description(oid, 'pg_constraint'), '') not like 'cms-migration-003:%'
--     ) found;
--     if foreign_objects is not null then
--       raise exception 'Rollback 003 stopped: not created by migration 003: %. Nothing was changed.',
--         array_to_string(foreign_objects, ', ');
--     end if;
--   end $$;
--
--   alter table public.site_settings drop constraint if exists site_settings_ui_labels_size_check;
--   alter table public.site_settings
--     drop column if exists appearance,
--     drop column if exists animation,
--     drop column if exists backgrounds;
--
--   commit;
-- =============================================================================
