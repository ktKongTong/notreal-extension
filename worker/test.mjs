import test from "node:test";
import assert from "node:assert/strict";
import handler from "./src/index.ts";

function env(probability) {
  const store = new Map();
  const counts = { model: 0, cacheRead: 0, cacheWrite: 0 };
  return {
    counts,
    AI: {
      async run(_model, request) {
        counts.model++;
        assert.equal(request.images[0].content_type, "image/png");
        assert.ok(request.images[0].base64);
        return { answers: { realistic: { noul: probability } } };
      },
    },
    CACHE: {
      async get(key) {
        counts.cacheRead++;
        return store.get(key) ?? null;
      },
      async put(key, value) {
        counts.cacheWrite++;
        store.set(key, JSON.parse(value));
      },
    },
    OPENAI_API_KEY: "test-only",
  };
}

const input = "https://images.example.com/a.png";
const request = () => new Request("https://notreal.test/detect", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ imageUrl: input }),
});
const image = () => new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]), {
  headers: { "content-type": "image/png" },
});
test("rejects non-public URLs", async () => {
  const response = await handler.fetch(new Request("https://notreal.test/detect", {
    method: "POST",
    body: JSON.stringify({ imageUrl: "http://127.0.0.1/p.png" }),
  }), env(0.9));
  assert.equal(response.status, 400);
});
test("stylized images skip SynthID and cache results for other users", async () => {
  const previous = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return image();
  };
  try {
    const bindings = env(0.05);
    const first = await handler.fetch(request(), bindings);
    assert.equal(first.status, 200);
    assert.equal((await first.json()).synthid, "skipped");
    const second = await handler.fetch(request(), bindings);
    assert.equal((await second.json()).cached, true);
    assert.equal(second.headers.get("x-cache"), "HIT");
    assert.deepEqual(calls, [input]);
    assert.equal(bindings.counts.model, 1);
    assert.equal(bindings.counts.cacheWrite, 1);
  } finally {
    globalThis.fetch = previous;
  }
});
test("realistic images call OpenAI once and share detected watermark", async () => {
  const previous = globalThis.fetch;
  let synthidCalls = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url) === input) return image();
    assert.equal(String(url), "https://api.openai.com/v1/content_provenance_checks");
    assert.equal(options.method, "POST");
    assert.ok(options.body instanceof FormData);
    synthidCalls++;
    return Response.json({
      results: [
        { type: "c2pa", outcome: "not_detected" },
        { type: "synthid", outcome: "detected" },
      ],
    });
  };
  try {
    const bindings = env(0.87);
    const first = await handler.fetch(request(), bindings);
    assert.equal(first.status, 200);
    const result = await first.json();
    assert.equal(result.style.label, "realistic");
    assert.equal(result.synthid, "detected");
    assert.equal((await (await handler.fetch(request(), bindings)).json()).cached, true);
    assert.equal(synthidCalls, 1);
  } finally {
    globalThis.fetch = previous;
  }
});

test("reports model failures with a request ID and diagnostic stage", async () => {
  const previousFetch = globalThis.fetch;
  const previousError = console.error;
  const errors = [];
  globalThis.fetch = async () => image();
  console.error = (entry) => errors.push(entry);
  try {
    const bindings = env(0.8);
    bindings.AI.run = async () => { throw new Error("mock inference outage"); };
    const response = await handler.fetch(request(), bindings);
    assert.equal(response.status, 502);
    const result = await response.json();
    assert.equal(result.error, "detection_failed");
    assert.equal(result.stage, "style_classification");
    assert.match(result.requestId, /^[\da-f-]{36}$/);
    assert.equal(errors[0].requestId, result.requestId);
    assert.equal(errors[0].stage, result.stage);
    assert.equal(errors[0].message, "mock inference outage");
  } finally {
    globalThis.fetch = previousFetch;
    console.error = previousError;
  }
});

test("reports upstream provenance HTTP errors without caching", async () => {
  const previousFetch = globalThis.fetch;
  const previousError = console.error;
  globalThis.fetch = async (url) => String(url) === input ? image() : new Response("rate limited", { status: 429 });
  console.error = () => {};
  try {
    const bindings = env(0.9);
    const response = await handler.fetch(request(), bindings);
    assert.equal(response.status, 502);
    const result = await response.json();
    assert.equal(result.error, "provenance_api_http_429");
    assert.equal(result.stage, "synthid_verification");
    assert.equal(bindings.counts.cacheWrite, 0);
  } finally {
    globalThis.fetch = previousFetch;
    console.error = previousError;
  }
});
test("reports upstream image HTTP status instead of hiding it", async () => {
  const previous = globalThis.fetch, logger = console.error;
  globalThis.fetch = async (_url, options) => { assert.equal(options.redirect, "manual"); return new Response("", { status: 403 }); };
  console.error = () => {};
  try {
    const response = await handler.fetch(request(), env(0.8)), body = await response.json();
    assert.equal(response.status, 422); assert.equal(body.error, "image_fetch_http_403"); assert.equal(body.stage, "image_download");
  } finally { globalThis.fetch = previous; console.error = logger; }
});

test("follows a 307 redirect to an image", async () => {
  const original = globalThis.fetch, calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(String(url));
    assert.equal(options.redirect, "manual");
    return calls.length === 1
      ? new Response(null, { status: 307, headers: { location: "/redirected.png" } })
      : image();
  };
  try {
    const response = await handler.fetch(request(), env(0.05));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).synthid, "skipped");
    assert.deepEqual(calls, [input, "https://images.example.com/redirected.png"]);
  } finally { globalThis.fetch = original; }
});

test("does not follow redirects to non-public URLs", async () => {
  const original = globalThis.fetch, logger = console.error;
  globalThis.fetch = async () => new Response(null, {
    status: 307, headers: { location: "http://127.0.0.1/private.png" },
  });
  console.error = () => {};
  try {
    const response = await handler.fetch(request(), env(0.8));
    assert.equal((await response.json()).error, "public_https_url_required");
  } finally { globalThis.fetch = original; console.error = logger; }
});

test("detects PNG bytes even with a generic Content-Type", async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => new Response(new Uint8Array([137,80,78,71,13,10,26,10,1]), {
    headers: { "content-type": "application/octet-stream" },
  });
  try {
    const response = await handler.fetch(request(), env(0.05));
    assert.equal(response.status, 200);
  } finally { globalThis.fetch = previous; }
});

test("does not classify an HTML page as an image", async () => {
  const previous = globalThis.fetch, logger = console.error;
  globalThis.fetch = async () => new Response("<html>challenge</html>", { headers: { "content-type": "text/html" } });
  console.error = () => {};
  try {
    const response = await handler.fetch(request(), env(0.05));
    const body = await response.json();
    assert.equal(response.status, 415);
    assert.equal(body.error, "unsupported_image_type_text_html");
    assert.equal(body.stage, "image_download");
  } finally { globalThis.fetch = previous; console.error = logger; }
});
