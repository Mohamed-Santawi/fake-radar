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

`.env.local` must define at minimum `SIGHTENGINE_API_USER` and `SIGHTENGINE_API_SECRET`. Without them, `/api/analyze` returns HTTP 500 with an Arabic error. Full list of optional provider keys (missing keys disable that provider):

| Variable | Provider |
|---|---|
| `SIGHTENGINE_API_USER`, `SIGHTENGINE_API_SECRET` | Sightengine deepfake + genai |
| `BITMIND_API_KEY`, `BITMIND_API_KEY_2` | BitMind (two quota slots) |
| `REALITY_DEFENDER_API_KEY`, `REALITY_DEFENDER_API_KEY_2` | Reality Defender (two quota slots) |
| `TRUTHSCAN_API_KEY` | TruthScan (stub, not yet implemented) |

## Architecture

FakeRadar ("رادار التزييف") is an Arabic RTL deepfake-detection UI. App Router only; no `pages/` directory. All server logic is in `app/api/analyze/route.ts` (~800 LOC) — there are no `lib/`, `utils/`, or `components/` directories.

### Request flow

`app/analyze/page.tsx` → `app/api/analyze/route.ts` → `app/result/page.tsx`

1. Client (`/analyze`) POSTs `{ url }` JSON to `/api/analyze`.
2. Route normalises the URL: file-share links (e.g. pixeldrain.com) are rewritten to direct-download URLs. Social-media domains (Twitter, Instagram, YouTube, TikTok, Reddit, LinkedIn) are rejected immediately with an Arabic error. Data URIs are decoded inline.
3. Media type is detected by URL extension: `.mp4/.mov/.webm/.avi/.mkv/.m4v` → video; everything else → image. Videos are sampled at 5 frames (1 fps) using `ffmpeg-static`, which is spawned as a subprocess.
4. Providers are tried in order; first `ok: true` wins. Each provider implements:
   ```ts
   interface Provider {
     name: string;
     isAvailable(): boolean;
     scoreUrl?(url: string): Promise<ProviderResult>;   // optional; avoids proxy download
     scoreBytes(bytes: Buffer, contentType: string, filename: string): Promise<ProviderResult>;
   }
   type ProviderResult = { ok: true; score: number } | { ok: false; quota: boolean; error: string };
   ```
   Active providers in order: RealityDefender ×2, BitMind ×2, TruthScan, Sightengine/deepfake, Sightengine/ai-generated.
5. **URL-first, proxy as fallback.** `scoreUrl()` is called when available (Sightengine). Fallback to bytes-mode only when Sightengine returns a `url_fetch_failure` error. Bytes download is capped at 30 MB.
6. Quota exhaustion is detected via HTTP 402/429 or a body regex `/limit|quota|trial|exceeded|credit|balance|plan|subscription|upgrade/i`. Exhausted providers are skipped; errors are collected in `providerErrors` and returned in the response for debugging.
7. RealityDefender uses a presign → S3 upload → poll strategy (6 attempts × 5 s). BitMind uses a confidence field: `score = isAI ? confidence : 1 - confidence`.
8. Video scores are collapsed to the worst frame; the response shape is normalised to `{ type: { deepfake: <0-1> }, provider: string }` for both images and videos.
9. Client thresholds at `> 0.5` and `router.push`es `/result?score=<float>&status=fake|real&provider=<name>`. `/result` reads `useSearchParams()` inside a `<Suspense>` boundary (required by Next.js App Router for CSR bailout).

All user-facing copy and error strings are Arabic; the layout sets `lang="ar" dir="rtl"` globally.

## Vercel / build considerations

- `next.config.ts` sets `serverExternalPackages: ["ffmpeg-static"]` to prevent bundling and `outputFileTracingIncludes` to include the ffmpeg binary in the Lambda layer.
- Route runtime is explicitly `nodejs` with a 60 s max duration.

## Styling

- Tailwind CSS **v4** via `@tailwindcss/postcss`. Theme is declared in CSS (`app/globals.css`) using `@import "tailwindcss"` + `@theme inline { ... }` — there is no `tailwind.config.js`. Custom tokens (`--color-primary`, `--color-surface`, `--color-border`, etc.) are referenced as utilities like `bg-primary`, `border-border`.
- Custom keyframes `pulse-radar` and `scan-line` are defined in `globals.css` and used via `animate-pulse-radar` / `animate-scan-line`.
- Fonts: `Cairo` from `next/font/google` bound to `--font-cairo` / `--font-sans`.
- Icons: `lucide-react`. Animations: `framer-motion` (result page only).
