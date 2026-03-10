# GhostChat Widget

**9KB chat widget. Zero cookies. Zero tracking. Fully open source.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Size](https://img.shields.io/badge/gzipped-~9KB-brightgreen)](dist/widget.js)
[![No cookies](https://img.shields.io/badge/cookies-zero-brightgreen)](#privacy-by-design)

This is the open source client-side widget that powers [GhostChat](https://ghostchat.dev) — a lightweight, privacy-first live chat for websites.

## Quick Start

Add this script tag to your site:

```html
<script src="https://api.ghostchat.dev/widget.js" data-site="YOUR_SITE_ID" async></script>
```

Sign up at [ghostchat.dev](https://ghostchat.dev/signup) to get your site ID.

## What's Inside

A single TypeScript file that compiles to ~9KB gzipped. No frameworks, no dependencies.

- **WebSocket real-time messaging** — instant two-way communication
- **File & image uploads** — up to 5MB with inline preview
- **Typing indicators** — both visitor and agent, in real time
- **Page journey tracking** — SPA-aware, shows agents which pages the visitor browsed
- **Email capture** — prompts visitor for email when no agent responds
- **Presence detection** — online/away status via `visibilitychange` and `beforeunload`
- **Notification sounds** — synthesized audio ding, no external files
- **Unread badge** — shows count on the launcher button
- **Dark mode** — respects `prefers-color-scheme`
- **Customizable** — position, colors, welcome message via `data-*` attributes

## Privacy by Design

Don't take our word for it — read the code:

- `grep "document.cookie"` → **0 results** — no cookies, ever
- `grep "analytics\|tracking\|pixel"` → **0 results** — no tracking scripts
- `grep "fingerprint"` → **0 results** — no browser fingerprinting
- **localStorage keys**: only 4 (`ghostchat_session_id`, `ghostchat_session_secret`, `ghostchat_email`, `ghostchat_tooltip_shown`)
- All API calls go to **your GhostChat API domain only** — no third-party requests
- No CDN dependencies, no external fonts, no iframes from other domains

## Size Comparison

| Widget | Gzipped Size | Cookies | Tracking |
|--------|-------------|---------|----------|
| **GhostChat** | **~9KB** | **None** | **None** |
| Intercom | ~200KB+ | Yes | Yes |
| Tawk.to | ~200KB | Yes | Yes |
| Tidio | ~200KB+ | Yes | Yes |
| Crisp | ~140KB | Yes | Yes |
| LiveChat | ~120KB | Yes | Yes |

## Build from Source

```bash
git clone https://github.com/jacoborbach/ghostchat-widget.git
cd ghostchat-widget
npm install
npm run build
```

The built widget will be at `dist/widget.js`.

## How It Works

The widget is a single IIFE (Immediately Invoked Function Expression) that:

1. Auto-detects the API URL from the `<script>` tag's `src` attribute
2. Creates a shadow-DOM-free chat UI injected at the end of `<body>`
3. Opens a WebSocket connection for real-time messaging
4. Falls back to polling if WebSocket fails
5. Stores only a session ID in localStorage — no cookies, no fingerprinting

## Self-Hosting Note

This widget connects to GhostChat's hosted API. You need a GhostChat account to use it. [Sign up free](https://ghostchat.dev/signup) — no credit card required.

## Architecture

See [How Our Widget Works](https://ghostchat.dev/how-our-widget-works) for a visual breakdown of the architecture, privacy guarantees, and size comparisons.

## License

MIT — see [LICENSE](LICENSE).

Built by [GhostChat](https://ghostchat.dev).
