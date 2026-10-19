# mailysleguilloux

Static one-page marketing/landing site for Maïlys Le Guilloux, a French wellness
practitioner (kinésiologue/guérisseuse) near Vannes, Morbihan. **Local SEO is the
site's primary purpose.**

## Stack & run
- **Bun** only. `bun server.js` (start) · `bun test` (runs server.test.js + contact-intake.test.js).
- No framework, no build step, no bundler. `site/index.html` is hand-authored with
  inlined `<style>` and `<script>`. Edit it directly.
- Self-hosted on **Coolify behind a Cloudflare Tunnel**. Recently migrated OFF
  Cloudflare Workers/R2 — do NOT reintroduce Workers/wrangler/R2 assumptions.

## server.js + contact-intake.js (the only dynamic code)
`server.js` serves `site/` statically, routes `POST /contact` to the contact intake, and sets
security headers.
- **Contact intake** (`contact-intake.js`): validation, per-IP in-memory rate limit (60s
  window; the slot is reserved while a request is in flight and kept only if the e-mail is
  sent), the e-mail text, and every French reply. `submit(request)` returns plain
  `{ status, body }`; `server.js` turns it into the JSON response. Turnstile and Resend sit
  behind injected adapters (human check, mailer) that `contactIntakeFromEnv` composes once at
  startup. Each adapter's `fetch` gives up after 10 s (`timeoutMs`) and the visitor gets a 502.
  Turnstile **fails open** (always-pass adapter + one startup warning) when
  `TURNSTILE_SECRET_KEY` is unset and enforces when it's set; an unset `RESEND_API_KEY` makes
  every submission a 503. Real client IP comes from `cf-connecting-ip`.
- **CSP** (`Content-Security-Policy` in the `SECURITY` headers): must stay in sync with what
  `index.html` actually inlines/loads — `unsafe-inline` for inline `<style>/<script>/onerror`,
  `fonts.googleapis.com` + `fonts.gstatic.com`, `static.cloudflareinsights.com` (optional
  beacon), and `challenges.cloudflare.com` (Turnstile script-src + frame-src).
- `RESEND_API_KEY` / `TURNSTILE_SECRET_KEY` come from env at runtime (production sets both),
  never committed.

## Landmines
- `site/_headers` is a **LEGACY** Cloudflare static-assets file. It is NOT used by the Bun
  server and duplicates the header logic in server.js. Treat it as dead, or keep both in sync
  if you touch headers.
- Tests (`bun:test`) assert **EXACT** strings. `server.test.js`: CSP directives and
  Cache-Control max-age values. `contact-intake.test.js`: the French replies, the 60000ms
  window (through an injected clock), the Turnstile siteverify form and the Resend JSON
  (through a `fetch` passed into each adapter). Changing a constant in either module breaks
  tests; update both together. (A PostToolUse hook reminds you.) Tests build fresh contact
  intakes with fake adapters; keep `process.env` and `globalThis.fetch` out of them.
- **Business facts are duplicated** across visible HTML, meta tags, 5 JSON-LD blocks, and
  sitemap.xml: phone `+33650912604`, `18 rue de Plaisance` / `56890 Saint-Avé`, geo
  `47.6869`/`-2.7356`, price. Change ALL occurrences together — the FAQ JSON-LD must mirror
  the visible FAQ, and `review[]` / `ratingCount` must mirror the visible testimonials. Use
  the `seo-structured-data-reviewer` agent after editing `index.html`.
- Images live in `site/images/` and are **committed** to the repo (jpg + webp pairs).

## Agent skills

### Issue tracker

Forgejo issues on `git.sbrn.eu` via the `fj` CLI, with the REST API for JSON reads and blocking links. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `GLOSSARY.md` plus `docs/adr/`. See `docs/agents/domain.md`.
