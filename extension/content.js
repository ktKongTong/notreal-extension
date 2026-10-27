(() => {
  const PHOTO_SELECTOR = 'article [data-testid="tweetPhoto"] img';
  const observed = new WeakMap();
  const results = new Map();
  const queue = [];
  let active = 0;

  function photoUrl(img) {
    try {
      const url = new URL(img.currentSrc || img.src);
      if (url.protocol !== "https:" || url.hostname !== "pbs.twimg.com" ||
          !/^\/media\/[\w-]+(?:\.[\w]+)?$/.test(url.pathname)) return null;
      url.hash = "";
      if (url.searchParams.has("name")) url.searchParams.set("name", "large");
      return url.href;
    } catch { return null; }
  }

  function candidate(img) {
    const photo = img.closest('[data-testid="tweetPhoto"]');
    if (!photo?.closest("article") || photo.closest('[data-testid="videoPlayer"], [data-testid="videoComponent"]')) return null;
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
    badge.title = "检测到 SynthID 水印，图片具有现实风格";
    photo.append(badge);
  }

  function visible(img) {
    const rect = img.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 &&
      rect.top < innerHeight && rect.left < innerWidth;
  }

  function drain() {
    while (active < 2 && queue.length) {
      const { img, url, photo } = queue.shift();
      if (!img.isConnected || !visible(img) || observed.get(img) !== url) continue;
      active++;
      const response = results.get(url) || new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "NOTREAL_DETECT", imageUrl: url },
          (result) => resolve(chrome.runtime.lastError ? null : result));
      });
      results.set(url, response);
      response.then((result) => {
        if (!result || result.error) { results.delete(url); return; }
        if (img.isConnected && photo.contains(img) && observed.get(img) === url &&
            result.style?.label === "realistic" && result.synthid === "detected") mark(photo);
        if (results.size > 500) results.delete(results.keys().next().value);
      }).finally(() => { active--; drain(); });
    }
  }

  const viewport = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      viewport.unobserve(entry.target);
      const item = candidate(entry.target);
      if (item && observed.get(entry.target) === item.url) {
        queue.push({ img: entry.target, ...item });
      }
    }
    drain();
  }, { threshold: 0.1 });

  function track(img) {
    const item = candidate(img);
    const url = item?.url;
    if (observed.get(img) === url) return;
    const photo = img.closest('[data-testid="tweetPhoto"]');
    photo?.classList.remove("notreal-ai-photo");
    photo?.querySelector(":scope > .notreal-label")?.remove();
    observed.set(img, url);
    viewport.unobserve(img);
    if (url) viewport.observe(img);
  }

  function scan(node) {
    if (!(node instanceof Element)) return;
    if (node.matches(PHOTO_SELECTOR)) track(node);
    node.querySelectorAll(PHOTO_SELECTOR).forEach(track);
  }

  scan(document.body);
  new MutationObserver((changes) => {
    for (const change of changes) {
      if (change.type === "attributes") track(change.target);
      else for (const node of change.addedNodes) scan(node);
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["src", "srcset"] });
})();
