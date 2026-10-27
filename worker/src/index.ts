type Env = {
  AI: { run(model: string, input: Record<string, unknown>): Promise<unknown> };
  CACHE: {
    get(key: string, type: "json"): Promise<unknown>;
    put(key: string, value: string, options: { expirationTtl: number }): Promise<void>;
  };
  OPENAI_API_KEY: string;
};

type Detection = {
  style: { label: "realistic" | "non_realistic"; probability: number };
  synthid: "detected" | "not_detected" | "skipped";
  checkedAt: string;
};

const MODEL = "@cf/cloudflare/clef-flash";
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const CACHE_TTL = 7 * 24 * 60 * 60;
const REALISTIC_THRESHOLD = 0.25; // Favor recall: ambiguous images proceed to SynthID.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, GET, OPTIONS",
  "access-control-allow-headers": "Content-Type",
};

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function json(value: unknown, status = 200, cache?: string): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...CORS,
      "content-type": "application/json; charset=utf-8",
      ...(cache ? { "x-cache": cache } : {}),
    },
  });
}

function parseImageUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new HttpError(400, "invalid_image_url");
  }
  const host = url.hostname;
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    !host.includes(".") ||
    /(^localhost$|\.localhost$|\.local$|\.internal$|^\d+(?:\.\d+){3}$|:)/i.test(host)
  ) {
    throw new HttpError(400, "public_https_url_required");
  }
  url.hash = "";
  return url;
}

async function cacheKey(url: URL): Promise<string> {
  const bytes = new TextEncoder().encode(url.href);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return "image:v1:" + Array.from(hash, (n) => n.toString(16).padStart(2, "0")).join("");
}

async function downloadImage(url: URL): Promise<{ bytes: Uint8Array; mime: string }> {
  const response = await fetch(url.href, {
    redirect: "error",
    headers: { Accept: "image/png,image/jpeg,image/webp" },
  });
  if (!response.ok) throw new HttpError(422, "image_fetch_failed");

  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  const mime = contentType === "image/jpg" ? "image/jpeg" : contentType;
  if (!mime || !["image/png", "image/jpeg", "image/webp"].includes(mime)) {
    throw new HttpError(415, "unsupported_image_type");
  }
  if (Number(response.headers.get("content-length")) > MAX_IMAGE_BYTES) {
    throw new HttpError(413, "image_too_large");
  }

  const reader = response.body?.getReader();
  if (!reader) throw new HttpError(422, "empty_image");
  const parts: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_IMAGE_BYTES) {
      await reader.cancel();
      throw new HttpError(413, "image_too_large");
    }
    parts.push(value);
  }
  if (!length) throw new HttpError(422, "empty_image");

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return { bytes, mime };
}

function base64(bytes: Uint8Array): string {
  let result = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    result += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(result);
}

async function classifyStyle(env: Env, image: { bytes: Uint8Array; mime: string }): Promise<number> {
  const result = (await env.AI.run(MODEL, {
    model: "clef-flash",
    state: "Evaluate the visual content of the attached image, not its URL or provenance.",
    images: [{ content_type: image.mime, base64: base64(image.bytes) }],
    questions: {
      realistic: {
        type: "noul",
        instructions:
          "Could this image plausibly be mistaken for a real-world photograph, a photographed " +
          "physical object, a document, a social-media screenshot, or evidence of a real event? " +
          "Include realistic synthetic scenes and images of printed pages. Exclude obvious " +
          "cartoons, anime illustrations, icons, and abstract art.",
        criteria: {
          true: "Looks like documentary, photographic, or real-world evidence.",
          false: "Obviously illustrated, fictional, or abstract visual art.",
        },
      },
    },
  })) as { answers?: { realistic?: { noul?: number } } };

  const probability = result.answers?.realistic?.noul;
  if (typeof probability !== "number" || !Number.isFinite(probability) ||
      probability < 0 || probability > 1) {
    throw new HttpError(502, "style_model_invalid_response");
  }
  return probability;
}

async function checkSynthId(env: Env, image: { bytes: Uint8Array; mime: string }) {
  if (!env.OPENAI_API_KEY) throw new HttpError(503, "openai_key_not_configured");
  const form = new FormData();
  const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[
    image.mime as "image/png" | "image/jpeg" | "image/webp"
  ];
  form.append("file", new Blob([image.bytes.buffer as ArrayBuffer], { type: image.mime }), `image.${extension}`);

  const response = await fetch("https://api.openai.com/v1/content_provenance_checks", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form,
  });
  if (!response.ok) throw new HttpError(502, `provenance_api_http_${response.status}`);
  const payload = (await response.json()) as {
    results?: { type: string; outcome: string }[];
  };
  const synthid = payload.results?.find((item) => item.type === "synthid")?.outcome;
  if (synthid !== "detected" && synthid !== "not_detected") {
    throw new HttpError(502, "provenance_api_invalid_response");
  }
  return synthid;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const pathname = new URL(request.url).pathname;
    if (pathname === "/health" && request.method === "GET") return json({ ok: true, version: "diagnostics-v2" });
    if (pathname !== "/detect") return json({ error: "not_found" }, 404);
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    const requestId = crypto.randomUUID();
    let stage = "parse_request";
    try {
      const body = (await request.json().catch(() => null)) as { imageUrl?: unknown } | null;
      if (!body || typeof body.imageUrl !== "string" || body.imageUrl.length > 4096) {
        throw new HttpError(400, "imageUrl_required");
      }
      const url = parseImageUrl(body.imageUrl);
      stage = "cache_read";
      const key = await cacheKey(url);
      const cached = (await env.CACHE.get(key, "json")) as Detection | null;
      if (cached) return json({ ...cached, cached: true }, 200, "HIT");

      stage = "image_download";
      const image = await downloadImage(url);
      stage = "style_classification";
      const probability = await classifyStyle(env, image);
      const realistic = probability >= REALISTIC_THRESHOLD;
      stage = realistic ? "synthid_verification" : "cache_write";
      const detection: Detection = {
        style: {
          label: realistic ? "realistic" : "non_realistic",
          probability: Math.round(probability * 10000) / 10000,
        },
        synthid: realistic ? await checkSynthId(env, image) : "skipped",
        checkedAt: new Date().toISOString(),
      };
      stage = "cache_write";
      await env.CACHE.put(key, JSON.stringify(detection), { expirationTtl: CACHE_TTL });
      return json({ ...detection, cached: false }, 200, "MISS");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const safeMessage = message.replace(/https?:\\/\\/\\S+/g, "[url]")
        .replace(/Bearer\\s+\\S+/gi, "Bearer [redacted]").slice(0, 500);
      console.error({
        event: "detection_error",
        requestId,
        stage,
        error: error instanceof Error ? error.name : "UnknownError",
        message: safeMessage,
      });
      const status = error instanceof HttpError ? error.status : 502;
      return json({
        error: error instanceof HttpError ? error.message : "detection_failed",
        stage,
        requestId,
      }, status);
    }
  },
};
