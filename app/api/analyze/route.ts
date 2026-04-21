import { NextResponse } from 'next/server';

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm', '.avi', '.mkv', '.m4v'];
const MAX_PROXY_BYTES = 30 * 1024 * 1024;
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function isVideoUrl(url: string, contentType?: string | null): boolean {
  if (contentType?.startsWith('video/')) return true;
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return VIDEO_EXTENSIONS.some((ext) => pathname.endsWith(ext));
  } catch {
    return false;
  }
}

function endpointFor(isVideo: boolean) {
  return isVideo
    ? 'https://api.sightengine.com/1.0/video/check-sync.json'
    : 'https://api.sightengine.com/1.0/check.json';
}

// Client expects `data.type.deepfake` in [0,1]. Video responses expose per-frame
// scores under `data.frames[].type.deepfake`; collapse to the worst frame.
function normalize(data: any, isVideo: boolean) {
  if (!isVideo) return data;
  const frames: any[] = data?.data?.frames ?? data?.frames ?? [];
  const worst = frames.reduce(
    (m, f) => Math.max(m, Number(f?.type?.deepfake) || 0),
    0,
  );
  return { ...data, type: { deepfake: worst } };
}

function looksLikeUrlFetchFailure(data: any): boolean {
  if (data?.status !== 'failure') return false;
  const msg = `${data?.error?.type ?? ''} ${data?.error?.message ?? ''}`.toLowerCase();
  return /url|download|fetch|media|unreachable|host/.test(msg);
}

export async function POST(request: Request) {
  try {
    const { url } = await request.json();

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'يرجى إدخال الرابط أولاً' }, { status: 400 });
    }

    const apiUser = process.env.SIGHTENGINE_API_USER;
    const apiSecret = process.env.SIGHTENGINE_API_SECRET;
    if (!apiUser || !apiSecret) {
      return NextResponse.json({ error: 'مفاتيح API مفقودة' }, { status: 500 });
    }

    const isVideo = isVideoUrl(url);
    const endpoint = endpointFor(isVideo);

    // Path 1: let Sightengine fetch the URL itself. Works for any public URL,
    // sidesteps Vercel's function payload/memory limits entirely.
    const urlForm = new FormData();
    urlForm.append('url', url);
    urlForm.append('models', 'deepfake');
    urlForm.append('api_user', apiUser);
    urlForm.append('api_secret', apiSecret);

    let seResponse = await fetch(endpoint, { method: 'POST', body: urlForm });
    let seData: any = await seResponse.json();

    if (seResponse.ok && seData?.status !== 'failure') {
      return NextResponse.json(normalize(seData, isVideo));
    }

    // Only fall back to proxy-upload when the failure is "couldn't fetch the URL".
    // Other failures (quota, unsupported format, malformed URL) should surface as-is.
    if (!looksLikeUrlFetchFailure(seData)) {
      console.error('Sightengine error (url path):', seData);
      return NextResponse.json(
        { error: seData?.error?.message || 'فشل في تحليل المحتوى' },
        { status: 500 },
      );
    }

    // Path 2: download on our side with a browser UA, then upload the bytes.
    // For hosts that whitelist browsers but block Sightengine's crawler.
    let mediaResponse: Response;
    try {
      mediaResponse = await fetch(url, { headers: { 'User-Agent': BROWSER_UA } });
    } catch {
      return NextResponse.json(
        { error: 'الرابط غير صالح أو لا يمكن الوصول إليه' },
        { status: 400 },
      );
    }

    if (!mediaResponse.ok) {
      return NextResponse.json(
        {
          error: `تعذر تحميل الملف من المصدر (HTTP ${mediaResponse.status}). قد يكون الرابط محمياً أو انتهت صلاحيته.`,
        },
        { status: 400 },
      );
    }

    const declaredLength = Number(mediaResponse.headers.get('content-length') || 0);
    if (declaredLength && declaredLength > MAX_PROXY_BYTES) {
      return NextResponse.json(
        { error: 'حجم الملف أكبر من الحد المسموح (30 ميجابايت). جرب رابطاً أصغر أو رابطاً يستطيع Sightengine جلبه مباشرة.' },
        { status: 413 },
      );
    }

    const contentType =
      mediaResponse.headers.get('content-type') || 'application/octet-stream';
    const arrayBuffer = await mediaResponse.arrayBuffer();

    if (arrayBuffer.byteLength > MAX_PROXY_BYTES) {
      return NextResponse.json(
        { error: 'حجم الملف أكبر من الحد المسموح (30 ميجابايت).' },
        { status: 413 },
      );
    }

    const actuallyVideo = isVideo || contentType.startsWith('video/');
    const uploadEndpoint = endpointFor(actuallyVideo);

    const uploadForm = new FormData();
    uploadForm.append('models', 'deepfake');
    uploadForm.append('api_user', apiUser);
    uploadForm.append('api_secret', apiSecret);
    uploadForm.append(
      'media',
      new Blob([arrayBuffer], { type: contentType }),
      'media_file',
    );

    seResponse = await fetch(uploadEndpoint, { method: 'POST', body: uploadForm });
    seData = await seResponse.json();

    if (!seResponse.ok || seData?.status === 'failure') {
      console.error('Sightengine error (proxy path):', seData);
      return NextResponse.json(
        { error: seData?.error?.message || 'فشل في تحليل المحتوى' },
        { status: 500 },
      );
    }

    return NextResponse.json(normalize(seData, actuallyVideo));
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}
