(() => {
  const SELECTOR = 'article img[src*="pbs.twimg.com/media/"]';
  const VIDEO = '[data-testid="videoPlayer"],[data-testid="videoComponent"],[data-testid="playButton"],[data-testid="previewInterstitial"],[data-testid="videoPlayerOverlay"],[data-testid="videoPlayerControls"],video,a[href*="/video/"],[aria-label="Play"],[aria-label="Play video"]';
  const CARD = '[data-testid="card.wrapper"],[data-testid^="card."], [data-testid="Tweet-User-Avatar"]';
  const observed = new WeakMap();
  const results = new Map();
  const queue = [];
  const stats = { found: 0, sent: 0, marked: 0 };
  let active = 0;

  const report = () => chrome.runtime.sendMessage({ type: "NOTREAL_STATUS", stats },
    () => { void chrome.runtime.lastError; });

  function photoUrl(img) {
    try {
      const url = new URL(img.src || img.currentSrc);
      if (url.protocol !== "https:" || url.hostname !== "pbs.twimg.com" ||
          !/^\/media\/[\w-]+(?:\.[\w]+)?$/.test(url.pathname)) return null;
      url.hash = "";
      if (url.searchParams.has("name")) url.searchParams.set("name", "large");
      return url.href;
    } catch { return null; }
  }

  function candidate(img) {
    if (!(img instanceof HTMLImageElement) || img.closest(CARD)) return null;
    const article = img.closest("article");
    const photo = img.closest('[data-testid="tweetPhoto"]') || img.closest('a[href*="/photo/"]');
    if (!article || !photo || img.closest(VIDEO) || photo.querySelector(VIDEO)) return null;
    // X also uses tweetPhoto for video/GIF posters; a play control elsewhere in that post
    // disqualifies ambiguous media, but an explicit /photo/ link stays eligible.
    const linkedPhoto = img.closest('a[href*="/photo/"]') ||
      photo.querySelector('a[href*="/photo/"]');
    if (!linkedPhoto && article.querySelector(VIDEO)) return null;
    const url = photoUrl(img);
    return url ? { photo, url } : null;
  }

  function mark(photo) {
    if (photo.querySelector(":scope > .notreal-label")) return;
    if (getComputedStyle(photo).position === "static") photo.style.position = "relative";
    photo.classList.add("notreal-ai-photo");
    const badge = document.createElement("span");
    badge.className = "notreal-label";
    badge.textContent = "✦ AI 生成";
    badge.title = "已检测到 SynthID，图片具有现实风格";
    photo.append(badge);
    stats.marked++;
    report();
  }

  function visible(img) {
    const r = img.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 &&
      r.top < innerHeight && r.left < innerWidth;
  }

  function drain() {
    while (active < 2 && queue.length) {
      const { img, photo, url } = queue.shift();
      if (!img.isConnected || observed.get(img)?.url !== url) continue;
      if (!candidate(img)) continue; // Video controls may appear after the image was queued.
      if (!visible(img)) { viewport.observe(img); continue; }
      active++;
      let result = results.get(url);
      if (!result) {
        stats.sent++;
        report();
        console.info("[NotReal] Detect visible photo", new URL(url).pathname);
        result = new Promise((resolve) => chrome.runtime.sendMessage(
          { type: "NOTREAL_DETECT", imageUrl: url },
          (reply) => {
            const error = chrome.runtime.lastError;
            resolve(error ? { error: error.message } : reply ?? { error: "empty_response" });
          }
        ));
        results.set(url, result);
      }
      result.then((data) => {
        if (data.error) {
          results.delete(url);
          console.warn("[NotReal] Detection error", data.error, data.detail ?? "");
          return;
        }
        console.info("[NotReal] Detection complete", { style: data.style?.label, synthid: data.synthid, cached: data.cached });
        if (img.isConnected && photo.contains(img) && observed.get(img)?.url === url &&
            data.style?.label === "realistic" && data.synthid === "detected") mark(photo);
        if (results.size > 300) results.delete(results.keys().next().value);
      }).finally(() => { active--; drain(); });
    }
  }

  const viewport = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      viewport.unobserve(entry.target);
      const item = candidate(entry.target);
      if (item && observed.get(entry.target)?.url === item.url)
        queue.push({ img: entry.target, ...item });
    }
    drain();
  }, { threshold: 0.01 });

  function track(img) {
    const item = candidate(img);
    const previous = observed.get(img);
    if (previous?.url === item?.url && previous?.photo === item?.photo) return;
    previous?.photo.classList.remove("notreal-ai-photo");
    previous?.photo.querySelector(":scope > .notreal-label")?.remove();
    viewport.unobserve(img);
    observed.set(img, item);
    if (item) {
      stats.found++;
      if (stats.found <= 5) console.info("[NotReal] X post photo found", new URL(item.url).pathname);
      viewport.observe(img);
      report();
    }
  }

  function scan(node) {
    if (!(node instanceof Element)) return;
    if (node.matches(SELECTOR)) track(node);
    node.querySelectorAll(SELECTOR).forEach(track);
  }

  console.info("[NotReal] X adapter active (v0.1.2)");
  report();
  scan(document.documentElement);
  new MutationObserver((changes) => {
    for (const change of changes) {
      if (change.type === "attributes") track(change.target);
      else for (const node of change.addedNodes) scan(node);
    }
  }).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ["src", "srcset"],
  });
})();
