# Deployment Guide — mailysleguilloux.bzh

## Architecture

```
GitHub (push to main)
    │
    ▼
Cloudflare Workers Builds (auto-deploy)
    │
    ▼  mailysleguilloux.bzh
Cloudflare edge (300+ PoPs)
    ├── Static assets from site/  (served directly)
    └── Worker src/index.js
        ├── POST /contact   → Resend API (with Turnstile)
        └── GET  /images/*  → R2 bucket
```

The Worker is configured with `run_worker_first: ["/images/*", "/contact"]` so every other path is served straight from static assets — the Worker never runs for the homepage, fonts, CSS, etc.

---

## 1. Initial setup (one-time)

### Worker + GitHub integration

1. **Cloudflare Dashboard** → **Workers & Pages** → **Create** → **Import a repository**.
2. Pick the GitHub repo.
3. **Build settings**:
   - Build command: *(empty)*
   - Deploy command: `npx wrangler deploy`
   - Root directory: *(repo root)*
4. **Save and Deploy**. Subsequent pushes to `main` auto-deploy; pushes to any other branch produce a **preview URL**.

### R2 bucket for images

```bash
npx wrangler r2 bucket create mailysleguilloux-images
```

The binding (`R2`) is already declared in `wrangler.jsonc`.

Upload the site images:

```bash
./scripts/upload-images.sh
```

### Secrets

```bash
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put TURNSTILE_SECRET_KEY
```

The Turnstile **site key** is public and lives directly in `site/index.html`. Create the widget in Cloudflare Dashboard → **Turnstile** → **Add site**, then paste the site key into the `data-sitekey` attribute on the form.

> The repo ships with the always-passes test keys so the contact form works in preview deployments without configuration. Replace both before production.

---

## 2. Custom domain

In the Worker project → **Settings** → **Domains & Routes** → **Add Custom Domain**: `mailysleguilloux.bzh` (and `www.mailysleguilloux.bzh`). Cloudflare manages the DNS records automatically.

---

## 3. Verify

```bash
curl -I https://mailysleguilloux.bzh
# HTTP/2 200, content-type: text/html

curl -I https://mailysleguilloux.bzh/images/mailys.webp
# HTTP/2 200, content-type: image/webp, cache-control: ... immutable

curl -X POST https://mailysleguilloux.bzh/contact \
  -H 'content-type: application/json' \
  -d '{}'
# HTTP/2 400 — missing fields
```

---

## Local development

Static-only (no Worker):

```bash
cd site && python3 -m http.server 8080
```

Full Worker emulation (real routing, R2 stub, secrets from `.dev.vars`):

```bash
npx wrangler dev
```

`.dev.vars` (gitignored) holds secrets locally:

```
RESEND_API_KEY=re_dev_xxx
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
```

---

## Manual deploy

```bash
npx wrangler deploy
```

---

## Troubleshooting

**Push didn't deploy** — check **Workers & Pages → Builds** in the dashboard. The build log shows the exact `wrangler deploy` output.

**Images return 404** — confirm the bucket exists and the object key matches the URL path (`/images/foo.webp` reads R2 object `foo.webp`).

**Contact form returns 503** — `RESEND_API_KEY` not set as a secret on the Worker.

**Contact form returns 400 "Vérification anti-robot échouée"** — `TURNSTILE_SECRET_KEY` doesn't match the site key, or the widget didn't load on the page.
