# NotReal detection Worker

Single Cloudflare Worker; no login and no separate backend.

## API

`POST /detect` with `Content-Type: application/json`:

```json
{"imageUrl":"https://pbs.twimg.com/media/example.jpg"}
```

Returns `style.label`, `style.probability`, `synthid` (`detected`,
`not_detected`, or `skipped`), `checkedAt`, and `cached`.
`GET /health` returns `{"ok":true,"version":"diagnostics-v2"}`.

## Pipeline

- Accepts public HTTPS PNG/JPEG/WebP up to 4 MiB; follows at most 3 HTTPS
  redirects, validating each destination.
- Clef-flash uses the image bytes to classify realism (threshold 0.25).
- Realistic images use OpenAI Content Provenance SynthID verification; this
  is **not** universal AI detection. No watermark does not mean real.
- KV caches detections for 7 days by the initial image URL hash. Shared by
  anonymous users; changes behind the same URL are not automatically refreshed.

## Cloudflare Git deployment

Connect `ktKongTong/notreal-extension` (branch `main`) in Workers Builds.
Set **Root directory** to `worker`, **Build command** empty, and
**Deploy command** to `npx wrangler deploy`. No GitHub Actions is required.
The Wrangler config supplies the Worker name, AI and KV bindings, and declares
`OPENAI_API_KEY` as a required **runtime Secret**. Set its encrypted value in
**Worker → Settings → Variables and Secrets**, not in Git.

Deploy and check `https://notreal-extension.koft.workers.dev/health`.
For failures, use `stage` and `requestId` from the JSON response to find
`detection_error` in **Worker → Observability → Logs**. Set rate limits on
this public endpoint to protect your AI/API quotas.

Docs: https://developers.cloudflare.com/workers/wrangler/configuration/
