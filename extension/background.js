const API = "https://notreal-extension.koft.workers.dev/detect";
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const PREFIX = "notreal:result:v1:";
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
        !/^\/media\/[\w-]+(?:\.\w+)?$/.test(url.pathname)) throw new Error("invalid_image_url");
    url.hash = "";
    if (url.searchParams.has("name")) url.searchParams.set("name", "large");
    imageUrl = url.href;
  } catch {
    reply({ error: "invalid_image_url" });
    return;
  }

  if (!inFlight.has(imageUrl)) {
    const task = (async () => {
      const key = PREFIX + imageUrl;
      try {
        const cached = (await chrome.storage.local.get(key))[key];
        if (cached?.expiresAt > Date.now()) {
          console.info("[NotReal] Browser cache hit", new URL(imageUrl).pathname);
          return { ...cached.result, cached: true, cacheSource: "browser" };
        }
        if (cached) await chrome.storage.local.remove(key);
      } catch (error) {
        console.warn("[NotReal] Browser cache unavailable", error);
      }

      console.info("[NotReal] Worker request", new URL(imageUrl).pathname);
      const response = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl }),
        signal: AbortSignal.timeout(60000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error((result.error ?? "http_" + response.status) + " (" + (result.stage ?? "api") + "; " + (result.requestId ?? "no-id") + ")");
      console.info("[NotReal] Result", { style: result.style?.label, synthid: result.synthid, cached: result.cached });

      const expiresAt = Date.parse(result.checkedAt) + CACHE_TTL;
      if (result.style?.label && ["detected", "not_detected", "skipped"].includes(result.synthid) &&
          Number.isFinite(expiresAt) && expiresAt > Date.now()) {
        try {
          await chrome.storage.local.set({ [key]: {
            expiresAt, result: { style: result.style, synthid: result.synthid, checkedAt: result.checkedAt },
          } });
        } catch (error) {
          console.warn("[NotReal] Browser cache write failed", error);
        }
      }
      return result;
    })().finally(() => inFlight.delete(imageUrl));
    inFlight.set(imageUrl, task);
  }

  inFlight.get(imageUrl).then(reply, (error) => {
    console.warn("[NotReal] Detection failed", error.message);
    reply({ error: "detection_failed", detail: error.message });
  });
  return true;
});
