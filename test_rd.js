const url = 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQUtZdBGf-O1t9yGGmHGRmXSwaXzF_S2jDcAMksSsuhLQ&s=10';
const REALITY_DEFENDER_API_KEY = 'rd_40034a4b22e6b521_a3f2bfae791d57a8d7bcfaec0a746f96';

async function test() {
  const res = await fetch(url);
  const bytes = Buffer.from(await res.arrayBuffer());
  
  const presignRes = await fetch('https://api.prd.realitydefender.xyz/api/files/aws-presigned', {
    method: 'POST',
    headers: { 'X-API-KEY': REALITY_DEFENDER_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: 'test.jpg' }),
  });
  
  const presignData = await presignRes.json();
  const signedUrl = presignData?.response?.signedUrl;
  const requestId = presignData?.response?.requestId ?? presignData?.requestId;
  
  console.log("Presign HTTP:", presignRes.status);
  
  if (!signedUrl) return console.log("Failed presign");

  await fetch(signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: bytes,
  });
  
  console.log("Uploaded, polling...");
  
  for (let i = 0; i < 5; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const pollRes = await fetch(`https://api.prd.realitydefender.xyz/api/media/users/${requestId}`, {
      headers: { 'X-API-KEY': REALITY_DEFENDER_API_KEY }
    });
    const pollData = await pollRes.json();
    console.log("Poll status:", pollData?.resultsSummary?.status, pollData?.resultsSummary?.metadata?.finalScore);
    if (['AUTHENTIC', 'FAKE', 'SUSPICIOUS', 'NOT_APPLICABLE', 'UNABLE_TO_EVALUATE'].includes(pollData?.resultsSummary?.status)) {
      break;
    }
  }
}

test();
