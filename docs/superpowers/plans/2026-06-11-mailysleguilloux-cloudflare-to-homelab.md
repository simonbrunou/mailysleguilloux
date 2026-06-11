# mailysleguilloux.bzh — Cloudflare → Homelab Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-home the site's compute (CF Worker → a Bun server on a dedicated Coolify CT) and storage (R2 → in-repo images), keeping Cloudflare Tunnel/DNS as the front door and Resend as the email sender.

**Architecture:** A single `Bun.serve` process serves the static `site/` directory and handles `POST /contact` (validate → rate-limit → Resend), porting the Worker's `fetch` handler nearly verbatim. It deploys via railpack+Bun to a new dedicated CT (CT116) onboarded as a Coolify server. The public hostname is added to the existing Terraform-managed Homelab Cloudflare Tunnel.

**Tech Stack:** Bun (`Bun.serve`, `bun:test`), Coolify (railpack build pack), Cloudflare Tunnel + DNS via OpenTofu (`homelab-stacks`), Resend HTTP API.

**Two repos are touched:**
- `simonbrunou/mailysleguilloux` (this repo, branch `migrate-off-cloudflare`) — app code, Tasks 1–5 + 9.
- `homelab-stacks` (on the Proxmox host, `/root/work/homelab-stacks`) — CT provisioning + Terraform tunnel/DNS, Tasks 6–8.

**Execution-assigned parameters** (set once, reused everywhere they appear):
- `CT116_IP` — the static IP assigned to CT116 in Task 6 (next free in the homelab range; CT114=`.149`, CT115=`.125`). All later references to `<CT116_IP>` use this value.
- `APP_PORT` — the port `Bun.serve` listens on. This plan fixes it at **3000**.

---

## File Structure

`simonbrunou/mailysleguilloux`:
- Create: `server.js` — the Bun server (static serving + `/contact`). Exports `fetch` handler + helpers for testing.
- Create: `server.test.js` — `bun:test` suite covering static serving, headers, 404, and the full `/contact` contract.
- Create: `package.json` — `start` script + test script; railpack needs an explicit start command.
- Create: `site/images/{mailys.jpg,mailys.webp,cabinet-1.jpg,cabinet-1.webp,og-image.jpg,favicon.avif}` — the 6 images, committed (replaces R2).
- Delete: `src/index.js`, `wrangler.jsonc` — CF Worker artifacts.
- Keep: `site/` (HTML/_headers/sitemap/robots/404) as the static root; `_headers` becomes the documented source for the header rules reproduced in `server.js`.

`homelab-stacks`:
- Modify: `terraform/cloudflare/tunnel-config.tf` — add ingress entry (before the catch-all).
- Modify: `terraform/cloudflare/records-mailysleguilloux_bzh.tf` (new file) — proxied CNAME + zone data source.

---

## Task 1: Project scaffolding (package.json)

**Files:**
- Create: `package.json`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "mailysleguilloux",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "bun server.js",
    "test": "bun test"
  }
}
```

- [ ] **Step 2: Verify Bun is available and the file parses**

Run: `bun --version && bun -e "JSON.parse(require('fs').readFileSync('package.json'))" && echo OK`
Expected: a version string then `OK`

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add package.json with bun start/test scripts"
```

---

## Task 2: Header rules module (port of site/_headers)

Static responses must carry the same security + cache headers the CF `_headers` file applied. Build this as a pure function first (easy to unit-test), then wire it into the server in Task 3.

**Files:**
- Create: `server.js` (initial — `headersFor` only)
- Create: `server.test.js` (header tests)

- [ ] **Step 1: Write the failing test**

```js
// server.test.js
import { test, expect } from "bun:test";
import { headersFor } from "./server.js";

test("global security headers on every path", () => {
  const h = headersFor("/anything.txt");
  expect(h["X-Content-Type-Options"]).toBe("nosniff");
  expect(h["X-Frame-Options"]).toBe("SAMEORIGIN");
  expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["Permissions-Policy"]).toBe("camera=(), microphone=(), geolocation=()");
});

test("homepage gets short cache + preload Links", () => {
  const h = headersFor("/index.html");
  expect(h["Cache-Control"]).toBe("public, max-age=3600, must-revalidate");
  expect(h["Link"]).toContain("</images/mailys.webp>; rel=preload; as=image");
});

test("static assets get immutable 1y cache", () => {
  for (const p of ["/a.css", "/b.js", "/c.webp", "/d.jpg", "/e.woff2", "/f.svg", "/g.avif"]) {
    expect(headersFor(p)["Cache-Control"]).toBe("public, max-age=31536000, immutable");
  }
});

test("sitemap/robots get day cache", () => {
  expect(headersFor("/sitemap.xml")["Cache-Control"]).toBe("public, max-age=86400, must-revalidate");
  expect(headersFor("/robots.txt")["Cache-Control"]).toBe("public, max-age=86400, must-revalidate");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server.test.js`
Expected: FAIL — `headersFor` is not exported / `server.js` missing.

- [ ] **Step 3: Write minimal implementation**

```js
// server.js
const IMMUTABLE = new Set(["css","js","woff","woff2","webp","jpg","jpeg","png","svg","ico","avif"]);

const SECURITY = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

const HOME_LINK =
  "</images/mailys.webp>; rel=preload; as=image; type=image/webp, " +
  "<https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Raleway:wght@300;400;500&display=swap>; rel=preload; as=style";

export function headersFor(pathname) {
  const h = { ...SECURITY };
  const ext = pathname.split(".").pop().toLowerCase();

  if (pathname === "/" || pathname === "/index.html") {
    h["Cache-Control"] = "public, max-age=3600, must-revalidate";
    h["Link"] = HOME_LINK;
  } else if (pathname === "/sitemap.xml" || pathname === "/robots.txt") {
    h["Cache-Control"] = "public, max-age=86400, must-revalidate";
  } else if (IMMUTABLE.has(ext)) {
    h["Cache-Control"] = "public, max-age=31536000, immutable";
  }
  return h;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server.js server.test.js
git commit -m "feat: port _headers rules into headersFor()"
```

---

## Task 3: Static file serving

**Files:**
- Modify: `server.js` (add `serveStatic`, `notFound`, and the request `handler`)
- Modify: `server.test.js` (static tests)

- [ ] **Step 1: Write the failing test**

```js
// append to server.test.js
import { fetchHandler } from "./server.js";

test("serves index.html at /", async () => {
  const res = await fetchHandler(new Request("http://x/"));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/html");
  expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
});

test("serves a known static asset with immutable cache", async () => {
  const res = await fetchHandler(new Request("http://x/robots.txt"));
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("public, max-age=86400, must-revalidate");
});

test("unknown path returns 404 page", async () => {
  const res = await fetchHandler(new Request("http://x/no-such-page"));
  expect(res.status).toBe(404);
  expect(res.headers.get("content-type")).toContain("text/html");
});

test("path traversal is rejected", async () => {
  const res = await fetchHandler(new Request("http://x/../package.json"));
  expect(res.status).toBe(404);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server.test.js`
Expected: FAIL — `fetchHandler` not exported.

- [ ] **Step 3: Write minimal implementation**

```js
// add near top of server.js
import { join, normalize } from "path";
const SITE_DIR = join(import.meta.dir, "site");

function notFound() {
  return new Response(Bun.file(join(SITE_DIR, "404.html")), {
    status: 404,
    headers: { ...SECURITY, "Content-Type": "text/html; charset=utf-8" },
  });
}

async function serveStatic(pathname) {
  if (pathname.endsWith("/")) pathname += "index.html";
  // strip leading slashes, normalize, block traversal
  const rel = normalize(pathname).replace(/^([/\\]|\.\.([/\\]|$))+/, "");
  const filePath = join(SITE_DIR, rel);
  if (!filePath.startsWith(SITE_DIR + "/") && filePath !== SITE_DIR) return notFound();

  let file = Bun.file(filePath);
  if (!(await file.exists())) {
    const html = Bun.file(filePath + ".html"); // html_handling: auto-trailing-slash
    if (await html.exists()) file = html;
    else return notFound();
  }
  return new Response(file, { headers: headersFor("/" + rel) });
}

export async function fetchHandler(req) {
  const url = new URL(req.url);
  const pathname = decodeURIComponent(url.pathname);
  // /contact wired in Task 4
  return serveStatic(pathname);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server.test.js`
Expected: PASS (all static + header tests). The `/` and traversal tests require `site/index.html` and `site/404.html`, which already exist in the repo.

- [ ] **Step 5: Commit**

```bash
git add server.js server.test.js
git commit -m "feat: static file serving with header rules and traversal guard"
```

---

## Task 4: /contact endpoint (validation, Resend, rate limit)

Ports `handleContact` from `src/index.js` verbatim, swapping the CF Cache API rate-limit for an in-memory `Map` keyed by `Cf-Connecting-Ip`.

**Files:**
- Modify: `server.js` (add `handleContact`, preflight, rate-limit, wire into `fetchHandler`)
- Modify: `server.test.js` (contact tests, with mocked global `fetch`)

- [ ] **Step 1: Write the failing test**

```js
// append to server.test.js
import { test, expect, beforeEach, afterEach } from "bun:test";
import { fetchHandler as fh, __resetRateLimit } from "./server.js";

const realFetch = globalThis.fetch;
beforeEach(() => { process.env.RESEND_API_KEY = "test_key"; __resetRateLimit(); });
afterEach(() => { globalThis.fetch = realFetch; });

function post(body, ip = "1.1.1.1") {
  return new Request("http://x/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cf-Connecting-Ip": ip },
    body: JSON.stringify(body),
  });
}

test("OPTIONS /contact returns CORS preflight", async () => {
  const res = await fh(new Request("http://x/contact", { method: "OPTIONS" }));
  expect(res.status).toBe(204);
  expect(res.headers.get("access-control-allow-methods")).toContain("POST");
});

test("missing required fields -> 400", async () => {
  const res = await fh(post({ name: "A" }));
  expect(res.status).toBe(400);
  expect((await res.json()).ok).toBe(false);
});

test("invalid email -> 400", async () => {
  const res = await fh(post({ name: "A", email: "nope", message: "hi" }));
  expect(res.status).toBe(400);
});

test("valid submission sends via Resend and returns 200", async () => {
  let captured;
  globalThis.fetch = async (urlArg, opts) => {
    captured = { urlArg, opts };
    return new Response("{}", { status: 200 });
  };
  const res = await fh(post({ name: "Jean", email: "j@example.com", subject: "Hello", message: "Bonjour" }));
  expect(res.status).toBe(200);
  expect((await res.json()).ok).toBe(true);
  expect(captured.urlArg).toBe("https://api.resend.com/emails");
  const sent = JSON.parse(captured.opts.body);
  expect(sent.to).toEqual(["contact@mailysleguilloux.bzh"]);
  expect(sent.reply_to).toBe("j@example.com");
  expect(sent.subject).toBe("[Contact] Hello");
});

test("second submission from same IP within 60s -> 429", async () => {
  globalThis.fetch = async () => new Response("{}", { status: 200 });
  const ok = await fh(post({ name: "A", email: "a@b.co", message: "x" }, "9.9.9.9"));
  expect(ok.status).toBe(200);
  const again = await fh(post({ name: "A", email: "a@b.co", message: "x" }, "9.9.9.9"));
  expect(again.status).toBe(429);
});

test("Resend failure does NOT consume the rate-limit budget", async () => {
  globalThis.fetch = async () => new Response("err", { status: 500 });
  const fail = await fh(post({ name: "A", email: "a@b.co", message: "x" }, "8.8.8.8"));
  expect(fail.status).toBe(502);
  globalThis.fetch = async () => new Response("{}", { status: 200 });
  const ok = await fh(post({ name: "A", email: "a@b.co", message: "x" }, "8.8.8.8"));
  expect(ok.status).toBe(200);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test server.test.js`
Expected: FAIL — `__resetRateLimit` / contact handling not implemented.

- [ ] **Step 3: Write minimal implementation**

```js
// add to server.js
const TO_EMAIL = "contact@mailysleguilloux.bzh";
const FROM_EMAIL = "Formulaire de contact <noreply@mailysleguilloux.bzh>";
const ALLOW_ORIGIN = "https://mailysleguilloux.bzh";
const RATE_WINDOW_MS = 60_000;

const lastSeen = new Map(); // ip -> epoch ms of last successful send
export function __resetRateLimit() { lastSeen.clear(); }

// periodic eviction so the Map can't grow unbounded
setInterval(() => {
  const now = Date.now();
  for (const [ip, ts] of lastSeen) if (now - ts > RATE_WINDOW_MS) lastSeen.delete(ip);
}, RATE_WINDOW_MS).unref?.();

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": ALLOW_ORIGIN },
  });
}

function preflight() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": ALLOW_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}

async function handleContact(req) {
  const ip = req.headers.get("cf-connecting-ip") || "unknown";
  const prev = lastSeen.get(ip);
  if (prev && Date.now() - prev < RATE_WINDOW_MS) {
    return json({ ok: false, message: "Veuillez patienter 60 secondes avant de renvoyer un message." }, 429);
  }

  let body;
  try { body = await req.json(); }
  catch { return json({ ok: false, message: "Corps de requête invalide." }, 400); }

  const { name, email, subject, message } = body;
  if (!name || !email || !message) {
    return json({ ok: false, message: "Veuillez remplir les champs obligatoires (nom, e-mail, message)." }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ ok: false, message: "Adresse e-mail invalide." }, 400);
  }
  if (!process.env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY not configured");
    return json({ ok: false, message: "Service de messagerie non configuré." }, 503);
  }

  const emailSubject = subject ? `[Contact] ${subject}` : `[Contact] Message de ${name}`;
  const emailBody = [
    "Nouveau message reçu depuis le formulaire de contact de mailysleguilloux.bzh",
    "",
    `Nom    : ${name}`,
    `E-mail : ${email}`,
    subject ? `Objet  : ${subject}` : null,
    "",
    "--- Message ---",
    message,
    "",
    "--- Fin du message ---",
    `Envoyé le : ${new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}`,
  ].filter((l) => l !== null).join("\n");

  let resendRes;
  try {
    resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM_EMAIL, to: [TO_EMAIL], reply_to: email, subject: emailSubject, text: emailBody }),
    });
  } catch (err) {
    console.error("Resend fetch error:", err);
    return json({ ok: false, message: "Erreur réseau lors de l'envoi." }, 502);
  }
  if (!resendRes.ok) {
    console.error("Resend API error:", resendRes.status, await resendRes.text());
    return json({ ok: false, message: "Erreur lors de l'envoi de l'e-mail." }, 502);
  }

  lastSeen.set(ip, Date.now()); // only consume budget on success
  return json({ ok: true, message: "Message envoyé avec succès." }, 200);
}
```

Then update `fetchHandler` to route `/contact` before static:

```js
export async function fetchHandler(req) {
  const url = new URL(req.url);
  const pathname = decodeURIComponent(url.pathname);
  if (pathname === "/contact") {
    if (req.method === "OPTIONS") return preflight();
    if (req.method === "POST") return handleContact(req);
    return new Response("Method Not Allowed", { status: 405 });
  }
  return serveStatic(pathname);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test server.test.js`
Expected: PASS (all tests across Tasks 2–4).

- [ ] **Step 5: Commit**

```bash
git add server.js server.test.js
git commit -m "feat: /contact endpoint with Resend + in-memory rate limit"
```

---

## Task 5: Boot the server, commit images, remove Worker artifacts

**Files:**
- Modify: `server.js` (add the `Bun.serve` boot guard)
- Create: `site/images/*` (6 files)
- Delete: `src/index.js`, `wrangler.jsonc`

- [ ] **Step 1: Add the server boot guard at the end of `server.js`**

```js
// server.js (end of file)
if (import.meta.main) {
  const port = Number(process.env.PORT) || 3000;
  Bun.serve({ port, fetch: fetchHandler });
  console.log(`mailysleguilloux listening on :${port}`);
}
```

- [ ] **Step 2: Download the 6 images from the live site into `site/images/`**

Run:
```bash
UA='Mozilla/5.0 (X11; Linux x86_64) Chrome/124.0 Safari/537.36'
mkdir -p site/images
for f in mailys.jpg mailys.webp cabinet-1.jpg cabinet-1.webp og-image.jpg favicon.avif; do
  curl -s -A "$UA" -f "https://mailysleguilloux.bzh/images/$f" -o "site/images/$f" \
    && echo "ok $f $(stat -c%s site/images/$f)B" || echo "MISSING $f"
done
```
Expected: 6 `ok` lines, total ~0.73 MB, no `MISSING`.
Note: these 6 are every image referenced by the live HTML. If R2 holds extra
unreferenced objects they are unused and intentionally dropped.

- [ ] **Step 3: Remove the Worker artifacts**

Run: `git rm src/index.js wrangler.jsonc`

- [ ] **Step 4: Smoke-test the running server locally**

Run:
```bash
PORT=3000 RESEND_API_KEY=dummy bun server.js & SRV=$!; sleep 1
curl -s -o /dev/null -w "home=%{http_code}\n" http://localhost:3000/
curl -s -o /dev/null -w "img=%{http_code} type=%{content_type}\n" http://localhost:3000/images/mailys.webp
curl -s -o /dev/null -w "404=%{http_code}\n" http://localhost:3000/nope
kill $SRV
```
Expected: `home=200`, `img=200 type=image/webp`, `404=404`.

- [ ] **Step 5: Full test run + commit**

Run: `bun test`
Expected: PASS (all tests).
```bash
git add server.js site/images
git commit -m "feat: serve locally, commit images in-repo, drop CF Worker artifacts"
```

- [ ] **Step 6: Push the branch and open the PR (do NOT merge yet)**

Run:
```bash
git push -u origin migrate-off-cloudflare
gh pr create --title "Migrate hosting off Cloudflare (Worker/R2 -> Bun on homelab)" \
  --body "Re-homes compute to a Bun server and storage to in-repo images. Keeps CF Tunnel/DNS + Resend. See docs/superpowers/specs + plans. Deploy + tunnel cutover tracked in homelab-stacks."
```
Expected: a PR URL. Leave it open; merge happens at cutover (Task 9).

---

## Task 6: Provision CT116 as a Coolify server

Operational task on the Proxmox host. Follow the **CT115/cortado onboarding precedent** (dedicated Coolify *server* CT). All commands run on the host (`/root`).

**Files:** none (infrastructure).

- [ ] **Step 1: Pick and record `CT116_IP`**

Run: `pct list | awk '{print $1}' | sort -n | tail; echo "CT114=192.168.1.149 CT115=192.168.1.125"`
Choose the next free static IP and use it as `<CT116_IP>` for the rest of the plan.

- [ ] **Step 2: Create CT116 on the zguests pool, unprivileged, onboot=1**

Provision a Debian 12 unprivileged LXC named `mailysleguilloux`, rootfs on `zguests`, `onboot=1`, with the chosen static IP — matching the existing Coolify-server CTs (CT114/CT115). Install Docker, then onboard it into Coolify as a new **server** (Coolify UI → Servers → Add, or the API), exactly as cortado/CT115 was onboarded.

Verify:
Run: `pct config 116 | grep -E "rootfs|onboot"` → rootfs on `zguests`, `onboot: 1`.
Run (in CT): `pct exec 116 -- env -i TMPDIR=/tmp HOME=/root docker info >/dev/null && echo docker-ok`.

- [ ] **Step 3: Confirm Coolify sees the server as reachable**

In Coolify, the new server's connection check passes (green). Record the Coolify `server uuid` for Task 7.

- [ ] **Step 4: Commit any IaC/runbook note**

If CT inventory is tracked in `homelab-stacks`, add CT116 to that record and commit:
```bash
cd /root/work/homelab-stacks
git add -A && git commit -m "infra: add CT116 (mailysleguilloux Coolify server)" || echo "nothing to track"
```

---

## Task 7: Create the Coolify application + env

**Files:** none (Coolify API/UI).

- [ ] **Step 1: Create the app from the GitHub repo on CT116**

Create a Coolify application on the CT116 server:
- Source: `simonbrunou/mailysleguilloux`, branch `migrate-off-cloudflare` (switch to default branch after merge).
- Build pack: **railpack**.
- Port: **3000** (matches `APP_PORT`).
- Domains: leave internal for now (public hostname comes via the tunnel in Task 8). Per the Coolify API gotcha, the field is `domains`, not `fqdn`.

- [ ] **Step 2: Set the Resend secret with `is_preview:false`**

Add env var `RESEND_API_KEY` (value = the production Resend key) via the Coolify API `envs/bulk` with `is_preview:false` — API-created env vars default to `is_preview:true` and are excluded from the production container otherwise. Then restart the app.

Verify after first deploy (Step 3):
Run: `pct exec 116 -- env -i TMPDIR=/tmp HOME=/root bash -lc 'docker inspect $(docker ps -q --filter name=mailys) --format "{{range .Config.Env}}{{println .}}{{end}}" | grep -c RESEND_API_KEY'`
Expected: `1`.

- [ ] **Step 3: Deploy and verify internally**

Trigger a deploy. Confirm a healthy container and an internal 200:
Run: `curl -s -o /dev/null -w "%{http_code}\n" http://<CT116_IP>:3000/`
Expected: `200`.
Run: `curl -s -o /dev/null -w "%{http_code} %{content_type}\n" http://<CT116_IP>:3000/images/mailys.webp`
Expected: `200 image/webp`.

---

## Task 8: Add the tunnel ingress + DNS (Terraform)

**Files:**
- Modify: `terraform/cloudflare/tunnel-config.tf`
- Create: `terraform/cloudflare/records-mailysleguilloux_bzh.tf`

All commands run in `/root/work/homelab-stacks`.

- [ ] **Step 1: Assert the zone is in the homelab account (pre-flight)**

Confirm `mailysleguilloux.bzh` resolves under account `ddeae68ec2f77cc93313c8a96be86c34` (same account that owns the Homelab tunnel and the Worker/bucket). If it is NOT, stop — the single-tunnel approach doesn't apply and the zone must first be moved into this account.

- [ ] **Step 2: Add the ingress entry BEFORE the catch-all**

In `terraform/cloudflare/tunnel-config.tf`, inside the `ingress = [ ... ]` list, add (immediately before the final `http_status:404` catch-all entry):

```hcl
      {
        hostname = "mailysleguilloux.bzh"
        service  = "http://<CT116_IP>:3000"
      },
```

- [ ] **Step 3: Add the zone data source + proxied CNAME**

Create `terraform/cloudflare/records-mailysleguilloux_bzh.tf`:

```hcl
# DNS for mailysleguilloux.bzh — apex CNAME flattened onto the Homelab tunnel.
data "cloudflare_zone" "mailysleguilloux_bzh" {
  filter = { name = "mailysleguilloux.bzh" }
}

resource "cloudflare_dns_record" "mailysleguilloux_bzh_apex" {
  zone_id = data.cloudflare_zone.mailysleguilloux_bzh.zone_id
  name    = "mailysleguilloux.bzh"
  type    = "CNAME"
  content = "${cloudflare_zero_trust_tunnel_cloudflared.homelab.id}.cfargotunnel.com"
  proxied = true
  ttl     = 1
}
```
Note: match the resource/attribute style already used in `records-simonbrunou_bzh.tf` (provider version pinning may differ slightly — mirror that file exactly if the schema disagrees).

- [ ] **Step 4: Plan and review**

Run: `cd /root/work/homelab-stacks && tofu -chdir=terraform/cloudflare plan`
Expected: exactly two changes — the tunnel config gains one ingress entry; one new `cloudflare_dns_record` is created. No other resources change. (If `www.mailysleguilloux.bzh` is also wanted, add a second CNAME record mirroring the apex.)

- [ ] **Step 5: Commit + open IaC PR (apply via the normal dispatch flow)**

```bash
git checkout -b mailysleguilloux-tunnel
git add terraform/cloudflare/tunnel-config.tf terraform/cloudflare/records-mailysleguilloux_bzh.tf
git commit -m "feat(cf): route mailysleguilloux.bzh through the Homelab tunnel to CT116"
git push -u origin mailysleguilloux-tunnel
gh pr create --fill
```
Apply through the repo's existing CI/dispatch apply flow (not a local `tofu apply`).

---

## Task 9: Cutover + Cloudflare teardown

**Files:** none (operational).

- [ ] **Step 1: Verify end-to-end through the tunnel**

After the IaC apply, DNS for `mailysleguilloux.bzh` now points at the tunnel.
Run:
```bash
UA='Mozilla/5.0 (X11; Linux x86_64) Chrome/124.0 Safari/537.36'
curl -s -A "$UA" -o /dev/null -w "home=%{http_code}\n" https://mailysleguilloux.bzh/
curl -s -A "$UA" -o /dev/null -w "img=%{http_code} %{content_type}\n" https://mailysleguilloux.bzh/images/mailys.webp
```
Expected: `home=200`, `img=200 image/webp`.

- [ ] **Step 2: Send a REAL contact-form submission and confirm delivery**

Submit the live contact form (or `curl -X POST https://mailysleguilloux.bzh/contact` with a valid JSON body) and confirm the email arrives at `contact@mailysleguilloux.bzh`. Then confirm the 60s rate-limit returns 429 on an immediate second POST from the same client.

- [ ] **Step 3: Merge the app PR and switch the deployed branch to default**

Merge the `migrate-off-cloudflare` PR. In Coolify, point the app at the default branch and redeploy. Re-run Step 1 to confirm still green.

- [ ] **Step 4: Decommission the Cloudflare Worker (after a grace period)**

Once stable for the agreed grace period, delete the Worker `mailysleguilloux` (CF dashboard or `wrangler delete`). Confirm the site still serves (now only via the tunnel).

- [ ] **Step 5: Delete the R2 bucket**

Empty and delete `mailysleguilloux-images`. Confirm `/images/*` still serves from the CT.

- [ ] **Step 6: Final verification**

Re-run Step 1 + a contact submission. Update the homelab memory/runbook to record CT116 + the new architecture.

---

## Self-Review notes

- **Spec coverage:** compute move (Tasks 1–5,7), storage move (Task 5 images + Task 9 R2 delete), Resend unchanged (Task 4 uses it as-is), rate-limit reimplementation (Task 4), `_headers` reproduction (Task 2), dedicated CT116 (Task 6), tunnel/DNS in same account (Task 8), Worker teardown (Task 9). All spec sections map to tasks.
- **Availability tradeoff:** documented in the spec; no task needed.
- **Parameters not placeholders:** `<CT116_IP>` is an execution-assigned value fixed in Task 6 Step 1; `APP_PORT`=3000 fixed throughout.
- **Type consistency:** `fetchHandler`, `headersFor`, `__resetRateLimit`, `handleContact`, `serveStatic`, `notFound`, `preflight`, `json` — names used consistently across Tasks 2–5 and the tests.
