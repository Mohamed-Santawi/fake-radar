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

`.env.local` must define at minimum `SIGHTENGINE_API_USER` and `SIGHTENGINE_API_SECRET`. Without them, `/api/analyze` returns HTTP 500 with an Arabic error. Full list of keys (missing key = provider inactive):

| Variable | Provider | Notes |
|---|---|---|
| `SIGHTENGINE_API_USER` + `SIGHTENGINE_API_SECRET` | Sightengine deepfake + genai | Required pair; shared quota across both models |
| `BITMIND_API_KEY` | BitMind 1 | Independent quota |
| `BITMIND_API_KEY_2` | BitMind 2 | Independent quota |
| `REALITY_DEFENDER_API_KEY` | RealityDefender 1 | Primary — newest key |
| `REALITY_DEFENDER_API_KEY_2` | RealityDefender 2 | First fallback |
| `REALITY_DEFENDER_API_KEY_3` | RealityDefender 3 | Second fallback |
| `TRUTHSCAN_API_KEY` | TruthScan | Stub — endpoint not yet implemented |

See `PROVIDERS.md` for the full provider chain strategy and per-provider API details.

## Architecture

FakeRadar ("رادار التزييف") is an Arabic RTL deepfake-detection UI. App Router only; no `pages/` directory. All server logic lives in `app/api/analyze/route.ts` — there are no `lib/`, `utils/`, or `components/` directories.

### Request flow

`app/analyze/page.tsx` → `app/api/analyze/route.ts` → `app/result/page.tsx`

1. Client (`/analyze`) POSTs `{ url }` JSON to `/api/analyze`.
2. Route pre-processes the URL: pixeldrain.com share pages are rewritten to direct download URLs; social-media domains (Twitter/X, Instagram, Facebook, YouTube, TikTok, Reddit, LinkedIn) are rejected immediately; data URIs (`data:image/...;base64,...`) are decoded inline and skip all downloading.
3. Media type is detected by URL path extension: `.mp4/.mov/.webm/.avi/.mkv/.m4v` → video; everything else → image.
4. **Images** go through `handleImageUrl`:
   - `tryUrlMode` runs first — but immediately returns `null` in practice because RealityDefender (first in chain) has no `scoreUrl`. The route then downloads the bytes (`downloadMedia`, 30 MB cap, 25 s timeout) and calls `tryBytesMode`.
   - `tryBytesMode` tries each active provider in priority order until one succeeds.
5. **Videos** always skip URL mode: bytes are downloaded, then ffmpeg-static extracts up to 5 frames (`fps=1/2`), and `tryBytesMode` is called per frame. The worst-frame score is returned.
6. Each provider implements the `Provider` interface:
   ```ts
   interface Provider {
     name: string;
     isAvailable(): boolean;
     scoreUrl?(url: string): Promise<ProviderResult>;   // optional — URL mode
     scoreBytes(bytes: Buffer, contentType: string, filename: string): Promise<ProviderResult>;
   }
   type ProviderResult = { ok: true; score: number } | { ok: false; quota: boolean; error: string };
   ```
   Active providers in priority order: **RealityDefender ×3 → BitMind ×2 → TruthScan → Sightengine/deepfake → Sightengine/ai-generated**.
7. Quota exhaustion is detected via HTTP 402/429 or a response body matching `/limit|quota|trial|exceeded|credit|balance|plan|subscription|upgrade/i`. Exhausted providers are skipped for the rest of the request. All provider errors are collected in `debug_errors` and returned in the response.
8. **RealityDefender** uses the `@realitydefender/realitydefender` npm SDK: bytes are written to a temp file, `sdk.detect({ filePath }, { maxAttempts: 6, pollingInterval: 5000 })` handles upload + polling internally (30 s max).
9. **BitMind** sends `{ image: url }` JSON with `Authorization: Bearer <key>` in URL mode, or multipart form in bytes mode. Score: `isAI ? confidence : 1 - confidence`.
10. **Sightengine** sends `media` as multipart in bytes mode, or `url` as a form field in URL mode. The `url_fetch_failure` error signals the provider couldn't crawl the URL — the code recognises this but in practice Sightengine is only reached in bytes mode.
11. Response is normalised to `{ type: { deepfake: <0–1> }, provider: "<name>" }` for both images and videos. Client thresholds at `> 0.5` and `router.push`es `/result?score=<float>&status=fake|real&provider=<name>`.
12. `/result` reads `useSearchParams()` inside a `<Suspense>` boundary (required by Next.js App Router for CSR bailout).

All user-facing copy and error strings are Arabic; the layout sets `lang="ar" dir="rtl"` globally.

## Vercel / build considerations

- `next.config.ts` sets `serverExternalPackages: ["ffmpeg-static"]` and `outputFileTracingIncludes` to bundle the ffmpeg binary in the Lambda layer.
- Route runtime is explicitly `nodejs` with a 60 s max duration (`maxDuration = 60`).
- All environment variables must be set in the Vercel dashboard (Settings → Environment Variables) — `.env.local` is gitignored and never deployed.

## Styling

- Tailwind CSS **v4** via `@tailwindcss/postcss`. Theme declared in `app/globals.css` using `@import "tailwindcss"` + `@theme inline { ... }` — there is no `tailwind.config.js`. Custom tokens (`--color-primary`, `--color-surface`, `--color-border`, etc.) map to utilities like `bg-primary`, `border-border`.
- Custom keyframes `pulse-radar` and `scan-line` defined in `globals.css`, used via `animate-pulse-radar` / `animate-scan-line`.
- Font: `Cairo` from `next/font/google`, bound to `--font-cairo` / `--font-sans`.
- Icons: `lucide-react`. Page-transition animations: `framer-motion` (result page only).
