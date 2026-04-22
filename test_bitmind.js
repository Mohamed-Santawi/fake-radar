const url = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQUtZdBGf-O1t9yGGmHGRmXSwaXzF_S2jDcAMksSsuhLQ&s=10';
const BITMIND_API_KEY = 'bitmind-9b9d16b0-3de3-11f1-a1c7-3f3f9d2c673f:dac564b9';

async function test() {
  try {
    const endpoints = [
      'https://api.bitmindlabs.ai/detect-image',
      'https://api.bitmindlabs.ai/v1/detect/image',
      'https://api.bitmindlabs.ai/api/v1/detect-image',
    ];
    for (const ep of endpoints) {
      console.log("Testing", ep);
      try {
        const res = await fetch(ep, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${BITMIND_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ image: url }),
        });
        console.log("Status:", res.status);
        if (res.status !== 404 && res.status !== 403 && res.status !== 502 && res.status !== 504) {
          const data = await res.json();
          console.log("Data:", data);
          break;
        }
      } catch (err) {
        console.log("Error:", err.message);
      }
    }
  } catch (err) {
    console.error(err);
  }
}

test();
