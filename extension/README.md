# NotReal Chrome extension (X.com MVP)

1. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this `extension/` folder.
2. Browse the timeline on `https://x.com/`. Only **visible post photos** (`article [data-testid="tweetPhoto"] img` hosted at `pbs.twimg.com/media/`) are sent to the existing Worker. Avatars, videos, preview cards, and off-screen posts are excluded.
3. An amber `✦ AI 生成` badge and outline are added **only** when the Worker returns both `style.label: "realistic"` and `synthid: "detected"`. `not_detected`, `skipped`, and errors are never labeled as real or AI.

The extension does not require login or store credentials. Requests use the Cloudflare Worker endpoint in `background.js`; the Worker handles the shared KV cache. For other endpoint domains, update `API` and `host_permissions` together. Detection requires the Worker to be live and correctly configured.

The adapter is intentionally limited to X's post DOM markup. X can change this markup at any time. Reload the extension after editing its files.
