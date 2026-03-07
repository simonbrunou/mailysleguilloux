# Cloudflare Optimization Guide - mailysleguilloux.bzh

## What's Already Implemented

### 1. WebP Images with `<picture>` Fallbacks
All JPEG images have been converted to WebP format with automatic fallback:
- **~40-55% smaller** file sizes (951K total JPEG → ~560K WebP)
- Browsers that don't support WebP (very rare) fall back to JPEG
- Hero image uses `fetchpriority="high"` for faster LCP

### 2. `_headers` File (Cloudflare Pages)
Custom headers configured for:
- **Immutable caching** on images (`max-age=1yr, immutable`)
- **Security headers**: `X-Content-Type-Options`, `X-Frame-Options`, `Permissions-Policy`, etc.
- **Early Hints** via `Link` headers — Cloudflare sends 103 responses to preload the hero image and fonts before the HTML is fully parsed

### 3. `_redirects` File
- `www.mailysleguilloux.bzh` → `mailysleguilloux.bzh` (301 permanent)

### 4. Resource Preloading
- Hero image (`mailys.webp`) preloaded in `<head>`
- Google Fonts preloaded as style
- `preconnect` to `fonts.googleapis.com` and `fonts.gstatic.com`

---

## Cloudflare Dashboard Settings to Enable

These settings should be toggled in the Cloudflare dashboard for maximum performance:

### Speed → Optimization

| Setting | Recommended | Why |
|---------|-------------|-----|
| **Auto Minify** (HTML, CSS, JS) | ON | Reduces file sizes on the edge |
| **Early Hints** | ON | Sends 103 responses using the `Link` headers from `_headers` |
| **HTTP/2** | ON (default) | Multiplexed connections |
| **HTTP/3 (QUIC)** | ON | Faster connections, especially on mobile |
| **Brotli compression** | ON | Better compression than gzip (~15-20% smaller) |
| **Rocket Loader** | OFF | Not useful for inline scripts, can delay rendering |

### Caching

| Setting | Recommended | Why |
|---------|-------------|-----|
| **Caching Level** | Standard | Works with `_headers` Cache-Control |
| **Browser Cache TTL** | Respect Existing Headers | Let `_headers` file control caching |
| **Always Online** | ON | Shows cached version if origin is down |
| **Tiered Cache** | ON | Reduces origin requests using upper-tier PoPs |

### Security

| Setting | Recommended | Why |
|---------|-------------|-----|
| **SSL/TLS** | Full (Strict) | End-to-end encryption |
| **Always Use HTTPS** | ON | Force HTTPS |
| **HSTS** | ON (via dashboard) | Browser remembers to use HTTPS |
| **Minimum TLS** | TLS 1.2 | Drop insecure protocols |

---

## R2 Strategy for Images

R2 is ideal for serving your images. Here's how to set it up:

### Why R2?
- **Zero egress fees** — no charge for bandwidth serving images
- **S3-compatible API** — easy to integrate
- **Cloudflare CDN integration** — images served from the nearest edge PoP
- **Custom domain** — serve from `images.mailysleguilloux.bzh` or a path like `/r2/`

### Setup Steps

1. **Create an R2 bucket** in the Cloudflare dashboard:
   ```
   Bucket name: mailysleguilloux-assets
   Location hint: EU (Western Europe) — closest to Bretagne
   ```

2. **Upload images** to R2:
   ```bash
   # Using wrangler
   npx wrangler r2 object put mailysleguilloux-assets/images/mailys.webp --file site/images/mailys.webp
   npx wrangler r2 object put mailysleguilloux-assets/images/mailys.jpg --file site/images/mailys.jpg
   # ... repeat for all images
   ```

3. **Connect a custom domain** (recommended):
   - Dashboard → R2 → Bucket → Settings → Public access
   - Add custom domain: `assets.mailysleguilloux.bzh`
   - This gives you CDN caching + your domain

4. **Update image paths** in `index.html`:
   ```html
   <!-- Before -->
   <source srcset="images/mailys.webp" type="image/webp">
   <img src="images/mailys.jpg" ...>

   <!-- After (with R2 custom domain) -->
   <source srcset="https://assets.mailysleguilloux.bzh/images/mailys.webp" type="image/webp">
   <img src="https://assets.mailysleguilloux.bzh/images/mailys.jpg" ...>
   ```

5. **Add Cache-Control on upload** for immutable caching:
   ```bash
   npx wrangler r2 object put mailysleguilloux-assets/images/mailys.webp \
     --file site/images/mailys.webp \
     --content-type image/webp \
     --cache-control "public, max-age=31536000, immutable"
   ```

### R2 Benefits for This Site
- Images are the heaviest assets (~1MB total)
- Zero egress fees means unlimited image views at no cost
- CDN-cached globally with Cloudflare's edge network
- You can remove images from the `site/` directory to keep the Pages deployment lightweight

---

## Other Cloudflare Features Worth Exploring

### Cloudflare Web Analytics (Free)
- Privacy-first analytics (no cookies, GDPR-compliant)
- Already partially set up via `observability: true` in `wrangler.jsonc`
- Add the JS snippet from the dashboard for client-side metrics

### Page Rules / Cache Rules
Create a cache rule for the Google Fonts CSS to extend caching:
```
If URL matches: fonts.googleapis.com/*
Cache TTL: 1 month
```

### Cloudflare Turnstile (Free CAPTCHA Alternative)
If you add a contact form later, use Turnstile instead of reCAPTCHA:
- Free, privacy-preserving
- Runs on Cloudflare's edge
- Integrates with Workers for server-side validation

### Workers KV
KV can be used for caching data at Cloudflare's edge with configurable TTL.
