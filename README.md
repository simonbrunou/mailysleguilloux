# mailysleguilloux.bzh

Static website for Maïlys Le Guilloux — Guérisseuse et Kinésiologue.

## Architecture

Deployed as a **Cloudflare Worker with Static Assets**:

- Static HTML/CSS in `site/` is served from Cloudflare's edge.
- A small Worker (`src/index.js`) handles two dynamic routes:
  - `POST /contact` — sends the contact form to Resend (with Turnstile verification).
  - `GET/HEAD /images/*` — proxies image requests to an R2 bucket.
- Images live in the R2 bucket `mailysleguilloux-images`, not in the repo.

## Files

```
site/                  # Static assets served from the edge
  index.html
  404.html
  _headers             # Caching + security headers
  sitemap.xml
  robots.txt
src/
  index.js             # Cloudflare Worker (contact + R2 image proxy)
scripts/
  upload-images.sh     # Upload site images to the R2 bucket
docs/
  DEPLOYMENT.md
  CLOUDFLARE-OPTIMIZATION.md
wrangler.jsonc         # Worker + assets + R2 binding config
```

## Local development

Static assets only (no Worker, no R2 proxy):

```bash
cd site
python3 -m http.server 8080
# Open http://localhost:8080
```

Full Worker emulation (requires `npx wrangler`):

```bash
npx wrangler dev
```

## Deploy

Pushing to `main` triggers an auto-deploy via the Cloudflare GitHub integration. Pushes to any other branch produce a **preview deployment** at a unique URL — useful for testing before merging.

Manual deploy:

```bash
npx wrangler deploy
```

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the full setup.

## Secrets

The Worker needs two secrets, set via `npx wrangler secret put`:

| Secret                  | Purpose                                          |
| ----------------------- | ------------------------------------------------ |
| `RESEND_API_KEY`        | Auth for the Resend email API.                   |
| `TURNSTILE_SECRET_KEY`  | Server-side validation of the Turnstile token.   |

The Turnstile **site key** is public and is embedded in `site/index.html`.
