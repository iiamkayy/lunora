# lunora

> **"For MISD X AISD students by MISD X AISD students"**

A web-desktop style unblocked games site: bottom taskbar, draggable windows, a huge game library,
a Discord-style messenger, a tabbed proxied browser (Scramjet v2 **and** Ultraviolet), live wallpapers,
tab cloaks, a panic key, and a built-in AI.

---

## 🚀 Run it

```bash
npm install     # installs the wisp + bare proxy backends
node server.js  # (or: npm start)
```

Then open **http://localhost:3000**.

> Running a static host only (e.g. GitHub Pages) works for the site itself, but the browser engines
> need a proxy backend. Host `server.js` on Node (Render/Railway/VPS/etc.) or point your own wisp/bare
> endpoints in **Settings → Browser Engine**.

## 🧭 The desktop

Bottom taskbar: **Home · Games · Apps · Messenger · Browser · Settings · AI**

| App | What it does |
|---|---|
| **Home** | xylora-style wallpaper desktop, `enter url…` search (DuckDuckGo), quick links |
| **Games** | 4 tabs: **lunora library** (thousands of games from the GGR community scrape), **Figure**, **Lumin** (LuminSDK — 1000+ more games), **Classics** (2048, HexGL, Clumsy Bird…) |
| **Apps** | YouTube, Spotify, Twitch, GeForce NOW, Xbox Cloud, Discord, TikTok, **Anime → anigato.lol**, **Remote Access → browser.lol** and more — all open in the built-in browser |
| **Messenger** | **contacts** (add friends by username), **group chats**, rich **profiles** (banner image *or mp4*, avatar, badges, about), and **real audio & video calls** (WebRTC — mic + camera; works tab-to-tab on one device today, swap the mesh for a websocket relay for cross-device) |
| **Browser** | Real tabs, omnibox (URL *or* search → DuckDuckGo HTML), back/forward/reload/fullscreen, engine switcher chip |
| **Settings** | Wallpapers (**import mp4 live wallpapers**, images, URLs, gradients, dim/blur), accent colors, **tab cloak** (Google Classroom / Canvas / ClassLink / Clever + custom + auto-cloak on blur + about:blank mode), **panic key** (custom key + custom rescue URL), engine endpoints, data export/import |
| **AI** | A real general assistant — ask it anything. **Auto chain**: Pollinations (keyless) → **open-source Browser AI** (SmolLM2 runs entirely in your browser via transformers.js, no key, unblockable, works offline after first download) → **offline brain** (math with steps, conversions, knowledge base, reading & writing help). Or plug in Groq / OpenRouter / Gemini / custom with a free key |

Extras: **Ctrl+K** spotlight, right-click desktop menu, boot/loading screen with the motto,
on-screen panic button, window manager (drag, minimize, maximize).

## 🧩 Engines

- **Scramjet v2.0.67-alpha.2** (`/scramjet/` + `/controller/`) — the **default** engine (controller + SW glue + epoxy transport, per-frame navigation).
- **Ultraviolet v3.2.7** (`/uv/`) — service worker at `/` scope, epoxy over wisp.
- **Direct** — no proxy; raw frames for embed-friendly sites.

Both are switched live in **Settings → Browser Engine** (or the chip in the browser toolbar).
When self-hosted with `server.js`, the wisp + bare backends are served by the same server — zero config.

## 💬 Real backend (NEW)

`node server.js` runs a **real backend**: a JSON-file database (`data/db.json`, saves automatically) + REST API (`/api/*`) + WebSocket (`/ws`). Accounts, friend requests (real ones that show up on the other account), DMs, groups, global channels, avatars/banners — all saved server-side, working **across devices**. Calls are real WebRTC with mic/camera/speaker pickers.

### AI setup (Z.ai GLM)

The AI app + global-chat moderation run on **GLM via the Z.ai SDK**, called server-side (no keys in the browser):
1. get a free key from z.ai (open platform)
2. copy `.z-ai-config.example` to `.z-ai-config` and paste your key
3. restart `node server.js`

Until then the AI app shows honest setup steps and global messages are tagged 🤖 unmoderated.

### Legacy note

Accounts, channels, friends and groups work **fully locally** (localStorage + IndexedDB) and sync live
between tabs/windows via BroadcastChannel. That means:

- ✅ works out of the box, zero setup, moderation tools all functional
- ⚠️ accounts are **per device** — for real cross-device accounts you need a server.
  The data layer in `messenger.html` (the `D` object + `pushMessage`) is deliberately small —
  swap it for Supabase/Firebase/a Node + WS backend later without touching the UI.

The first account registered on a device becomes **owner** (👑), who can promote mods (🛡).
A built-in bot (**@lunora**) keeps #general alive and answers DMs.

## 📁 Structure

```
index.html        shell: boot screen, desktop, taskbar, windows, home
shared.css/js     design system + storage, cloak, panic, IPC, engine probe
browser.html      tabbed browser (engines, DDG)
messenger.html    discord-style messenger
settings.html     wallpapers / cloak / panic / engine / data
games.html        games hub (library · figure · lumin · classics)
apps.html         app launcher
ai.html           pollinations-powered AI
games/            rebranded GGR library (index.html), Figure.html, legacy-games.html
uv/  scramjet/  controller/  vendor/   proxy engines + transports
server.js         static + wisp + bare server
```

## 🙏 Credits

- [Scramjet](https://github.com/MercuryWorkshop/scramjet) & [bare-mux](https://github.com/MercuryWorkshop/bare-mux) & epoxy — Mercury Workshop (AGPL-3.0)
- [Ultraviolet](https://github.com/titaniumnetwork-dev/Ultraviolet) — Titanium Network (GPL-3.0)
- Game data — the GGR community master scrape list · [LuminSDK](https://luminsdk.com)
- Search — DuckDuckGo · AI — [Pollinations](https://pollinations.ai)

lunora hosts nothing — everything is embedded or proxied. Be smart, be kind, don't fail math.
