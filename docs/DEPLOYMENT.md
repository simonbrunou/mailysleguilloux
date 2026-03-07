# Deployment Guide - mailysleguilloux.bzh

## Architecture

```
GitHub (push to main)
    |
    v
Cloudflare Pages (auto-deploy)
    |
    v  mailysleguilloux.bzh
Cloudflare CDN (300+ edge locations)
```

---

## 1. Deploy to Cloudflare Pages

### Option A: Git integration (recommended)

1. Push your repo to GitHub
2. Go to **Cloudflare Dashboard** > **Workers & Pages** > **Create** > **Pages**
3. Connect your GitHub repository
4. Configure build settings:
   - **Project name**: `mailysleguilloux`
   - **Production branch**: `main`
   - **Build command**: (leave empty)
   - **Build output directory**: `site`
5. Click **Save and Deploy**

Every push to `main` auto-deploys.

### Option B: Direct upload via CLI

```bash
npx wrangler pages deploy site --project-name=mailysleguilloux
```

---

## 2. Custom Domain

1. In Cloudflare Pages project > **Custom domains**
2. Add `mailysleguilloux.bzh`
3. Cloudflare auto-configures DNS (CNAME to Pages)
4. Add `www.mailysleguilloux.bzh` as well (redirects to apex)

DNS records (auto-managed by Pages):

| Type  | Name | Content                          | Proxy     |
|-------|------|----------------------------------|-----------|
| CNAME | @    | `mailysleguilloux.pages.dev`     | Proxied   |
| CNAME | www  | `mailysleguilloux.pages.dev`     | Proxied   |

---

## 3. Verify Deployment

```bash
# Test the site
curl -I https://mailysleguilloux.bzh

```

Expected response:
```
HTTP/2 200
content-type: text/html; charset=utf-8
```

---

## Local Development

```bash
cd site
python3 -m http.server 8080
# Open http://localhost:8080
```

---

## Maintenance

### Redeploy manually (if not using Git integration)

```bash
npx wrangler pages deploy site --project-name=mailysleguilloux
```

### View deployment logs

In Cloudflare Dashboard > **Workers & Pages** > **mailysleguilloux** > **Deployments**

---

## Troubleshooting

### Site not updating after push

- Check Cloudflare Pages deployment status in the dashboard
- Verify the build output directory is set to `site`
- Check GitHub webhook delivery in repo Settings > Webhooks

### DNS not resolving

```bash
dig mailysleguilloux.bzh
# Should return Cloudflare IPs
```

If DNS doesn't resolve, verify the custom domain is configured in Pages settings.
