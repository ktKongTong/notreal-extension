# NotReal image detection Worker

`POST /detect` with JSON `{"imageUrl":"https://example.com/photo.jpg"}`; `GET /health` checks deployment. Response includes `style`, `synthid`, `checkedAt`, `cached`.
Accepts public HTTPS images up to 4 MiB and 3 redirects; checks actual PNG/JPEG/WebP bytes, not just `Content-Type`. If the CDN serves HTML or an unsupported format, the error includes its MIME type.
Cloudflare Clef-flash scores realism (0.25 threshold). Realistic images use OpenAI's Content Provenance SynthID check; `not_detected` does NOT prove an image is real.
Results are shared across anonymous users via 7-day Workers KV cache, keyed by the original image URL.
Cloudflare Workers Builds: connect `ktKongTong/notreal-extension` (`main`), set root directory `worker`, leave build command empty, deploy with `npx wrangler deploy`. No GitHub Actions.
Bindings: `AI`, KV `CACHE` (`4022b3395e914b438eeea28ab6646845`), and the required runtime secret `OPENAI_API_KEY`. Set the key under Worker Settings → Variables and Secrets; never commit it.
Check `https://notreal-extension.koft.workers.dev/health`. Errors include `stage` and `requestId`; use Worker → Observability → Logs for details. Protect this public endpoint with rate limiting.
