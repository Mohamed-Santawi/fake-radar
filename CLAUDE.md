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

FakeRadar ("رادار التزييف") is an Arabic RTL deepfake-detection UI that wraps the Sightengine `check.json` API. App Router only; no `pages/` directory.

Request flow (`app/analyze/page.tsx` → `app/api/analyze/route.ts` → `app/result/page.tsx`):

1. Client (`/analyze`, client component) POSTs `{ url }` JSON to `/api/analyze`.
2. Server route **fetches the media bytes itself** with a spoofed desktop `User-Agent`, then forwards them to Sightengine as `multipart/form-data` with field name `media` and `models=deepfake`. This indirection exists specifically to bypass hosts that block Sightengine's crawler — don't "simplify" it into passing the URL directly to Sightengine.
3. Client reads `data.type.deepfake` (0–1), thresholds at `> 0.5`, and `router.push`es `/result?score=<float>&status=fake|real`. `/result` is a client component that reads `useSearchParams()` inside a `<Suspense>` boundary (required by Next's App Router for CSR bailout).

All user-facing copy and error strings are Arabic; the layout sets `lang="ar" dir="rtl"` globally.

## Styling

- Tailwind CSS **v4** via `@tailwindcss/postcss`. Theme is declared in CSS (`app/globals.css`) using `@import "tailwindcss"` + `@theme inline { ... }` — there is no `tailwind.config.js`. Custom tokens (`--color-primary`, `--color-surface`, `--color-border`, etc.) are referenced as utilities like `bg-primary`, `border-border`.
- Custom keyframes `pulse-radar` and `scan-line` are defined in `globals.css` and used via `animate-pulse-radar` / `animate-scan-line`.
- Fonts: `Cairo` from `next/font/google` bound to `--font-cairo` / `--font-sans`.
- Icons: `lucide-react`. Animations: `framer-motion` (result page only).
