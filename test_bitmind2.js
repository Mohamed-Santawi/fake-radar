const url = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQUtZdBGf-O1t9yGGmHGRmXSwaXzF_S2jDcAMksSsuhLQ&s=10';
const BITMIND_API_KEY = 'bitmind-9b9d16b0-3de3-11f1-a1c7-3f3f9d2c673f:dac564b9';

async function test() {
  try {
    const res = await fetch('https://api.bitmind.ai/detect-image', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${BITMIND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ image: url }),
    });
    console.log("Status:", res.status);
    const data = await res.json();
    console.log("Data:", data);
  } catch (err) {
    console.error(err);
  }
}

test();
