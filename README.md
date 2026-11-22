# Narahari Lenka — Portfolio

A cinematic, interactive 3D personal portfolio with a built-in content management system.

- **Public site:** hero with a water surface and cosmic WebGL background, About, Skills (3D particle spiral), Projects, Certificates and Contact; dark/light themes with a marbled ink transition; reduced-motion support throughout.
- **CMS** at `/#admin`: Supabase-backed editors for general settings, appearance, animations, page content (draft → publish), and a media library for images and PDFs.

## Tech stack

| Area | Tools |
|---|---|
| App | Vite, React 19, TypeScript |
| Styling | Tailwind CSS 4 + component CSS, self-hosted Inter and Space Grotesk |
| 3D & motion | Three.js, React Three Fiber, GLSL shaders, GSAP, Motion |
| Backend | Supabase (Postgres with Row Level Security, Auth, Storage) |
| Quality | `tsc`, oxlint, Node's built-in test runner |

## Getting started

Requirements: Node.js 20.19+ or 22.12+ (required by Vite 8).

```bash
npm install
cp .env.example .env.local   # then fill in your Supabase URL and PUBLISHABLE key
npm run dev                  # http://localhost:5174
```

Without `.env.local` the site still runs entirely from the local content in `content/`; the CMS needs Supabase.

> Only the Supabase **publishable** key belongs in `.env.local`. It is bundled into the public site by design; access is enforced by the database's Row Level Security policies. Never put a secret / service-role key in this project — the app refuses to use one.

On Windows, `start-website.bat` installs dependencies on first run and starts the dev server.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm run build` | Type-check (`tsc -b`) and production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | oxlint |
| `npm test` | Automated tests (`tests/*.test.mjs`) |

## Project structure

```
content/            Local content (JSON) — the fallback when CMS content isn't published
public/             Static files served as-is
src/
  main.tsx          Boot: loads published content (with cache + fallback), then the app or the CMS
  App.tsx           Public page: hero first, sections below the fold loaded right after
  BelowFold.tsx     About → Contact (own chunk)
  components/       Page sections and the 3D background
  animations/       Animation registry: every effect, its CMS-tunable parameters and defaults
  data/             Content mapping (CMS ⇄ local JSON), published-content loader and cache
  lib/              Supabase client, auth storage, theme transition
  admin/            The CMS (lazy-loaded; never part of the public bundle)
supabase/
  schema.sql        Tables, RLS policies, storage bucket and policies
  migrations/       Incremental schema changes
tests/              Unit and integration tests (no network; Supabase is faked)
boot-preload.ts     Build plugin: preload hints and early published-content requests
content-guard.ts    Dev plugin: keeps the site working while a content file has a typo
```

## How content is published

- Each page section is **draft** or **published** in Supabase. While a section is a draft, visitors see the local JSON content for it; once published, its database content is shown.
- The public site reads only published, visible rows (filtered in the queries and enforced by RLS). Drafts are visible to signed-in administrators only.
- The last published content is cached in the visitor's browser and used if Supabase is slow, so returning visitors see consistent content.

## Security model

- All writes (content, settings, media) require a signed-in administrator listed in `public.admins`; RLS and Storage policies enforce this on the server.
- Admin sessions are tab-scoped: a new tab requires signing in again.
- Secrets never live in this repository: `.env.local` and Supabase CLI metadata are git-ignored, and `.env.example` contains placeholders only.

See `EDITING-GUIDE.md` for editing the local content files.

## License

No license has been chosen. All rights reserved unless stated otherwise.
