# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

- `npm run dev` — start Next.js dev server (http://localhost:3000)
- `npm run build` — production build
- `npm run start` — run the production build
- `npm run lint` — ESLint (flat config in `eslint.config.mjs`, extends `eslint-config-next/core-web-vitals` + `/typescript`)

No test runner is configured.

## Required environment

`.env.local` must define `SIGHTENGINE_API_USER` and `SIGHTENGINE_API_SECRET`. Without them, `/api/analyze` returns HTTP 500 with an Arabic error.

## Architecture

FakeRadar ("رادار التزييف") is an Arabic RTL deepfake-detection UI that wraps Sightengine's deepfake model. App Router only; no `pages/` directory.

Request flow (`app/analyze/page.tsx` → `app/api/analyze/route.ts` → `app/result/page.tsx`):

1. Client (`/analyze`, client component) POSTs `{ url }` JSON to `/api/analyze`.
2. Server route picks the endpoint by URL extension / content-type: images go to `/1.0/check.json`, videos (`.mp4/.mov/.webm/.avi/.mkv/.m4v` or `content-type: video/*`) go to `/1.0/video/check-sync.json`.
3. **URL-first, proxy as fallback.** Server first posts the `url` field to Sightengine so their crawler fetches the media (sidesteps Vercel's function memory/payload limits entirely). Only if Sightengine returns a failure whose error string matches `/url|download|fetch|media|unreachable|host/i` does the route fall back to downloading the bytes itself (with a desktop `User-Agent`) and uploading them as `multipart/form-data` — capped at 30 MB. Every other Sightengine failure surfaces as-is.
4. Video responses return per-frame scores at `data.data.frames[].type.deepfake`; the route collapses to the worst frame and reshapes the payload to `{ type: { deepfake } }` so the client contract stays identical for images and videos.
5. Client reads `data.type.deepfake` (0–1), thresholds at `> 0.5`, and `router.push`es `/result?score=<float>&status=fake|real`. `/result` is a client component that reads `useSearchParams()` inside a `<Suspense>` boundary (required by Next's App Router for CSR bailout).

All user-facing copy and error strings are Arabic; the layout sets `lang="ar" dir="rtl"` globally.

## Styling

- Tailwind CSS **v4** via `@tailwindcss/postcss`. Theme is declared in CSS (`app/globals.css`) using `@import "tailwindcss"` + `@theme inline { ... }` — there is no `tailwind.config.js`. Custom tokens (`--color-primary`, `--color-surface`, `--color-border`, etc.) are referenced as utilities like `bg-primary`, `border-border`.
- Custom keyframes `pulse-radar` and `scan-line` are defined in `globals.css` and used via `animate-pulse-radar` / `animate-scan-line`.
- Fonts: `Cairo` from `next/font/google` bound to `--font-cairo` / `--font-sans`.
- Icons: `lucide-react`. Animations: `framer-motion` (result page only).
