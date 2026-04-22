const url = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQUtZdBGf-O1t9yGGmHGRmXSwaXzF_S2jDcAMksSsuhLQ&s=10';
const HIVE_SECRET_KEY = 'ZIhHc4spIyAthtJre1vB2A==';

async function test() {
  try {
    const res = await fetch('https://api.thehive.ai/api/v2/task/sync', {
      method: 'POST',
      headers: {
        Authorization: `Token ${HIVE_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    console.log("Status:", res.status);
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(err);
  }
}

test();
