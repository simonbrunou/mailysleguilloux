# Deployment: mailysleguilloux.bzh

```
merge to main on git.sbrn.eu (Forgejo)
    |  push webhook
    v
homelab Coolify (application id 11, railpack build pack)
    |  builds, then runs `bun server.js` on port 3000
    v
container on CT 116
    |  Cloudflare Tunnel
    v
Cloudflare edge (cache, Fonts, Email Address Obfuscation) -> mailysleguilloux.bzh
```

The `github` remote is a push mirror of Forgejo and plays no part in a deploy. There is no
Dockerfile and no deploy config in the repo: Coolify's railpack build pack detects Bun and starts
the `start` script in `package.json`. Production env (`RESEND_API_KEY`, `TURNSTILE_SECRET_KEY`)
lives in the Coolify app's environment variables.

## How a deploy happens

Merging to `main` starts a deploy within seconds. It usually finishes in under a minute (up to
about 2 min). There is no manual deploy step and no staging environment: every merge to `main`
ships.

## Check the latest deploy

The HTTP headers carry no deploy marker. On a cache miss, `last-modified` is the time of the
request, not of the deploy. Check Coolify instead (both commands are read-only):

```sh
# Deploy rows: status should be `finished` and the commit the merge SHA.
echo "select id,status,left(commit,8),created_at,updated_at from application_deployment_queues where application_id='11' order by id desc limit 3;" \
  | ssh root@192.168.1.195 'pct exec 104 -- docker exec -i coolify-db psql -U coolify -d coolify -At -F "|"'

# Running container: its image tag is the full merge SHA.
ssh root@192.168.1.195 'pct exec 116 -- docker ps'
```

## Smoke checks

These never send the owner an e-mail:

| Request | Expected |
|---|---|
| `GET /` | 200 |
| `GET /contact` | 405 |
| `POST /contact` with body `{nope` | 400 `{"ok":false,"message":"Corps de requête invalide."}` |

A valid contact submission sends Maïlys a real e-mail through Resend. Leave real submissions to
the owner.

## Cloudflare edge

- **Edge cache**: Cloudflare caches the homepage, so right after a deploy `GET /` may still return
  the previous page (`cf-cache-status: HIT`). Add a throwaway query string (`/?cb=123`) to get
  the origin's copy.
- **Rewritten files**: the served `index.html` and `robots.txt` never match the repo copies byte
  for byte. Cloudflare Fonts replaces the Google Fonts `<link>`s with inline `@font-face` rules
  loading from `/cf-fonts/`, Email Address Obfuscation turns `mailto:` links into
  `/cdn-cgi/l/email-protection`, and Cloudflare prepends its managed Content-Signal block to
  `robots.txt`. To check content, grep the fetched page for your change, or run the facts guard on
  the live files: in a scratch worktree (`git worktree add --detach <dir> origin/main`), overwrite
  `site/index.html`, `site/sitemap.xml` and `site/robots.txt` with the fetched copies, then run
  `bun test business-facts.test.js`.

## Local development

```sh
bun server.js   # http://localhost:3000 (PORT overrides)
```
