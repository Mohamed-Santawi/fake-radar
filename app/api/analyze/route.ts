import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json({ error: 'يرجى إدخال الرابط أولاً' }, { status: 400 });
    }

    const apiUser = process.env.SIGHTENGINE_API_USER;
    const apiSecret = process.env.SIGHTENGINE_API_SECRET;

    if (!apiUser || !apiSecret) {
      return NextResponse.json({ error: 'مفاتيح API مفقودة' }, { status: 500 });
    }

    // 1. Fetch the media from the URL on our server to bypass Sightengine's bot block
    let mediaResponse;
    try {
      mediaResponse = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });
    } catch (e) {
      return NextResponse.json({ error: 'الرابط غير صالح أو لا يمكن الوصول إليه' }, { status: 400 });
    }

    if (!mediaResponse.ok) {
      return NextResponse.json({ error: 'الموقع المضيف يمنع تحميل هذا الملف. جرب رابطاً آخر.' }, { status: 400 });
    }

    const contentType = mediaResponse.headers.get('content-type') || 'application/octet-stream';
    const arrayBuffer = await mediaResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 2. Send the raw bytes to Sightengine via FormData
    const formData = new FormData();
    formData.append('models', 'deepfake');
    formData.append('api_user', apiUser);
    formData.append('api_secret', apiSecret);
    
    // Append the media file
    const blob = new Blob([buffer], { type: contentType });
    // Sightengine API expects the file parameter to be named 'media'
    formData.append('media', blob, 'media_file');

    const apiUrl = 'https://api.sightengine.com/1.0/check.json';
    const sightengineResponse = await fetch(apiUrl, {
      method: 'POST',
      body: formData,
    });

    const data = await sightengineResponse.json();

    if (!sightengineResponse.ok || data.status === 'failure') {
      console.error('Sightengine error:', data);
      return NextResponse.json({ error: data.error?.message || 'فشل في تحليل المحتوى' }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json({ error: 'حدث خطأ غير متوقع' }, { status: 500 });
  }
}
