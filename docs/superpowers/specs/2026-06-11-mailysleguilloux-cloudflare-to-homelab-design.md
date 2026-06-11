# Migrate mailysleguilloux.bzh off Cloudflare compute/storage to the homelab

**Date:** 2026-06-11
**Status:** Approved design — ready for implementation planning

## Motivation

Move the *hosting* of Maïlys's site off Cloudflare for **control, ethical hosting,
and running on a clean (French) grid we own and can account for**. The objection is
to CF running the compute (Workers) and storage (R2) — **not** to CF being in the
request path. Cloudflare therefore stays as DNS + Tunnel front door; Resend stays as
the email sender. Only the **compute** (Worker → homelab CT) and **storage**
(R2 → in-repo files) actually leave Cloudflare.

**Accepted tradeoff:** the site moves from CF's global edge to a single home host on
one residential uplink. Availability goes down. This is taken on deliberately for the
control/hosting goal.

## Current state (verified 2026-06-11)

- **Repo:** `simonbrunou/mailysleguilloux` — a static site in `site/` (inline-CSS
  HTML; no build step, no `package.json`) plus a Cloudflare Worker `src/index.js`.
- **The Worker does exactly two dynamic things:**
  1. Proxies `GET /images/*` from R2 bucket `mailysleguilloux-images`.
  2. Handles `POST /contact` → validates fields → rate-limits (1 submission per IP
     per 60s via the CF Cache API) → sends the message through Resend.
  No DB, KV, D1, or SSR.
- **R2 inventory:** ~0.73 MB across 6 small images
  (`mailys.{jpg,webp}`, `cabinet-1.{jpg,webp}`, `og-image.jpg`, `favicon.avif`).
- **CF account:** the `mailysleguilloux` Worker and `mailysleguilloux-images` bucket
  live in the same account (`ddeae68ec2f77cc93313c8a96be86c34`) that owns the
  Terraform-managed **Homelab** tunnel, which already serves multiple zones
  (`sbrn.eu`, `*.simonbrunou.bzh`, `diversif.app`). Adding `mailysleguilloux.bzh` is
  an in-account operation.

## Chosen approach

**One Bun server** (`Bun.serve`) that serves the static `site/` directory *and*
handles `POST /contact`. The Worker's `fetch(request, env)` ports almost line-for-line
to `Bun.serve({ fetch })`; the Resend call is identical plain `fetch`. One artifact,
built with **railpack + Bun** (the homelab house standard), on its own CT.

Rejected alternatives:
- **Caddy/nginx static + separate contact service** — two processes for no benefit.
- **Self-host the Worker via `workerd`** — maximizes code reuse but R2/Cache bindings
  need shims and workerd self-hosting is fiddly. Not worth it.

## Design

### Application (repo changes, on branch `migrate-off-cloudflare`, shipped as a PR)

- **`server.js`** — `Bun.serve` listening on `process.env.PORT` (default 3000):
  - Serves `site/` as static files, reproducing the `site/_headers` rules
    (security headers + cache-control by extension) as response headers.
  - `GET /images/*` becomes plain static file serving from `site/images/` — the R2
    proxy block is deleted.
  - `POST /contact` — port the existing handler verbatim: JSON parse, required-field
    check (`name`, `email`, `message`), email regex, Resend POST with `reply_to`,
    French success/error messages. CORS headers kept (harmless; same-origin now).
  - `OPTIONS /contact` preflight preserved.
- **Rate limiting** — replace the CF Cache API trick with an in-memory `Map` keyed by
  the `Cf-Connecting-Ip` header (cloudflared preserves the real client IP through the
  tunnel). Same 1/IP/60s behaviour. A periodic sweep evicts stale entries so the Map
  can't grow unbounded.
- **Images** — commit the 6 files into `site/images/`; remove the R2 binding usage.
- **`package.json`** — add with a `start` script (`bun server.js`); railpack + Bun
  needs an explicit start command.
- **`wrangler.jsonc`** — removed (or excluded from deploy) so nothing points back at
  CF compute.

### Infrastructure

- **CT116** — a dedicated Coolify server CT (service-separation rule; mirrors
  CT114/CT115). railpack build pack, deploys from the GitHub repo.
- **Env** — Coolify env var `RESEND_API_KEY` set with `is_preview:false` (the
  documented Coolify gotcha), restart after setting.
- **Tunnel/DNS (Terraform, `homelab-stacks`):**
  - Add an ingress entry `mailysleguilloux.bzh → http://<CT116-ip>:<port>` to
    `terraform/cloudflare/tunnel-config.tf`, **before** the catch-all 404 entry.
  - Add a proxied CNAME in the `.bzh` zone → the tunnel.
  - Land via PR → dispatch apply.

### Cutover

1. Deploy to CT116; verify the site renders and a **real contact-form submission**
   delivers email through the tunnel hostname.
2. Flip `mailysleguilloux.bzh` from the Worker route to the tunnel.
3. After a short grace period: delete the `mailysleguilloux` Worker and the
   `mailysleguilloux-images` R2 bucket.

## What stays on Cloudflare / unchanged

- DNS for `mailysleguilloux.bzh` (the tunnel needs it).
- The Cloudflare Tunnel as the public front door (edge cache, DDoS, bot filtering).
- **Resend** as the email sender (the ISP blocks port 25, so self-hosted SMTP is not
  an option — and that's fine; email never needed to move).

## Out of scope

- Moving DNS off Cloudflare.
- Any redesign of the site's content or markup.
- Migrating other sites.

## Open verification (at apply time, not a blocker)

- One-line assertion that the `mailysleguilloux.bzh` zone resolves under account
  `ddeae68…` before adding the tunnel ingress (high confidence already; the CF MCP —
  bound to that account — already sees the Worker and bucket).
