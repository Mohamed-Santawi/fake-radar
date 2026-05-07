# Provider API Keys — Logic, Order, and Strategy

This document describes every AI provider wired into `/api/analyze`, the env vars that activate each one, how the provider chain executes at runtime, and what happens when a key is exhausted.

---

## Provider chain order

Providers are tried **in the order listed below**. The first provider that returns a clean score wins — the rest are skipped entirely for that request.

| # | Name | Env var(s) | Mode | Quota slots |
|---|------|-----------|------|-------------|
| 1 | RealityDefender 1 | `REALITY_DEFENDER_API_KEY` | bytes | independent |
| 2 | RealityDefender 2 | `REALITY_DEFENDER_API_KEY_2` | bytes | independent |
| 3 | RealityDefender 3 | `REALITY_DEFENDER_API_KEY_3` | bytes | independent |
| 4 | BitMind 1 | `BITMIND_API_KEY` | url + bytes | independent |
| 5 | BitMind 2 | `BITMIND_API_KEY_2` | url + bytes | independent |
| 6 | TruthScan | `TRUTHSCAN_API_KEY` | url + bytes | independent |
| 7 | Sightengine/deepfake | `SIGHTENGINE_API_USER` + `SIGHTENGINE_API_SECRET` | url + bytes | shared with #8 |
| 8 | Sightengine/ai-generated | same pair as above | url + bytes | shared with #7 |

A provider is **inactive** (skipped entirely) if its env var(s) are absent from `.env.local`. Add or remove a provider by setting or removing its key — no code changes needed.

---

## How a request flows through the chain

```
Request arrives
│
├─ URL mode pass (providers that support scoreUrl, in chain order)
│   ├─ Provider returns ok=true  ──→  return score, done
│   ├─ Provider returns quota    ──→  mark exhausted, try next
│   ├─ Provider returns url_fetch_failure  ──→  abort URL pass, go to bytes mode
│   └─ Provider lacks scoreUrl   ──→  abort URL pass, go to bytes mode
│
└─ Bytes mode pass (download media, then try each provider)
    ├─ Skip quota-exhausted providers (carried over from URL pass)
    ├─ Provider returns ok=true  ──→  return score, done
    ├─ Provider returns quota    ──→  mark exhausted, try next
    └─ All providers exhausted / failed  ──→  return Arabic error + debug_errors map
```

The response always includes `provider: "<name>"` so you can see which provider scored the request. On failure the response includes `debug_errors: { "<ProviderName>": "<error string>", ... }` for every provider that was tried.

---

## Provider details

### Reality Defender (slots 1–3)

- **SDK**: `@realitydefender/realitydefender` (official npm package)
- **Flow**: Write bytes to a temp file → `sdk.detect({ filePath }, { maxAttempts: 6, pollingInterval: 5000 })` → SDK handles presign + S3 upload + polling internally
- **Score**: `DetectionResult.score` (0–1, already normalised by SDK); `null` means analysis timed out → treated as a hard error for that slot
- **Polling cap**: 6 attempts × 5 s = 30 s max, well within the 60 s function limit
- **Quota detection**: `RealityDefenderError` messages matched against `/limit|quota|trial|exceeded|credit|balance|plan|subscription|upgrade/i`
- **Three slots** mean you have three independent monthly quotas before falling through to BitMind

### BitMind (slots 4–5)

- **Endpoint**: `POST https://api.bitmind.ai/detect-image`
- **Auth**: `Authorization: Bearer <key>`
- **URL mode**: Supported — send `{ image: url }` JSON body
- **Score field**: `response.confidence` with `response.isAI` boolean
  - `isAI=true` → deepfake score = `confidence`
  - `isAI=false` → deepfake score = `1 - confidence`
- **Two slots** give two independent quotas

### TruthScan (slot 6)

- **Status**: Stub — endpoint and response shape are placeholders (`TODO` in source)
- **Activate**: Set `TRUTHSCAN_API_KEY` once the real endpoint is confirmed

### Sightengine (slots 7–8)

- **Endpoints**: `/1.0/check.json` with `models=deepfake` (slot 7) and `models=genai` (slot 8)
- **Auth**: Form fields `api_user` + `api_secret`
- **URL mode**: Supported — send `url` form field
- **URL fetch fallback**: If Sightengine returns `url_fetch_failure` error, the route downloads the bytes itself and retries in bytes mode
- **Two models, one key pair** — the `genai` model is a different quota bucket from `deepfake`, so exhausting slot 7 doesn't burn slot 8

---

## Quota exhaustion behaviour

When a provider returns HTTP 402/429, or a response body matching `/limit|quota|trial|exceeded|credit|balance|plan|subscription|upgrade/i`, it is marked exhausted **for the duration of that request**. The next provider in the chain is tried. If **all** active providers are exhausted, the API returns:

> "انتهت الحصة المجانية لجميع مزودي الخدمة. جدد اشتراكك أو أضف مفتاح API جديد."

Fix: add a new key (`_3`, `_4`, …), upgrade an existing account, or swap in a key from a different account.

---

## Adding a new provider

1. Implement the `Provider` interface in `app/api/analyze/route.ts`:
   ```ts
   interface Provider {
     name: string;
     isAvailable(): boolean;
     scoreUrl?(url: string): Promise<ProviderResult>;   // optional
     scoreBytes(bytes: Buffer, contentType: string, filename: string): Promise<ProviderResult>;
   }
   ```
2. Return `{ ok: true, score }` where `score` is a deepfake probability **0–1**.
3. Return `{ ok: false, quota: true, error }` on quota/trial exhaustion.
4. Return `{ ok: false, quota: false, error: 'url_fetch_failure' }` from `scoreUrl` only when the provider couldn't fetch the URL — this triggers the bytes-mode fallback.
5. Add the provider instance to `ALL_PROVIDERS` at the desired priority position.
6. Add the env var to `.env.local` and document it in this file.

---

## Current `.env.local` key inventory

| Env var | Provider | Notes |
|---------|----------|-------|
| `SIGHTENGINE_API_USER` | Sightengine | Required pair |
| `SIGHTENGINE_API_SECRET` | Sightengine | Required pair |
| `BITMIND_API_KEY` | BitMind 1 | |
| `BITMIND_API_KEY_2` | BitMind 2 | |
| `REALITY_DEFENDER_API_KEY` | RealityDefender 1 | Primary key — newest, highest priority |
| `REALITY_DEFENDER_API_KEY_2` | RealityDefender 2 | First fallback |
| `REALITY_DEFENDER_API_KEY_3` | RealityDefender 3 | Second fallback |
| `TRUTHSCAN_API_KEY` | TruthScan | Commented out — stub not yet functional |
