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

## Deploy

Worker name: `notreal-extension`; public development URL:
`https://notreal-extension.koft.workers.dev`. Version preview URLs are enabled.

The `CACHE` binding is configured for KV namespace
`4022b3395e914b438eeea28ab6646845`; you do not need to recreate it.

```sh
cd worker
npm install
npx wrangler login
npx wrangler secret put OPENAI_API_KEY
npm run check && npm test
npm run deploy
curl -fsS https://notreal-extension.koft.workers.dev/health
```

Expected health response: `{"ok":true}`. A `Hello world` response means that
Cloudflare is still serving the dashboard scaffold rather than this code.
Use the exact Worker name `notreal-extension`, not `notreal-detect`.

To deploy with GitHub Actions, set repository secrets `CLOUDFLARE_API_TOKEN`
and `CLOUDFLARE_ACCOUNT_ID`. The workflow runs tests and a Wrangler dry-run
on every push, then deploys when both secrets are set. Set
`OPENAI_API_KEY` separately as a **Cloudflare Worker secret**. Never commit it.

The Cloudflare account must have Workers AI enabled and the OpenAI API
organization must have access to Content Provenance checks (404 can indicate
missing access). If the endpoint is public, use Cloudflare rate limiting/WAF
to protect the Workers AI and OpenAI API quotas.

Cloudflare docs: https://developers.cloudflare.com/workers-ai/models/clef-flash/

OpenAI docs: https://developers.openai.com/api/docs/guides/content-provenance
