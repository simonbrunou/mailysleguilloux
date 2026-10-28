# mailysleguilloux

Static one-page marketing/landing site for Maïlys Le Guilloux, a French wellness
practitioner (kinésiologue/guérisseuse) near Vannes, Morbihan. **Local SEO is the
site's primary purpose.**

## Stack & run
- **Bun** only. `bun server.js` (start) · `bun test` (runs every `*.test.js`).
- Where `bun` is not on `PATH`, run every `bun` command through the flake's dev shell:
  `nix develop -c bun test`, `nix develop -c bun server.js`. `.envrc` loads that shell through
  direnv, but an agent's shell does not run direnv's prompt hook, and a new T3 or
  `/tmp` worktree is not `direnv allow`ed either. Use the dev shell's Bun, which `flake.lock`
  pins, rather than `nix shell nixpkgs#bun`, which runs an unpinned Bun.
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
  image sizes). `business-facts.test.js` guards them, so `bun test` fails when two copies
  disagree. Change every copy together. Facts that only the JSON-LD states sit on its
  `JSON_LD_ONLY` allowlist until the owner confirms them; don't add to it. Set the sitemap
  `lastmod` to the commit's date in any commit that changes `index.html`, including a merge
  commit that combines `index.html` edits from both sides. Still run the `seo-structured-data-reviewer` agent after
  editing `index.html`.
- Images live in `site/images/` and are **committed** to the repo (jpg + webp pairs).

## Merge authority

Agents may merge their own PR without asking once all four hold. Run the git checks after
`git fetch origin`, with `HEAD` at the pushed SHA.

- A code review ran on the diff (the `code-review` skill or the `pr-review-toolkit:code-reviewer`
  agent) and its real findings are fixed, nits aside (the global agent rules define a nit).
- CI is green on the pushed SHA.
- The branch has no conflict with `origin/main`. `git merge-tree --write-tree origin/main HEAD`
  exits 0.
- The branch and `origin/main` have not both changed `site/index.html` since their merge base.
  `git diff --quiet origin/main...HEAD -- site/index.html` or
  `git diff --quiet HEAD...origin/main -- site/index.html` exits 0.

Merge with Forgejo's default `merge` style, which makes a merge commit. A branch behind `main`
that meets all four merges as it is, with no CI re-run. Two PRs that each pass CI alone can still
break `main` once both merge, and that risk is accepted. The deploy does not wait for CI, so check
the CI run on `main` after the merge and fix a red one in a new PR.

When the third or fourth condition fails, sync the branch, then check all four again:

1. Merge `origin/main` into the branch and resolve any conflict.
2. Follow the `lastmod` rule in Landmines.
3. Run `bun test` (see Stack & run) and push.

The fourth condition exists because the lastmod test dates a merge commit that combines both sides'
`index.html` edits to the day of that merge. Forgejo's merge commit for such a branch turns
`main` red with no conflict whenever the PR's `lastmod` is from an earlier day.

The production deploy that the merge triggers is accepted. Ask first only when the PR drops or
rewrites stored data (a destructive migration, a backfill that overwrites rows).

## Agent skills

### Issue tracker

Forgejo issues on `git.sbrn.eu` via the `fj` CLI, with the REST API for JSON reads and blocking links. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `GLOSSARY.md` plus `docs/adr/`. See `docs/agents/domain.md`.
