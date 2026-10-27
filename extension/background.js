const API = "https://notreal-extension.koft.workers.dev/detect";
const inFlight = new Map();

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== "NOTREAL_DETECT" || !sender.url?.startsWith("https://x.com/")) return;
  let imageUrl;
  try {
    const url = new URL(message.imageUrl);
    if (url.protocol !== "https:" || url.hostname !== "pbs.twimg.com" || !url.pathname.startsWith("/media/")) return;
    imageUrl = url.href;
  } catch { return; }

  if (!inFlight.has(imageUrl)) {
    const task = fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl }),
      signal: AbortSignal.timeout(30000),
    }).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error((result.error || "HTTP " + response.status) + " (" + (result.stage || "api") + ")");
      return result;
    }).finally(() => inFlight.delete(imageUrl));
    inFlight.set(imageUrl, task);
  }
  inFlight.get(imageUrl).then(reply, (error) => {
    console.warn("[NotReal] Detection failed:", error.message);
    reply({ error: "detection_failed" });
  });
  return true;
});
