# mailysleguilloux

Static one-page marketing/landing site for Maïlys Le Guilloux, a French wellness
practitioner (kinésiologue/guérisseuse) near Vannes, Morbihan. **Local SEO is the
site's primary purpose.**

## Stack & run
- **Bun** only. `bun server.js` (start) · `bun test` (runs server.test.js).
- No framework, no build step, no bundler. `site/index.html` is hand-authored with
  inlined `<style>` and `<script>`. Edit it directly.
- Self-hosted on **Coolify behind a Cloudflare Tunnel**. Recently migrated OFF
  Cloudflare Workers/R2 — do NOT reintroduce Workers/wrangler/R2 assumptions.

## server.js (the only dynamic code)
Serves `site/` statically + a single `POST /contact` endpoint, plus security headers.
- **Contact**: Resend email, per-IP in-memory rate limit (60s window, budget consumed
  only on success), field-length limits, and **Cloudflare Turnstile** anti-bot — Turnstile
  **fails open** when `TURNSTILE_SECRET_KEY` is unset and enforces when it's set (mirrors the
  `RESEND_API_KEY` graceful pattern). Real client IP comes from `cf-connecting-ip`.
- **CSP** (`Content-Security-Policy` in the `SECURITY` headers): must stay in sync with what
  `index.html` actually inlines/loads — `unsafe-inline` for inline `<style>/<script>/onerror`,
  `fonts.googleapis.com` + `fonts.gstatic.com`, `static.cloudflareinsights.com` (optional
  beacon), and `challenges.cloudflare.com` (Turnstile script-src + frame-src).
- `RESEND_API_KEY` / `TURNSTILE_SECRET_KEY` are required at runtime via env, never committed.

## Landmines
- `site/_headers` is a **LEGACY** Cloudflare static-assets file. It is NOT used by the Bun
  server and duplicates the header logic in server.js. Treat it as dead, or keep both in sync
  if you touch headers.
- `server.test.js` (`bun:test`) asserts **EXACT** strings — CSP directives, Cache-Control
  max-age values, the rate-limit window, and the Resend + Turnstile request shapes. Changing
  a server.js constant breaks tests; update both together. (A PostToolUse hook reminds you.)
- **Business facts are duplicated** across visible HTML, meta tags, 5 JSON-LD blocks, and
  sitemap.xml: phone `+33650912604`, `18 rue de Plaisance` / `56890 Saint-Avé`, geo
  `47.6869`/`-2.7356`, price. Change ALL occurrences together — the FAQ JSON-LD must mirror
  the visible FAQ, and `review[]` / `ratingCount` must mirror the visible testimonials. Use
  the `seo-structured-data-reviewer` agent after editing `index.html`.
- Images live in `site/images/` and are **committed** to the repo (jpg + webp pairs).
