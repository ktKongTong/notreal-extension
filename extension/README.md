# NotReal Chrome extension — X.com

Manifest V3, no build step, no login. Detects **visible post media images**, not avatars, video posters, or card images. Only adds a badge if the Cloudflare Worker returns both `style.label: "realistic"` and `synthid: "detected"`.

## Install

1. Download the repo, open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**.
2. Select the repository's `extension/` directory (the folder with `manifest.json`).
3. **Reload the extension and reload any existing X tabs** whenever its source changes.
4. Pin NotReal to the Chrome toolbar. On X, the extension icon shows a small **X badge** when the adapter is active; hover it to see counts for images found, detection requests, and marked images.

## Troubleshooting

The detection POST is sent from the **extension's background service worker**. It does **not** appear in the X tab's Network panel.

- On X, open DevTools → Console, filter `[NotReal]`. Expect `X adapter active`, `X post photo found`, `Detect visible photo`, then `Detection complete` or `Detection error`.
- To inspect actual `/detect` network requests, visit `chrome://extensions` → NotReal → **Service Worker → Inspect → Network**.
- No X toolbar badge: script not injected / extension not reloaded.
- X badge but zero images found: X has changed the DOM, or no eligible post media images are present.
- Image found but no detection: only visible images are processed; check viewport.
- Detection successful but no badge: only realistic images with detected SynthID watermarks are marked, never `not_detected` or `skipped`.

The endpoint is `https://notreal-extension.koft.workers.dev/detect` and is configured in `background.js`. Adapter uses `article` media images from `pbs.twimg.com/media/`, supports X's `tweetPhoto` and photo-link wrappers, and limits concurrency to two images.
