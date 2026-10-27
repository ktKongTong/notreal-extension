const API = "https://notreal-extension.koft.workers.dev/detect";
const inFlight = new Map();

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!message?.type) return;
  if (!sender.tab?.id || !sender.url?.startsWith("https://x.com/")) {
    reply({ error: "unsupported_sender" });
    return;
  }

  if (message.type === "NOTREAL_STATUS") {
    const stats = message.stats ?? {};
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: "X" });
    chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: "#64748b" });
    chrome.action.setTitle({
      tabId: sender.tab.id,
      title: "NotReal · X 已适配 · 识别 " + (stats.found ?? 0) + " · 检测 " + (stats.sent ?? 0) + " · 标记 " + (stats.marked ?? 0),
    });
    reply({ ok: true });
    return;
  }
  if (message.type !== "NOTREAL_DETECT") return;

  let imageUrl;
  try {
    const url = new URL(message.imageUrl);
    if (url.protocol !== "https:" || url.hostname !== "pbs.twimg.com" ||
        !url.pathname.startsWith("/media/")) throw new Error("invalid_image_url");
    imageUrl = url.href;
  } catch {
    reply({ error: "invalid_image_url" });
    return;
  }

  console.info("[NotReal] Request", new URL(imageUrl).pathname);
  if (!inFlight.has(imageUrl)) {
    const task = fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl }),
      signal: AbortSignal.timeout(60000),
    }).then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error((result.error ?? "http_" + response.status) + " (" + (result.stage ?? "api") + "; " + (result.requestId ?? "no-id") + ")");
      console.info("[NotReal] Result", { style: result.style?.label, synthid: result.synthid, cached: result.cached });
      return result;
    }).finally(() => inFlight.delete(imageUrl));
    inFlight.set(imageUrl, task);
  }
  inFlight.get(imageUrl).then(reply, (error) => {
    console.warn("[NotReal] Detection failed", error.message);
    reply({ error: "detection_failed", detail: error.message });
  });
  return true;
});
