async function run() {
  console.log("Checking API envs...");
  try {
    const res = await fetch("https://fakeradar-chi.vercel.app/api/analyze");
    const text = await res.text();
    console.log("GET:", text);
  } catch (e) {
    console.error("GET error", e);
  }

  console.log("Testing POST...");
  try {
    const res = await fetch("https://fakeradar-chi.vercel.app/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQUtZdBGf-O1t9yGGmHGRmXSwaXzF_S2jDcAMksSsuhLQ&s=10" })
    });
    const data = await res.json();
    console.log("POST:", data);
  } catch (e) {
    console.error("POST error", e);
  }
}
run();
