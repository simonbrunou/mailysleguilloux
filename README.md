# mailysleguilloux.bzh

Static website for Mailys Le Guilloux - Guerisseuse et Kinesiologue.

## Deployment

Self-hosted on the homelab **Coolify** behind a **Cloudflare Tunnel**. Every merge to `main` on
git.sbrn.eu deploys automatically.

### Infrastructure

- **Site**: a Bun server (`server.js`) serving `site/`, built and run by Coolify
- **Domain**: `mailysleguilloux.bzh` (DNS and edge cache on Cloudflare)

### Files

```
server.js                 # Bun server: serves site/, POST /contact, sets every response header
contact-intake.js         # POST /contact: validation, rate limit, Turnstile, Resend e-mail
site/                     # Website files served by server.js
  index.html
  sitemap.xml
  robots.txt
  images/                 # Images (committed jpg + webp pairs)
scripts/
  download-images.sh      # Download images from Wix (run once)
docs/
  DEPLOYMENT.md           # How a deploy happens and how to check it
```

## Local Development

```bash
bun server.js
# Open http://localhost:3000
```

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for deploy checks and smoke tests.
