# Provider API Keys — Logic, Order, and Strategy

This document describes every AI provider wired into `/api/analyze`, the env vars that activate each one, exactly how the request flows through the chain at runtime, and what happens when a key is exhausted.

---

## Provider chain order

Providers are tried **in the order listed**. First `ok: true` result wins — every subsequent provider is skipped.

| # | Name | Env var(s) | Bytes mode | URL mode | Quota |
|---|------|-----------|-----------|---------|-------|
| 1 | RealityDefender 1 | `REALITY_DEFENDER_API_KEY` | ✓ SDK | — | independent |
| 2 | RealityDefender 2 | `REALITY_DEFENDER_API_KEY_2` | ✓ SDK | — | independent |
| 3 | RealityDefender 3 | `REALITY_DEFENDER_API_KEY_3` | ✓ SDK | — | independent |
| 4 | BitMind 1 | `BITMIND_API_KEY` | ✓ multipart | ✓ JSON | independent |
| 5 | BitMind 2 | `BITMIND_API_KEY_2` | ✓ multipart | ✓ JSON | independent |
| 6 | TruthScan | `TRUTHSCAN_API_KEY` | ✓ (stub) | ✓ (stub) | independent |
| 7 | Sightengine/deepfake | `SIGHTENGINE_API_USER` + `_SECRET` | ✓ multipart | ✓ form-url | shared with #8 |
| 8 | Sightengine/ai-generated | same pair as #7 | ✓ multipart | ✓ form-url | shared with #7 |

A provider is **inactive** when its env var(s) are absent. No code changes needed to enable/disable one — just set or remove the key.

---

## Actual runtime flow (as of current configuration)

Because RealityDefender (slots 1–3) has **no `scoreUrl` method**, the URL-mode pass immediately aborts at slot 1. In practice, every image request always downloads bytes first.

### Image request

```
POST /api/analyze  { url }
│
├─ Pre-processing
│   ├─ Pixeldrain share URL?  → rewrite to /api/file/ID
│   ├─ Social media domain?   → reject (Arabic error)
│   └─ data: URI?             → decode bytes inline, skip download → go to bytes mode
│
├─ tryUrlMode
│   └─ RD1 has no scoreUrl → return null immediately
│
├─ downloadMedia (30 MB cap, 25 s timeout, Browser UA + Referer)
│   ├─ content-type: text/html → reject (link to webpage, not media)
│   └─ ok → bytes in memory
│
└─ tryBytesMode (providers in order, quota-exhausted ones skipped)
    ├─ RD1  → SDK: write to temp file → detect() → poll (max 6 × 5s = 30s)
    ├─ RD2  → same
    ├─ RD3  → same
    ├─ BM1  → POST multipart { image: blob } to api.bitmind.ai/detect-image
    ├─ BM2  → same
    ├─ SE/deepfake  → POST multipart { media, models=deepfake } to sightengine
    ├─ SE/genai     → POST multipart { media, models=genai }    to sightengine
    └─ all failed / exhausted → return Arabic error + debug_errors map
```

### Video request

```
POST /api/analyze  { url }  (video extension detected)
│
├─ (same pre-processing as above; no tryUrlMode for videos)
│
├─ downloadMedia
│
├─ extractFrames (ffmpeg-static, fps=1/2, up to 5 frames, JPEG)
│
└─ for each frame → tryBytesMode (same provider order)
    └─ quotaExhausted set shared across all frames
       (so an exhausted provider is not retried on frame 2, 3…)

Final score = max(frame scores)
Response: { type: { deepfake: <0-1> }, provider, frames_analyzed, frames_sampled }
```

---

## Provider API details

### Reality Defender (slots 1–3)

| | |
|---|---|
| **SDK** | `@realitydefender/realitydefender` v0.1.x (official npm package) |
| **Auth** | `apiKey` passed to `new RealityDefender({ apiKey })` |
| **Flow** | Write bytes to a temp file in `os.tmpdir()` → `sdk.detect({ filePath }, { maxAttempts: 6, pollingInterval: 5000 })` → SDK handles S3 presign, upload, and polling internally |
| **Score** | `DetectionResult.score` — already 0–1; `null` if analysis didn't finish → hard error for that slot |
| **Statuses** | AUTHENTIC / MANIPULATED / FAKE / SUSPICIOUS / NOT_APPLICABLE / UNABLE_TO_EVALUATE |
| **Polling cap** | 6 attempts × 5 s = 30 s max (well within the 60 s function limit) |
| **Quota detection** | `RealityDefenderError.message` matched against `/limit\|quota\|trial\|exceeded\|credit\|balance\|plan\|subscription\|upgrade/i` |
| **Three slots** | Three independent monthly quotas; exhausting all three falls through to BitMind |

### BitMind (slots 4–5)

| | |
|---|---|
| **Base URL** | `https://api.bitmind.ai` |
| **Endpoint** | `POST /detect-image` |
| **Auth** | `Authorization: Bearer <key>` |
| **URL mode** | `Content-Type: application/json`, body `{ "image": "<url>" }` |
| **Bytes mode** | `multipart/form-data`, field name `image` |
| **Score** | `response.isAI=true` → score = `confidence`; `isAI=false` → score = `1 - confidence` |
| **Note** | URL mode is reachable only when no RD keys are set (otherwise tryUrlMode bails at RD1). With RD active, BitMind is always called via bytes mode. |

### TruthScan (slot 6)

| | |
|---|---|
| **Status** | Stub — endpoint and response shape are TODO in source |
| **Activate** | Set `TRUTHSCAN_API_KEY` once endpoint is confirmed |

### Sightengine (slots 7–8)

| | |
|---|---|
| **Base URL** | `https://api.sightengine.com` |
| **Endpoint** | `POST /1.0/check.json` |
| **Auth** | Form fields `api_user` + `api_secret` |
| **URL mode** | Form field `url=<url>`, `models=deepfake` or `models=genai` |
| **Bytes mode** | Form field `media=<blob>`, same models |
| **Score fields** | Slot 7: `type.deepfake`; Slot 8: `type.ai_generated` |
| **url_fetch_failure** | Sightengine error when their crawler can't reach the URL — the code handles this but in practice Sightengine is only reached in bytes mode (after RD/BitMind have already been tried) |
| **Two models, one key pair** | `deepfake` and `genai` quotas are separate; slot 7 exhausted ≠ slot 8 exhausted |

---

## Quota exhaustion

A provider is marked exhausted for the current request when it returns:
- HTTP 402 or 429, **or**
- A response body matching `/limit|quota|trial|exceeded|credit|balance|plan|subscription|upgrade/i`

Exhausted providers are skipped for all subsequent attempts in that request (shared across both URL mode and bytes mode, and across all video frames).

If **all active providers** are exhausted, the API returns:
> انتهت الحصة المجانية لجميع مزودي الخدمة. جدد اشتراكك أو أضف مفتاح API جديد.

**Fix**: add a new key (`_3`, `_4`, …), upgrade an account, or swap in a fresh account's key.

---

## Response shape

Both images and videos return the same contract to the client:

```json
{
  "type": { "deepfake": 0.87 },
  "provider": "RealityDefender 1",
  "debug_errors": { "RealityDefender 2": "quota exhausted" }
}
```

Videos also include `frames_analyzed` and `frames_sampled`. On error: `{ "error": "<Arabic string>", "debug_errors": { ... } }`.

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
2. `score` must be a deepfake probability **0–1** (1 = definitely fake).
3. Return `{ ok: false, quota: true, error }` on quota/trial exhaustion.
4. Return `{ ok: false, quota: false, error: 'url_fetch_failure' }` from `scoreUrl` only if the provider couldn't fetch the URL — this triggers bytes-mode fallback.
5. Add to `ALL_PROVIDERS` at the desired position and add its env var to `.env.local`.
6. Document it in this file.

---

## Environment variable inventory

| Env var | Provider | Notes |
|---------|----------|-------|
| `SIGHTENGINE_API_USER` | Sightengine | Required as a pair |
| `SIGHTENGINE_API_SECRET` | Sightengine | Required as a pair |
| `BITMIND_API_KEY` | BitMind 1 | |
| `BITMIND_API_KEY_2` | BitMind 2 | |
| `REALITY_DEFENDER_API_KEY` | RealityDefender 1 | Newest key — highest priority |
| `REALITY_DEFENDER_API_KEY_2` | RealityDefender 2 | First fallback |
| `REALITY_DEFENDER_API_KEY_3` | RealityDefender 3 | Second fallback |
| `TRUTHSCAN_API_KEY` | TruthScan | Commented out — stub not functional yet |
