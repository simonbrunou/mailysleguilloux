# Cloudflare Optimization Guide — mailysleguilloux.bzh

## What's already implemented

### 1. WebP images with `<picture>` fallbacks
All hero/service/cabinet images ship as WebP with JPEG fallback through `<picture>`/`<source>`. Browsers without WebP support drop back to JPEG; the hero image uses `fetchpriority="high"` for faster LCP.

### 2. Images served from R2
Images live in the R2 bucket `mailysleguilloux-images` and are served via the Worker at `/images/*`. The Worker sets `Cache-Control: public, max-age=31536000, immutable` and an ETag. R2 has zero egress, so unlimited image views are free.

### 3. `_headers` file (Cloudflare static assets)
- Immutable caching on non-image static assets (`.css`, `.js`, font files, favicon).
- Global security headers: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Content-Security-Policy`, `Strict-Transport-Security`.
- `Link: rel=preload` headers — Cloudflare uses these for 103 Early Hints.

### 4. Resource preloading
- Hero image preloaded in `<head>`.
- Google Fonts CSS preloaded; `preconnect` + `dns-prefetch` to `fonts.googleapis.com` / `fonts.gstatic.com`.

### 5. Selective Worker invocation
`wrangler.jsonc` declares `run_worker_first: ["/images/*", "/contact"]`. Every other request bypasses the Worker entirely and is served directly from static assets — zero Worker invocations for HTML/CSS/fonts.

---

## Cloudflare dashboard settings

| Section                   | Setting                                  | Value                       | Why                                                |
| ------------------------- | ---------------------------------------- | --------------------------- | -------------------------------------------------- |
| Speed → Optimization      | Auto Minify (HTML/CSS/JS)                | ON                          | Edge-side minification.                            |
| Speed → Optimization      | Early Hints                              | ON                          | Uses the `Link` headers from `_headers`.           |
| Speed → Optimization      | HTTP/3 (QUIC)                            | ON                          | Faster on mobile.                                  |
| Speed → Optimization      | Brotli                                   | ON                          | ~15–20% smaller than gzip.                         |
| Speed → Optimization      | Rocket Loader                            | OFF                         | Hurts inline-script pages like this one.           |
| Caching                   | Browser Cache TTL                        | Respect Existing Headers    | Let `_headers` drive caching.                      |
| Caching                   | Always Online                            | ON                          | Show cached version if origin is down.             |
| Caching                   | Tiered Cache                             | ON                          | Fewer origin hits across PoPs.                     |
| SSL/TLS                   | Encryption mode                          | Full (Strict)               | End-to-end TLS.                                    |
| SSL/TLS                   | Always Use HTTPS                         | ON                          | Force HTTPS.                                       |
| SSL/TLS                   | HSTS                                     | ON                          | Browsers remember to use HTTPS.                    |
| SSL/TLS                   | Minimum TLS                              | 1.2                         | Drop legacy protocols.                             |

---

## Operating the R2 image bucket

Bucket: `mailysleguilloux-images` (bound as `R2` in `wrangler.jsonc`).

Upload a single image:

```bash
npx wrangler r2 object put mailysleguilloux-images/mailys.webp \
  --file site/images/mailys.webp \
  --content-type image/webp \
  --cache-control "public, max-age=31536000, immutable"
```

Bulk-upload everything from `site/images/`:

```bash
./scripts/upload-images.sh
```

The Worker (`src/index.js`) sets the cache and content-type headers on every response, so uploading without them still works — but uploading *with* them keeps R2's stored metadata clean.

---

## Other Cloudflare features worth exploring

### Cloudflare Web Analytics (free)
Privacy-first, no cookies, GDPR-compliant. Already enabled at the Worker level via `observability: true`. To add client-side metrics, uncomment the beacon snippet at the bottom of `site/index.html` and replace `YOUR_BEACON_TOKEN`.

### Turnstile (already wired up)
Replaces reCAPTCHA on the contact form. The repo ships with the always-passes test keys so preview deployments work without configuration. For production, swap in real keys from Cloudflare Dashboard → **Turnstile**.

### Workers KV (potential future use)
If global rate-limiting becomes a concern, replace the current per-PoP `caches.default` rate-limit with a KV-backed counter or a Cloudflare zone-level Rate Limiting rule.
