# NotReal image detection Worker

Single Worker, no browser extension or login. Public endpoint:

```http
POST /detect
Content-Type: application/json

{"imageUrl":"https://example.com/photo.jpg"}
```

Response on success:

```json
{
  "style": { "label": "realistic", "probability": 0.91 },
  "synthid": "detected",
  "checkedAt": "2026-10-27T12:00:00.000Z",
  "cached": false
}
```

- Cloudflare Clef-flash (`@cf/cloudflare/clef-flash`) evaluates **actual image bytes**. A deliberately permissive 0.25 threshold sends ambiguous images to verification.
- Realistic images go to OpenAI Content Provenance API's **SynthID** check. It only recognizes supported OpenAI provenance, **not all AI images or Google's complete SynthID ecosystem**. `not_detected` does **not** imply real.
- Obvious illustrations return `synthid: "skipped"`.
- Workers KV caches results globally for 7 days by SHA-256 of the canonical image URL. Cache is anonymous and shared by all clients, with eventual consistency. A different URL or changed bytes behind the same URL are not deduplicated/invalidated.
- Accepted remote images: public HTTPS PNG, JPEG, WebP, up to 4 MiB; redirects and IP-address hosts are rejected. Requests containing private/signed image URLs should not be sent to this public service.
- `GET /health` checks the endpoint. The service provides permissive CORS for browser extensions.

## Deploy through Cloudflare (Git integration)

This repository is deployed by **Cloudflare Workers Builds**, not GitHub Actions.
For the existing `notreal-extension` Worker, open
**Cloudflare Dashboard → Workers & Pages → notreal-extension → Settings → Builds**.
Configure:

- **Git repository:** `ktKongTong/notreal-extension`
- **Production branch:** `main`
- **Root directory:** `worker` (relative to repository root)
- **Build command:** leave empty (Wrangler bundles the TypeScript directly)
- **Deploy command:** `npx wrangler deploy`
- **Preview command:** use the Cloudflare default, `npx wrangler preview`

Save and redeploy the latest commit in Cloudflare Builds. The configuration at
`worker/wrangler.jsonc` sets the Worker name to `notreal-extension`, enables
`workers.dev` and preview URLs, binds Workers AI as `AI`, and binds KV as
`CACHE` with namespace `4022b3395e914b438eeea28ab6646845`.
Create `OPENAI_API_KEY` under **Settings → Variables and Secrets** on this Worker;
it is a **runtime secret**, not a build secret, and must not be committed.

After Cloudflare has deployed the revision, check
`https://notreal-extension.koft.workers.dev/health`.
The expected response is `{"ok":true,"version":"diagnostics-v2"}`. A `Hello world` response means the
Cloudflare dashboard starter Worker is still deployed, not this repository code.

Errors now include `stage` and `requestId`. Look up the request ID in
**Workers & Pages → notreal-extension → Observability → Logs**, filtering
for `event: detection_error`. Logs are enabled at 100% sampling in Wrangler
and omit request URLs and credentials. The response never exposes provider
exception details; check the corresponding structured log for the cause.

The Cloudflare account must have Workers AI enabled and the OpenAI API
organization must have access to Content Provenance checks (404 can indicate
missing access). If the endpoint is public, use Cloudflare rate limiting/WAF
to protect the Workers AI and OpenAI API quotas.

Cloudflare docs: https://developers.cloudflare.com/workers-ai/models/clef-flash/

OpenAI docs: https://developers.openai.com/api/docs/guides/content-provenance
