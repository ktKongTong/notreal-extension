import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const background = readFileSync(new URL("./background.js", import.meta.url), "utf8");
const content = readFileSync(new URL("./content.js", import.meta.url), "utf8");
const imageUrl = "https://pbs.twimg.com/media/Example?format=jpg&name=large";

function serviceWorker(store, fetchMock) {
  let listener;
  const chrome = {
    runtime: { onMessage: { addListener: (fn) => { listener = fn; } } },
    storage: { local: {
      get: async (key) => ({ [key]: store.get(key) }),
      set: async (values) => { Object.entries(values).forEach(([k, v]) => store.set(k, v)); },
      remove: async (key) => { store.delete(key); },
    } },
    action: { setBadgeText() {}, setBadgeBackgroundColor() {}, setTitle() {} },
  };
  runInNewContext(background, { chrome, console, URL, Map, Date, AbortSignal, fetch: fetchMock });
  const send = (url = imageUrl) => new Promise((resolve) =>
    listener({ type: "NOTREAL_DETECT", imageUrl: url },
      { tab: { id: 1 }, url: "https://x.com/home" }, resolve));
  return { send };
}

test("browser cache avoids Worker requests across tabs and service-worker restarts", async () => {
  const store = new Map();
  let calls = 0;
  const fetchMock = async () => {
    calls++;
    return Response.json({
      style: { label: "realistic", probability: 0.98 }, synthid: "detected",
      checkedAt: new Date().toISOString(), cached: false,
    });
  };
  const worker = serviceWorker(store, fetchMock);
  const [first, second] = await Promise.all([worker.send(), worker.send()]);
  assert.equal(first.synthid, "detected");
  assert.equal(second.synthid, "detected");
  assert.equal(calls, 1);
  const hit = await serviceWorker(store, fetchMock).send();
  assert.equal(calls, 1);
  assert.equal(hit.cacheSource, "browser");
  assert.equal(hit.cached, true);
});

test("negative and skipped results are cached; stale results expire", async () => {
  for (const synthid of ["not_detected", "skipped"]) {
    const store = new Map();
    let calls = 0;
    const worker = serviceWorker(store, async () => {
      calls++;
      return Response.json({
        style: { label: "non_realistic", probability: 0.01 },
        synthid, checkedAt: new Date().toISOString(),
      });
    });
    await worker.send();
    assert.equal((await worker.send()).cacheSource, "browser");
    assert.equal(calls, 1);
  }
  const store = new Map();
  let calls = 0;
  const worker = serviceWorker(store, async () => {
    calls++;
    return Response.json({
      style: { label: "realistic", probability: 0.9 }, synthid: "not_detected",
      checkedAt: new Date(Date.now() - 8 * 864e5).toISOString(),
    });
  });
  await worker.send();
  await worker.send();
  assert.equal(calls, 2);
  assert.equal(store.size, 0);
});

test("X adapter only sends visible photos, never video posters or card images", async () => {
  class Element {}
  class HTMLImageElement extends Element {}
  const calls = [];
  let observer;
  const images = [
    { kind: "photo", href: "/status/1/photo/1", src: imageUrl },
    { kind: "video", href: null, src: imageUrl.replace("Example", "Video") },
    { kind: "card", href: null, src: imageUrl.replace("Example", "Card") },
    { kind: "avatar", href: null, src: "https://pbs.twimg.com/profile_images/test.jpg" },
  ].map((model) => {
    const article = { querySelector: (sel) => model.kind === "video" && sel.includes("videoPlayer") ? {} : null };
    const photo = {
      querySelector: (sel) => model.kind === "video" && sel.includes("playButton") ? {} :
        model.href && sel.includes("/photo/") ? {} : null,
      contains: () => true, classList: { add() {}, remove() {} },
      querySelectorAll: () => [],
    };
    const image = new HTMLImageElement();
    image.src = model.src;
    image.isConnected = true;
    image.closest = (selector) => {
      if (selector === "article") return article;
      if (selector.includes('data-testid="tweetPhoto"')) return ["photo", "video"].includes(model.kind) ? photo : null;
      if (selector.includes('data-testid="card.wrapper"')) return model.kind === "card" ? {} : null;
      if (selector.startsWith('a[href*="/photo/"]')) return model.href ? photo : null;
      return null;
    };
    image.getBoundingClientRect = () => ({ width: 300, height: 200, top: 10, bottom: 210, left: 10, right: 310 });
    image.matches = () => true;
    return image;
  });
  const document = {
    documentElement: {
      matches: () => false,
      querySelectorAll: () => images,
    },
    createElement: () => ({ className: "", textContent: "" }),
  };
  const chrome = {
    runtime: {
      sendMessage: (msg, cb) => {
        if (msg.type === "NOTREAL_DETECT") calls.push(msg.imageUrl);
        cb(msg.type === "NOTREAL_STATUS" ? { ok: true } : {
          style: { label: "non_realistic" }, synthid: "skipped",
        });
      },
      lastError: null,
    },
  };
  class IntersectionObserver {
    constructor(cb) { this.cb = cb; observer = this; this.elements = new Set(); }
    observe(el) { this.elements.add(el); }
    unobserve(el) { this.elements.delete(el); }
    fire() { this.cb([...this.elements].map((target) => ({ isIntersecting: true, target }))); }
  }
  class MutationObserver { observe() {} }
  runInNewContext(content, {
    console, URL, Map, WeakMap, chrome, Element, HTMLImageElement, document,
    IntersectionObserver, MutationObserver, innerHeight: 1000, innerWidth: 1000,
    getComputedStyle: () => ({ position: "relative" }),
  });
  assert.equal(observer.elements.size, 1, "only actual post photo observed");
  observer.fire();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1);
  assert.equal(calls[0], imageUrl);
});
