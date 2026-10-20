# mailysleguilloux

Static one-page marketing/landing site for Maïlys Le Guilloux, a French wellness
practitioner (kinésiologue/guérisseuse) near Vannes, Morbihan. **Local SEO is the
site's primary purpose.**

## Stack & run
- **Bun** only. `bun server.js` (start) · `bun test` (runs every `*.test.js`).
- No framework, no build step, no bundler. `site/index.html` is hand-authored with
  inlined `<style>` and `<script>`. Edit it directly.
- Self-hosted on **Coolify behind a Cloudflare Tunnel**. Recently migrated OFF
  Cloudflare Workers/R2 — do NOT reintroduce Workers/wrangler/R2 assumptions. Checking a
  deploy or the live site: `docs/DEPLOYMENT.md`.

## server.js + contact-intake.js (the only dynamic code)
`server.js` is the **header policy** module and the only place the header policy lives. It serves
`site/`, routes `POST /contact` to the contact intake, and gives every response (file, contact
reply, 400/404/405) the security headers and CSP. Every branch of `route()` returns plain
`{ status, body, headers }` and only `fetchHandler` builds the `Response`; add new branches the
same way so none can skip the policy. Cache-Control and the homepage `Link` are keyed on the
file actually served.
- **Contact intake** (`contact-intake.js`): validation, per-IP in-memory rate limit (60s
  window; the slot is reserved while a request is in flight and kept only if the e-mail is
  sent), the e-mail text, and every French reply. `submit(request)` returns plain
  `{ status, body }`; `server.js` turns it into the JSON response. Turnstile and Resend sit
  behind injected adapters (human check, mailer) that `contactIntakeFromEnv` composes once at
  startup. The Turnstile and Resend adapters give up after 10 s (`timeoutMs`); the visitor gets a 502.
  Turnstile **fails open** (always-pass adapter + one startup warning) when
  `TURNSTILE_SECRET_KEY` is unset and enforces when it's set; an unset `RESEND_API_KEY` makes
  every submission a 503. Real client IP comes from `cf-connecting-ip`.
- **CSP** (`Content-Security-Policy` in the `SECURITY` headers): `unsafe-inline` covers the
  inline `<style>/<script>/onerror` in `index.html`. A test in `server.test.js` reads
  `index.html` and fails when the CSP blocks an origin it loads. Origins a third-party script
  loads in turn (Google Fonts files, the Turnstile iframe, beacon reports) are listed in that
  test's `FOLLOW_ON_LOADS`; add an entry when a new script loads more.
- `RESEND_API_KEY` / `TURNSTILE_SECRET_KEY` come from env at runtime (production sets both),
  never committed.

## Landmines
- Tests (`bun:test`) assert **EXACT** strings. `server.test.js`, all through
  `createFetchHandler`: the full CSP string, the security headers and Cache-Control max-age
  values. `contact-intake.test.js`: the French replies, the 60000ms
  window (through an injected clock), the Turnstile siteverify form and the Resend JSON
  (through a `fetch` passed into each adapter). Changing a constant in either module breaks
  tests; update both together. (A PostToolUse hook reminds you.) Tests build fresh contact
  intakes with fake adapters; keep `process.env` and `globalThis.fetch` out of them.
- **Business facts are duplicated** across visible HTML, meta tags, 5 JSON-LD blocks,
  sitemap.xml and robots.txt (phone, email, address, geo, price, FAQ, testimonials, site URL,
  image sizes). `business-facts.test.js` is the guard: `bun test` fails when two copies
  disagree, so change every copy together. Facts that only the JSON-LD states sit on its
  `JSON_LD_ONLY` allowlist until the owner confirms them; don't add to it. Bump the sitemap
  `lastmod` in any commit that changes `index.html`. Still run the
  `seo-structured-data-reviewer` agent after editing `index.html`.
- Images live in `site/images/` and are **committed** to the repo (jpg + webp pairs).

## Merge authority

Agents may merge their own PR without asking once all three hold: a code review ran on the diff (the `code-review` skill or the `pr-review-toolkit:code-reviewer` agent) and its real findings are fixed; CI is green on the pushed SHA; the branch is up to date with `origin/main`. The production deploy that the merge triggers is accepted. Ask first only when the PR drops or rewrites stored data (a destructive migration, a backfill that overwrites rows).

## Agent skills

### Issue tracker

Forgejo issues on `git.sbrn.eu` via the `fj` CLI, with the REST API for JSON reads and blocking links. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `GLOSSARY.md` plus `docs/adr/`. See `docs/agents/domain.md`.
