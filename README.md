# mailysleguilloux.bzh

Static website for Mailys Le Guilloux - Guerisseuse et Kinesiologue.

## Deployment

Hosted on **Cloudflare Pages** with auto-deploy from GitHub.

### Infrastructure

- **Site**: Cloudflare Pages (static files from `site/`)
- **Domain**: `mailysleguilloux.bzh` (DNS managed by Cloudflare)

### Files

```
site/                     # Website files (Pages build output)
  index.html
  sitemap.xml
  robots.txt
  images/                 # Images (served from CDN)
scripts/
  download-images.sh      # Download images from Wix (run once)
docs/
  DEPLOYMENT.md           # Full deployment guide
```

## Local Development

```bash
cd site
python3 -m http.server 8080
# Open http://localhost:8080
```

## Deploy

Push to `main` to auto-deploy via Cloudflare Pages.

Manual deploy:
```bash
npx wrangler pages deploy site --project-name=mailysleguilloux
```

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for full setup instructions.
