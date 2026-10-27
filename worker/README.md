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

## Setup and deploy

```sh
cd worker
npm install
npx wrangler login
npx wrangler kv namespace create CACHE
```

Copy the returned namespace ID into `wrangler.jsonc`, replacing the 32 zeroes. Then:

```sh
npx wrangler secret put OPENAI_API_KEY
npm run check
npm run deploy
```

The Cloudflare account must have Workers AI enabled and the OpenAI API organization must have access to Content Provenance checks (an OpenAI 404 can mean missing access). The API key is a Worker secret, never a client-side credential. If you expose this API publicly, configure Cloudflare rate limiting/WAF to avoid third-party abuse of your API quota.

Cloudflare docs: https://developers.cloudflare.com/workers-ai/models/clef-flash/

OpenAI docs: https://developers.openai.com/api/docs/guides/content-provenance
