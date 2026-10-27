# NotReal Chrome extension — X.com

Manifest V3, no build step and no login. Only visible post photos are sent for inspection. Avatars, videos/GIF posters, video controls and card thumbnails are excluded. A badge appears only if the Worker returns both `realistic` and `synthid: detected`.

## Install

1. Open `chrome://extensions`, enable Developer mode → **Load unpacked** → select `extension/`.
2. After updates, reload the extension **and** existing X tabs.
3. Pin NotReal to Chrome's toolbar. The **X** badge confirms the adapter is running. Hover for scanned/requested/marked counts.

## Caching

- Browser: `chrome.storage.local`, seven days from the Worker's `checkedAt`, shared across tabs and browser restarts. Caches `detected`, `not_detected`, and `skipped`; errors are never cached.
- Server: existing Workers KV shared by all anonymous users. Requests with identical image URLs are coalesced.
- Only photos within the current viewport are queued, with at most two active requests per tab.

## Troubleshooting

- In the X tab Console, filter `[NotReal]` to see photos found, requests sent and results.
- Actual POST `/detect` appears in **chrome://extensions → NotReal → Service Worker → Inspect → Network**, not the X tab's Network.
- No X badge: reload extension and tab. Badge but no photos: X's DOM may have changed or visible media is video/card content.
- `node --test extension/test.mjs` checks cache reuse and video/card filtering in simulated environments.

Endpoint: `https://notreal-extension.koft.workers.dev/detect`. No changes to the Worker are required.
