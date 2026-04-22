import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpegPath from 'ffmpeg-static';

export const runtime = 'nodejs';
export const maxDuration = 60;

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm', '.avi', '.mkv', '.m4v'];
const MAX_PROXY_BYTES = 30 * 1024 * 1024;
const FRAME_COUNT = 5;
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const SOCIAL_MEDIA_HOSTS = [
  'twitter.com', 'x.com',
  'instagram.com', 'facebook.com', 'fb.com', 'fb.watch',
  'youtube.com', 'youtu.be',
  'tiktok.com',
  'reddit.com', 'redd.it',
  'linkedin.com',
];

function isSocialMediaUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    const host = hostname.replace(/^www\./, '');
    return SOCIAL_MEDIA_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

function isVideoUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return VIDEO_EXTENSIONS.some((ext) => pathname.endsWith(ext));
  } catch {
    return false;
  }
}

// Decode a data URI (data:image/jpeg;base64,...) into raw bytes + content-type.
function parseDataUri(url: string): { bytes: Buffer; contentType: string } | null {
  const m = url.match(/^data:([^;,]+)(?:;base64)?,(.+)$/);
  if (!m) return null;
  try {
    return { contentType: m[1], bytes: Buffer.from(m[2], 'base64') };
  } catch {
    return null;
  }
}

// Normalise known file-sharing share pages to their direct download URL.
// e.g. pixeldrain.com/u/XXXX  →  pixeldrain.com/api/file/XXXX
function normaliseFileShareUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === 'pixeldrain.com') {
      const m = u.pathname.match(/^\/u\/([A-Za-z0-9]+)/);
      if (m) return `https://pixeldrain.com/api/file/${m[1]}`;
    }
    return url;
  } catch {
    return url;
  }
}

// ─────────────────────────────── Provider types ───────────────────────────────

/**
 * ok=true  → deepfake probability 0-1
 * ok=false, quota=true  → trial/quota exhausted, skip to next provider
 * ok=false, quota=false → hard error (malformed response, unreachable URL, etc.)
 *   Special value error='url_fetch_failure': Sightengine-style "can't crawl the URL"
 *   signal — callers should download bytes and retry in bytes mode.
 */
type ProviderResult =
  | { ok: true; score: number }
  | { ok: false; quota: boolean; error: string };

interface Provider {
  name: string;
  isAvailable(): boolean;
  /** Analyse by having the provider fetch the URL itself. Optional — not all providers support this. */
  scoreUrl?(url: string): Promise<ProviderResult>;
  /** Analyse from raw bytes (required by all providers). */
  scoreBytes(bytes: Buffer, contentType: string, filename: string): Promise<ProviderResult>;
}

function isQuotaResponse(httpStatus: number, body: unknown): boolean {
  if (httpStatus === 402 || httpStatus === 429) return true;
  const text = JSON.stringify(body ?? '').toLowerCase();
  return /limit|quota|trial|exceeded|credit|balance|plan|subscription|upgrade/.test(text);
}

// ─────────────────────────── Sightengine / deepfake ──────────────────────────

const sightengineDeepfake: Provider = {
  name: 'Sightengine/deepfake',
  isAvailable: () =>
    !!(process.env.SIGHTENGINE_API_USER && process.env.SIGHTENGINE_API_SECRET),

  async scoreUrl(url) {
    const form = new FormData();
    form.append('url', url);
    form.append('models', 'deepfake');
    form.append('api_user', process.env.SIGHTENGINE_API_USER!);
    form.append('api_secret', process.env.SIGHTENGINE_API_SECRET!);

    const res = await fetch('https://api.sightengine.com/1.0/check.json', { method: 'POST', body: form });
    const data = await res.json();

    if (data?.status === 'failure') {
      const errText = `${data?.error?.type ?? ''} ${data?.error?.message ?? ''}`;
      if (/url|download|fetch|media|unreachable|host/i.test(errText)) {
        return { ok: false, quota: false, error: 'url_fetch_failure' };
      }
      return { ok: false, quota: isQuotaResponse(res.status, data), error: data?.error?.message || 'Sightengine failure' };
    }
    if (!res.ok) return { ok: false, quota: isQuotaResponse(res.status, data), error: 'Sightengine HTTP error' };
    return { ok: true, score: Number(data?.type?.deepfake ?? 0) };
  },

  async scoreBytes(bytes, contentType, filename) {
    const form = new FormData();
    form.append('models', 'deepfake');
    form.append('api_user', process.env.SIGHTENGINE_API_USER!);
    form.append('api_secret', process.env.SIGHTENGINE_API_SECRET!);
    form.append('media', new Blob([new Uint8Array(bytes)], { type: contentType }), filename);

    const res = await fetch('https://api.sightengine.com/1.0/check.json', { method: 'POST', body: form });
    const data = await res.json();

    if (!res.ok || data?.status === 'failure') {
      return { ok: false, quota: isQuotaResponse(res.status, data), error: data?.error?.message || 'Sightengine failure' };
    }
    return { ok: true, score: Number(data?.type?.deepfake ?? 0) };
  },
};

// ─────────────────────────── Sightengine / AI-generated ──────────────────────
// Uses the `genai` model — separate quota from the deepfake model.
// Response field is type.ai_generated (0-1, same deepfake-probability semantics here).

const sightengineAIGen: Provider = {
  name: 'Sightengine/ai-generated',
  isAvailable: () =>
    !!(process.env.SIGHTENGINE_API_USER && process.env.SIGHTENGINE_API_SECRET),

  async scoreUrl(url) {
    const form = new FormData();
    form.append('url', url);
    form.append('models', 'genai');
    form.append('api_user', process.env.SIGHTENGINE_API_USER!);
    form.append('api_secret', process.env.SIGHTENGINE_API_SECRET!);

    const res = await fetch('https://api.sightengine.com/1.0/check.json', { method: 'POST', body: form });
    const data = await res.json();

    if (data?.status === 'failure') {
      const errText = `${data?.error?.type ?? ''} ${data?.error?.message ?? ''}`;
      if (/url|download|fetch|media|unreachable|host/i.test(errText)) {
        return { ok: false, quota: false, error: 'url_fetch_failure' };
      }
      return { ok: false, quota: isQuotaResponse(res.status, data), error: data?.error?.message || 'Sightengine failure' };
    }
    if (!res.ok) return { ok: false, quota: isQuotaResponse(res.status, data), error: 'Sightengine HTTP error' };
    return { ok: true, score: Number(data?.type?.ai_generated ?? 0) };
  },

  async scoreBytes(bytes, contentType, filename) {
    const form = new FormData();
    form.append('models', 'genai');
    form.append('api_user', process.env.SIGHTENGINE_API_USER!);
    form.append('api_secret', process.env.SIGHTENGINE_API_SECRET!);
    form.append('media', new Blob([new Uint8Array(bytes)], { type: contentType }), filename);

    const res = await fetch('https://api.sightengine.com/1.0/check.json', { method: 'POST', body: form });
    const data = await res.json();

    if (!res.ok || data?.status === 'failure') {
      return { ok: false, quota: isQuotaResponse(res.status, data), error: data?.error?.message || 'Sightengine failure' };
    }
    return { ok: true, score: Number(data?.type?.ai_generated ?? 0) };
  },
};

// ──────────────────────────────── BitMind ────────────────────────────────────
// Env var: BITMIND_API_KEY and BITMIND_API_KEY_2
// Endpoint: POST https://api.bitmind.ai/detect-image
// Score field: response.confidence (0-1, AI-generation likelihood)

function createBitmindProvider(name: string, envVar: string): Provider {
  return {
    name,
    isAvailable: () => !!process.env[envVar],
    async scoreUrl(url) {
      const res = await fetch('https://api.bitmind.ai/detect-image', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env[envVar]}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ image: url }),
      });
      return parseBitmindResponse(res);
    },
    async scoreBytes(bytes, contentType, filename) {
      const form = new FormData();
      form.append('image', new Blob([new Uint8Array(bytes)], { type: contentType }), filename);

      const res = await fetch('https://api.bitmind.ai/detect-image', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env[envVar]}` },
        body: form,
      });
      return parseBitmindResponse(res);
    },
  };
}

const bitmind1 = createBitmindProvider('BitMind 1', 'BITMIND_API_KEY');
const bitmind2 = createBitmindProvider('BitMind 2', 'BITMIND_API_KEY_2');

async function parseBitmindResponse(res: Response): Promise<ProviderResult> {
  let data: unknown;
  try { data = await res.json(); } catch { data = null; }

  if (!res.ok) {
    return { ok: false, quota: isQuotaResponse(res.status, data), error: `BitMind HTTP ${res.status}` };
  }

  // { isAI: boolean, confidence: number (0-1), similarity: number, objectKey: string }
  // `confidence` = how certain the model is in its own prediction, not the raw "is fake" probability.
  // Real image:  isAI=false, confidence=0.9  → deepfake score = 1 - 0.9 = 0.10
  // Fake image:  isAI=true,  confidence=0.9  → deepfake score = 0.9
  const d = data as { isAI?: boolean; confidence?: number };
  if (typeof d?.confidence === 'number' && typeof d?.isAI === 'boolean') {
    return { ok: true, score: d.isAI ? d.confidence : 1 - d.confidence };
  }
  return { ok: false, quota: false, error: 'BitMind: unexpected response shape' };
}

// ──────────────────────────────── TruthScan ──────────────────────────────────
// Env var: TRUTHSCAN_API_KEY
// TODO: fill in endpoint + response shape from https://truthscan.com (or their API docs).

const truthscan: Provider = {
  name: 'TruthScan',
  isAvailable: () => !!process.env.TRUTHSCAN_API_KEY,

  async scoreUrl(url) {
    // TODO: replace with TruthScan's correct endpoint and request format.
    const res = await fetch('https://api.truthscan.com/v1/detect', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.TRUTHSCAN_API_KEY!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
    });
    return parseTruthscanResponse(res);
  },

  async scoreBytes(bytes, contentType, filename) {
    // TODO: replace with TruthScan's correct bytes upload format.
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)], { type: contentType }), filename);

    const res = await fetch('https://api.truthscan.com/v1/detect', {
      method: 'POST',
      headers: { 'x-api-key': process.env.TRUTHSCAN_API_KEY! },
      body: form,
    });
    return parseTruthscanResponse(res);
  },
};

async function parseTruthscanResponse(res: Response): Promise<ProviderResult> {
  let data: unknown;
  try { data = await res.json(); } catch { data = null; }

  if (!res.ok) {
    return { ok: false, quota: isQuotaResponse(res.status, data), error: `TruthScan HTTP ${res.status}` };
  }

  // TODO: adjust to TruthScan's actual response shape.
  const score = (data as Record<string, unknown>)?.score as number | undefined;
  if (typeof score === 'number') return { ok: true, score };
  return { ok: false, quota: false, error: 'TruthScan: unexpected response shape' };
}

// ─────────────────────────── Reality Defender ────────────────────────────────
// Env var: REALITY_DEFENDER_API_KEY
// Auth header: X-API-KEY (not Bearer)
// Flow: presign → PUT raw bytes to S3 → poll until terminal status
// Score: resultsSummary.metadata.finalScore (0-100) → divided by 100
// Terminal statuses: AUTHENTIC | FAKE | SUSPICIOUS | NOT_APPLICABLE | UNABLE_TO_EVALUATE

const POLL_ATTEMPTS = 6;
const POLL_INTERVAL_MS = 5000;

const RD_BASE = 'https://api.prd.realitydefender.xyz';
const RD_TERMINAL = new Set(['AUTHENTIC', 'FAKE', 'SUSPICIOUS', 'NOT_APPLICABLE', 'UNABLE_TO_EVALUATE']);

function createRealityDefenderProvider(name: string, envVar: string): Provider {
  return {
    name,
    isAvailable: () => !!process.env[envVar],
    // No scoreUrl — RD requires file upload; outer code downloads bytes first.

    async scoreBytes(bytes, contentType, filename) {
      const apiKey = process.env[envVar]!;
      const authHeader = { 'X-API-KEY': apiKey };

      // Step 1: request a presigned S3 upload URL
      const presignRes = await fetch(`${RD_BASE}/api/files/aws-presigned`, {
        method: 'POST',
        headers: { ...authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: filename }),
      });
      let presignData: unknown;
      try { presignData = await presignRes.json(); } catch { presignData = null; }

      if (!presignRes.ok) {
        return { ok: false, quota: isQuotaResponse(presignRes.status, presignData), error: `RealityDefender presign HTTP ${presignRes.status}` };
      }

      type PresignResp = { response?: { signedUrl?: string; requestId?: string }; requestId?: string };
      const pd = presignData as PresignResp;
      const signedUrl = pd?.response?.signedUrl;
      const requestId = pd?.response?.requestId ?? pd?.requestId;

      if (!signedUrl) return { ok: false, quota: false, error: 'RealityDefender: no signedUrl in presign response' };
      if (!requestId) return { ok: false, quota: false, error: 'RealityDefender: no requestId in presign response' };

      // Step 2: upload raw bytes directly to S3 (no auth header — it's a presigned URL)
      const uploadRes = await fetch(signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: new Uint8Array(bytes),
      });
      if (!uploadRes.ok) {
        return { ok: false, quota: false, error: `RealityDefender S3 upload HTTP ${uploadRes.status}` };
      }

      // Step 3: poll until a terminal status arrives (max POLL_ATTEMPTS × POLL_INTERVAL_MS)
      for (let i = 0; i < POLL_ATTEMPTS; i++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

        const pollRes = await fetch(`${RD_BASE}/api/media/users/${requestId}`, { headers: authHeader });
        let pollData: unknown;
        try { pollData = await pollRes.json(); } catch { pollData = null; }

        if (!pollRes.ok) {
          return { ok: false, quota: isQuotaResponse(pollRes.status, pollData), error: `RealityDefender poll HTTP ${pollRes.status}` };
        }

        type PollResp = { resultsSummary?: { status?: string; metadata?: { finalScore?: number } } };
        const { resultsSummary } = (pollData as PollResp) ?? {};
        const status = resultsSummary?.status;

        if (!status || !RD_TERMINAL.has(status)) continue; // still processing

        if (status === 'NOT_APPLICABLE' || status === 'UNABLE_TO_EVALUATE') {
          return { ok: false, quota: false, error: `RealityDefender: ${status}` };
        }

        // finalScore 0-100 → normalize to 0-1
        const raw = resultsSummary?.metadata?.finalScore;
        const score = typeof raw === 'number' ? raw / 100 : status === 'FAKE' ? 1 : 0;
        return { ok: true, score };
      }

      return { ok: false, quota: false, error: 'RealityDefender: timed out waiting for result' };
    },
  };
}

const realityDefender1 = createRealityDefenderProvider('RealityDefender 1', 'REALITY_DEFENDER_API_KEY');
const realityDefender2 = createRealityDefenderProvider('RealityDefender 2', 'REALITY_DEFENDER_API_KEY_2');

// ─────────────────────────── Provider chain ──────────────────────────────────
// Order: BitMind → Hive → TruthScan → RealityDefender → Sightengine/deepfake → Sightengine/ai-gen
// Only providers with env vars set are activated.

const ALL_PROVIDERS: Provider[] = [
  realityDefender1,
  realityDefender2,
  bitmind1,
  bitmind2,
  truthscan,
  sightengineDeepfake,
  sightengineAIGen,
];

function activeProviders() {
  return ALL_PROVIDERS.filter((p) => p.isAvailable());
}

/**
 * Try URL mode across providers in order.
 * Returns the first successful score, skipping providers whose quota is exhausted.
 * Returns null when no provider succeeded → caller falls back to bytes mode.
 * `quotaExhausted` is mutated so bytes-mode can skip those providers too.
 */
async function tryUrlMode(
  url: string,
  quotaExhausted: Set<string>,
): Promise<{ score: number; provider: string } | null> {
  for (const p of activeProviders()) {
    if (!p.scoreUrl) {
      // To strictly preserve provider priority order, if the current provider 
      // doesn't support URL mode, we must abort URL mode and fall back to Bytes mode.
      return null;
    }
    let r: ProviderResult;
    try {
      r = await p.scoreUrl(url);
    } catch (e) {
      console.warn(`${p.name} scoreUrl threw:`, e);
      continue;
    }

    if (r.ok) return { score: r.score, provider: p.name, errors: {} };

    if (r.quota) {
      console.warn(`${p.name}: quota exhausted, trying next provider`);
      quotaExhausted.add(p.name);
      continue;
    }

    if (r.error === 'url_fetch_failure') {
      // URL is unreachable — fall back to bytes mode.
      return null;
    }

    // Hard provider error — log and continue.
    console.warn(`${p.name} scoreUrl error:`, r.error);
  }
  return null;
}

/**
 * Try bytes mode across providers in order, skipping quota-exhausted ones.
 * Returns the first successful score.
 */
async function tryBytesMode(
  bytes: Buffer,
  contentType: string,
  filename: string,
  quotaExhausted: Set<string>,
): Promise<{ score: number; provider: string; errors?: Record<string, string> } | { error: string; providerErrors?: Record<string, string> }> {
  const providers = activeProviders();

  if (providers.length === 0) {
    return { error: 'لا توجد مفاتيح API متاحة. أضف SIGHTENGINE_API_USER/SECRET أو HIVE_API_KEY إلى .env.local' };
  }

  let lastError = 'فشل تحليل المحتوى';
  const errors: Record<string, string> = {};

  for (const p of providers) {
    if (quotaExhausted.has(p.name)) continue;

    let r: ProviderResult;
    try {
      r = await p.scoreBytes(bytes, contentType, filename);
    } catch (e) {
      console.warn(`${p.name} scoreBytes threw:`, e);
      lastError = `${p.name}: خطأ غير متوقع`;
      errors[p.name] = e instanceof Error ? e.message : String(e);
      continue;
    }

    if (r.ok) return { score: r.score, provider: p.name, errors };

    if (r.quota) {
      console.warn(`${p.name}: quota exhausted, trying next provider`);
      quotaExhausted.add(p.name);
      lastError = `انتهت الحصة المجانية لـ ${p.name}`;
      errors[p.name] = 'Quota exhausted';
      continue;
    }

    // Hard error — log and continue to next provider.
    console.warn(`${p.name} scoreBytes error:`, r.error);
    lastError = r.error || 'Unknown error';
    errors[p.name] = r.error || 'Unknown error';
  }

  const allExhausted = providers.every((p) => quotaExhausted.has(p.name));
  if (allExhausted) {
    return { error: 'انتهت الحصة المجانية لجميع مزودي الخدمة. جدد اشتراكك أو أضف مفتاح API جديد.', providerErrors: errors };
  }

  return { error: lastError, providerErrors: errors };
}

// ────────────────────────── Media download helper ────────────────────────────

type DownloadResult =
  | { ok: true; bytes: Buffer; contentType: string }
  | { ok: false; status: number; error: string };

const DOWNLOAD_TIMEOUT_MS = 25_000;

async function downloadMedia(url: string): Promise<DownloadResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  // Include Referer matching the video's origin — passes referrer-based CDN checks.
  const origin = (() => { try { return new URL(url).origin; } catch { return ''; } })();

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept': 'video/*,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        ...(origin ? { 'Referer': origin + '/' } : {}),
      },
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const isAbort = e instanceof Error && e.name === 'AbortError';
    return {
      ok: false,
      status: 400,
      error: isAbort
        ? 'استغرق تحميل الملف وقتاً طويلاً. قد يكون الملف كبيراً جداً أو الرابط بطيء.'
        : 'الرابط غير صالح أو لا يمكن الوصول إليه',
    };
  }

  if (!res.ok) {
    clearTimeout(timer);
    const is403 = res.status === 403;
    return {
      ok: false,
      status: 400,
      error: is403
        ? 'رفض الخادم تحميل الملف (403). بعض مواقع التخزين السحابي (Google، AWS…) تحجب الطلبات القادمة من خوادم التطبيقات. جرب رفع الفيديو مباشرة أو استخدم رابطاً من مصدر آخر.'
        : `تعذر تحميل الملف من المصدر (HTTP ${res.status}). قد يكون الرابط محمياً أو انتهت صلاحيته.`,
    };
  }

  // Reject early if content-length is declared and already too large.
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > MAX_PROXY_BYTES) {
    clearTimeout(timer);
    return {
      ok: false,
      status: 413,
      error: `حجم الملف (${Math.round(declared / 1024 / 1024)} ميجابايت) أكبر من الحد المسموح (30 ميجابايت). جرب رابطاً أصغر.`,
    };
  }

  // Stream the body chunk-by-chunk so we catch oversized files even when
  // content-length is absent (chunked transfer / CDNs that omit the header).
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    const reader = res.body!.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_PROXY_BYTES) {
        clearTimeout(timer);
        await reader.cancel();
        return {
          ok: false,
          status: 413,
          error: 'حجم الملف أكبر من الحد المسموح (30 ميجابايت). جرب رابطاً أصغر.',
        };
      }
      chunks.push(value);
    }
  } catch (e) {
    clearTimeout(timer);
    const isAbort = e instanceof Error && e.name === 'AbortError';
    return {
      ok: false,
      status: 400,
      error: isAbort
        ? 'استغرق تحميل الملف وقتاً طويلاً. قد يكون الملف كبيراً جداً أو الرابط بطيء.'
        : 'انقطع الاتصال أثناء تحميل الملف.',
    };
  }

  clearTimeout(timer);
  return {
    ok: true,
    bytes: Buffer.concat(chunks),
    contentType: res.headers.get('content-type') || 'application/octet-stream',
  };
}

// ─────────────────────────── Frame extraction ────────────────────────────────

async function extractFrames(videoBytes: Buffer, count: number): Promise<Buffer[]> {
  if (!ffmpegPath) throw new Error('ffmpeg binary not available for this platform');

  const dir = await mkdtemp(join(tmpdir(), 'fakeradar-'));
  const inputPath = join(dir, 'input.bin');
  const outputPattern = join(dir, 'frame_%02d.jpg');

  try {
    await writeFile(inputPath, videoBytes);
    if (process.platform !== 'win32') {
      await chmod(ffmpegPath, 0o755).catch(() => {});
    }

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ffmpegPath as string, [
        '-hide_banner', '-loglevel', 'error',
        '-i', inputPath,
        '-vf', 'fps=1/2',
        '-frames:v', String(count),
        '-q:v', '3',
        outputPattern,
      ]);
      let stderr = '';
      proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      proc.on('error', reject);
      proc.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
      });
    });

    const files = (await readdir(dir))
      .filter((f) => f.startsWith('frame_') && f.endsWith('.jpg'))
      .sort();
    return Promise.all(files.map((f) => readFile(join(dir, f))));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// ───────────────────────── Route handlers ────────────────────────────────────

async function handleImageUrl(url: string) {
  const quotaExhausted = new Set<string>();

  // Phase 1: let providers fetch the URL themselves (faster, no egress).
  const urlResult = await tryUrlMode(url, quotaExhausted);
  if (urlResult) {
    return NextResponse.json({ type: { deepfake: urlResult.score }, provider: urlResult.provider });
  }

  // Phase 2: download bytes ourselves, upload to providers.
  const dl = await downloadMedia(url);
  if (!dl.ok) return NextResponse.json({ error: dl.error }, { status: dl.status });

  if (dl.contentType.startsWith('text/') || dl.contentType.includes('html')) {
    return NextResponse.json(
      { error: 'الرابط يشير إلى صفحة ويب وليس ملف وسائط. استخدم رابطاً مباشراً ينتهي بـ .jpg أو .mp4 وما شابه.' },
      { status: 400 },
    );
  }

  const bytesResult = await tryBytesMode(dl.bytes, dl.contentType, 'image', quotaExhausted);
  if ('score' in bytesResult) {
    return NextResponse.json({ type: { deepfake: bytesResult.score }, provider: bytesResult.provider, debug_errors: bytesResult.errors });
  }
  return NextResponse.json({ error: bytesResult.error, debug_errors: bytesResult.providerErrors }, { status: 500 });
}

async function handleVideoUrl(url: string) {
  const dl = await downloadMedia(url);
  if (!dl.ok) return NextResponse.json({ error: dl.error }, { status: dl.status });

  if (dl.contentType.startsWith('text/') || dl.contentType.includes('html')) {
    return NextResponse.json(
      { error: 'الرابط يشير إلى صفحة ويب وليس ملف وسائط. استخدم رابطاً مباشراً ينتهي بـ .mp4 وما شابه.' },
      { status: 400 },
    );
  }

  // Host returned an image despite a video-looking URL — fall through to image scoring.
  if (dl.contentType.startsWith('image/')) {
    const quotaExhausted = new Set<string>();
    const r = await tryBytesMode(dl.bytes, dl.contentType, 'image', quotaExhausted);
    if ('score' in r) return NextResponse.json({ type: { deepfake: r.score }, provider: r.provider, debug_errors: r.errors });
    return NextResponse.json({ error: r.error, debug_errors: r.providerErrors }, { status: 500 });
  }

  let frames: Buffer[];
  try {
    frames = await extractFrames(dl.bytes, FRAME_COUNT);
  } catch (err) {
    console.error('ffmpeg error:', err);
    return NextResponse.json(
      { error: 'تعذر استخراج اللقطات من الفيديو. تأكد من أن الصيغة مدعومة.' },
      { status: 400 },
    );
  }

  if (frames.length === 0) {
    return NextResponse.json({ error: 'لم يتم استخراج أي لقطات من الفيديو.' }, { status: 400 });
  }

  // Score each frame — share the quota-exhausted set across frames so we don't
  // keep retrying an exhausted provider for every subsequent frame.
  const quotaExhausted = new Set<string>();
  const scores: number[] = [];
  let winningProvider = '';

  for (let i = 0; i < frames.length; i++) {
    const r = await tryBytesMode(frames[i], 'image/jpeg', `frame_${i}.jpg`, quotaExhausted);
    if ('score' in r) { scores.push(r.score); if (!winningProvider) winningProvider = r.provider; }
    else console.warn(`Frame ${i} failed:`, r.error);
  }

  if (scores.length === 0) {
    return NextResponse.json({ error: 'فشل تحليل جميع اللقطات' }, { status: 500 });
  }

  return NextResponse.json({
    type: { deepfake: Math.max(...scores) },
    provider: winningProvider,
    frames_analyzed: scores.length,
    frames_sampled: frames.length,
  });
}

// ─────────────────────────────── POST handler ────────────────────────────────

export async function POST(request: Request) {
  try {
    const { url: rawUrl } = await request.json();

    if (!rawUrl || typeof rawUrl !== 'string') {
      return NextResponse.json({ error: 'يرجى إدخال الرابط أولاً' }, { status: 400 });
    }

    const url = normaliseFileShareUrl(rawUrl.replace(/\s+/g, ''));
    if (!url) {
      return NextResponse.json({ error: 'يرجى إدخال الرابط أولاً' }, { status: 400 });
    }

    if (activeProviders().length === 0) {
      return NextResponse.json(
        { error: 'لا توجد مفاتيح API متاحة. أضف SIGHTENGINE_API_USER/SECRET أو HIVE_API_KEY إلى .env.local' },
        { status: 500 },
      );
    }

    // Handle data URIs (data:image/jpeg;base64,...) — decode locally, skip download.
    const dataUri = parseDataUri(url);
    if (dataUri) {
      const quotaExhausted = new Set<string>();
      const result = await tryBytesMode(dataUri.bytes, dataUri.contentType, 'image', quotaExhausted);
      if ('score' in result) {
        return NextResponse.json({ type: { deepfake: result.score }, provider: result.provider });
      }
      return NextResponse.json({ error: result.error }, { status: 500 });
    }

    if (isSocialMediaUrl(url)) {
      return NextResponse.json(
        {
          error:
            'روابط مواقع التواصل الاجتماعي (تويتر، انستغرام، يوتيوب، تيك توك...) غير مدعومة. ' +
            'يرجى لصق رابط مباشر للصورة أو الفيديو (ينتهي بـ .jpg أو .mp4 وما شابه).',
        },
        { status: 400 },
      );
    }

    if (isVideoUrl(url)) {
      return handleVideoUrl(url);
    }
    return handleImageUrl(url);
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    active: activeProviders().map((p) => p.name),
    env: {
      has_rd1: !!process.env.REALITY_DEFENDER_API_KEY,
      has_rd2: !!process.env.REALITY_DEFENDER_API_KEY_2,
      has_bm1: !!process.env.BITMIND_API_KEY,
      has_bm2: !!process.env.BITMIND_API_KEY_2,
    }
  });
}
