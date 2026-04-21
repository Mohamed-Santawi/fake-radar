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
const SIGHTENGINE_IMAGE = 'https://api.sightengine.com/1.0/check.json';

function isVideoUrl(url: string): boolean {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return VIDEO_EXTENSIONS.some((ext) => pathname.endsWith(ext));
  } catch {
    return false;
  }
}

type SightengineError = { type?: string; message?: string };
type SightengineResponse = {
  status?: string;
  error?: SightengineError;
  type?: { deepfake?: number };
};

function looksLikeUrlFetchFailure(data: SightengineResponse): boolean {
  if (data?.status !== 'failure') return false;
  const msg = `${data?.error?.type ?? ''} ${data?.error?.message ?? ''}`.toLowerCase();
  return /url|download|fetch|media|unreachable|host/.test(msg);
}

type DownloadResult =
  | { ok: true; bytes: Buffer; contentType: string }
  | { ok: false; status: number; error: string };

async function downloadMedia(url: string): Promise<DownloadResult> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'User-Agent': BROWSER_UA } });
  } catch {
    return { ok: false, status: 400, error: 'الرابط غير صالح أو لا يمكن الوصول إليه' };
  }
  if (!res.ok) {
    return {
      ok: false,
      status: 400,
      error: `تعذر تحميل الملف من المصدر (HTTP ${res.status}). قد يكون الرابط محمياً أو انتهت صلاحيته.`,
    };
  }
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared && declared > MAX_PROXY_BYTES) {
    return {
      ok: false,
      status: 413,
      error: 'حجم الملف أكبر من الحد المسموح (30 ميجابايت). جرب رابطاً أصغر.',
    };
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.byteLength > MAX_PROXY_BYTES) {
    return {
      ok: false,
      status: 413,
      error: 'حجم الملف أكبر من الحد المسموح (30 ميجابايت).',
    };
  }
  return {
    ok: true,
    bytes,
    contentType: res.headers.get('content-type') || 'application/octet-stream',
  };
}

// Sample up to `count` JPEG frames from a video buffer, ~1 frame every 2s.
async function extractFrames(videoBytes: Buffer, count: number): Promise<Buffer[]> {
  if (!ffmpegPath) throw new Error('ffmpeg binary not available for this platform');

  const dir = await mkdtemp(join(tmpdir(), 'fakeradar-'));
  const inputPath = join(dir, 'input.bin');
  const outputPattern = join(dir, 'frame_%02d.jpg');

  try {
    await writeFile(inputPath, videoBytes);
    // Vercel's traced binary may lose its +x bit; ensure it's executable on Linux.
    if (process.platform !== 'win32') {
      await chmod(ffmpegPath, 0o755).catch(() => {});
    }

    await new Promise<void>((resolve, reject) => {
      const proc = spawn(ffmpegPath as string, [
        '-hide_banner',
        '-loglevel', 'error',
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

type ScoreResult = { ok: true; score: number } | { ok: false; error: string };

async function scoreImageBytes(
  apiUser: string,
  apiSecret: string,
  bytes: Buffer,
  contentType: string,
  filename: string,
): Promise<ScoreResult> {
  const form = new FormData();
  form.append('models', 'deepfake');
  form.append('api_user', apiUser);
  form.append('api_secret', apiSecret);
  form.append('media', new Blob([new Uint8Array(bytes)], { type: contentType }), filename);

  const res = await fetch(SIGHTENGINE_IMAGE, { method: 'POST', body: form });
  const data = await res.json();
  if (!res.ok || data?.status === 'failure') {
    return { ok: false, error: data?.error?.message || 'فشل في تحليل اللقطة' };
  }
  return { ok: true, score: Number(data?.type?.deepfake) || 0 };
}

async function handleImageUrl(url: string, apiUser: string, apiSecret: string) {
  const urlForm = new FormData();
  urlForm.append('url', url);
  urlForm.append('models', 'deepfake');
  urlForm.append('api_user', apiUser);
  urlForm.append('api_secret', apiSecret);

  const seRes = await fetch(SIGHTENGINE_IMAGE, { method: 'POST', body: urlForm });
  const seData: SightengineResponse = await seRes.json();

  if (seRes.ok && seData?.status !== 'failure') {
    return NextResponse.json(seData);
  }
  if (!looksLikeUrlFetchFailure(seData)) {
    console.error('Sightengine error (image url path):', seData);
    return NextResponse.json(
      { error: seData?.error?.message || 'فشل في تحليل المحتوى' },
      { status: 500 },
    );
  }

  const dl = await downloadMedia(url);
  if (!dl.ok) return NextResponse.json({ error: dl.error }, { status: dl.status });

  const r = await scoreImageBytes(apiUser, apiSecret, dl.bytes, dl.contentType, 'image');
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 });
  return NextResponse.json({ type: { deepfake: r.score } });
}

async function handleVideoUrl(url: string, apiUser: string, apiSecret: string) {
  const dl = await downloadMedia(url);
  if (!dl.ok) return NextResponse.json({ error: dl.error }, { status: dl.status });

  // Host served an image despite a video-looking URL — fall through to image scoring.
  if (dl.contentType.startsWith('image/')) {
    const r = await scoreImageBytes(apiUser, apiSecret, dl.bytes, dl.contentType, 'image');
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 500 });
    return NextResponse.json({ type: { deepfake: r.score } });
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
    return NextResponse.json(
      { error: 'لم يتم استخراج أي لقطات من الفيديو.' },
      { status: 400 },
    );
  }

  const results = await Promise.all(
    frames.map((bytes, i) =>
      scoreImageBytes(apiUser, apiSecret, bytes, 'image/jpeg', `frame_${i}.jpg`),
    ),
  );
  const scores = results.flatMap((r) => (r.ok ? [r.score] : []));

  if (scores.length === 0) {
    const firstError = results.find((r) => !r.ok) as
      | { ok: false; error: string }
      | undefined;
    return NextResponse.json(
      { error: firstError?.error || 'فشل تحليل جميع اللقطات' },
      { status: 500 },
    );
  }

  const worst = Math.max(...scores);
  return NextResponse.json({
    type: { deepfake: worst },
    frames_analyzed: scores.length,
    frames_sampled: frames.length,
  });
}

export async function POST(request: Request) {
  try {
    const { url: rawUrl } = await request.json();

    if (!rawUrl || typeof rawUrl !== 'string') {
      return NextResponse.json({ error: 'يرجى إدخال الرابط أولاً' }, { status: 400 });
    }

    // Browsers silently strip whitespace from pasted URLs; Node fetch doesn't.
    // Mirror that behavior so a clipboard newline doesn't turn into a 404.
    const url = rawUrl.replace(/\s+/g, '');
    if (!url) {
      return NextResponse.json({ error: 'يرجى إدخال الرابط أولاً' }, { status: 400 });
    }

    const apiUser = process.env.SIGHTENGINE_API_USER;
    const apiSecret = process.env.SIGHTENGINE_API_SECRET;
    if (!apiUser || !apiSecret) {
      return NextResponse.json({ error: 'مفاتيح API مفقودة' }, { status: 500 });
    }

    if (isVideoUrl(url)) {
      return handleVideoUrl(url, apiUser, apiSecret);
    }
    return handleImageUrl(url, apiUser, apiSecret);
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}
