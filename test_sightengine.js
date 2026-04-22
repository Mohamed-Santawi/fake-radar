const url = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQUtZdBGf-O1t9yGGmHGRmXSwaXzF_S2jDcAMksSsuhLQ&s=10';
const SIGHTENGINE_API_USER = '1748863649';
const SIGHTENGINE_API_SECRET = 'SQ7eE8vzrTC5rQRqNo3w9vR5Lbpr7G4r';

async function test() {
  try {
    const form = new FormData();
    form.append('url', url);
    form.append('models', 'genai,deepfake');
    form.append('api_user', SIGHTENGINE_API_USER);
    form.append('api_secret', SIGHTENGINE_API_SECRET);

    const res = await fetch('https://api.sightengine.com/1.0/check.json', { method: 'POST', body: form });
    const data = await res.json();
    console.log("Status:", res.status);
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(err);
  }
}

test();
