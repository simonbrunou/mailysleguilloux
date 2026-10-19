// server.test.js
// Contact intake behaviour (validation, rate limit, Turnstile, Resend) is tested
// in contact-intake.test.js; this file covers the header policy, static files and
// routing, all through fetchHandler.
import { test, expect } from "bun:test";
import { join } from "path";
import { createFetchHandler } from "./server.js";
import { createContactIntake, alwaysPassHumanCheck } from "./contact-intake.js";

// A handler around a fresh contact intake, so no test inherits another's rate limit.
function handler(sent = []) {
  const mailer = { send: async (email) => { sent.push(email); return "sent"; } };
  return createFetchHandler({ contactIntake: createContactIntake({ humanCheck: alwaysPassHumanCheck, mailer }) });
}
const fetchHandler = handler();

function get(path) {
  return fetchHandler(new Request("http://x" + path));
}

function post(body, ip = "1.1.1.1") {
  return new Request("http://x/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cf-Connecting-Ip": ip },
    body: JSON.stringify(body),
  });
}

// ── Header policy: every response, whatever produced it ───────────────────────

const CSP =
  "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; " +
  "img-src 'self' data:; font-src 'self' https://fonts.gstatic.com; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com https://challenges.cloudflare.com; " +
  "connect-src 'self' https://cloudflareinsights.com https://challenges.cloudflare.com; " +
  "frame-src https://challenges.cloudflare.com";

test("every response carries the security headers and the CSP", async () => {
  const requests = [
    new Request("http://x/"),
    new Request("http://x/robots.txt"),
    new Request("http://x/images/mailys.webp"),
    new Request("http://x/no-such-page"),
    new Request("http://x/..%2fpackage.json"),
    new Request("http://x/%E0%A4%A"),
    new Request("http://x/a%00b"),
    new Request("http://x/contact"),
    new Request("http://x/contact", { method: "OPTIONS" }),
    post({ name: "Jean", email: "j@example.com", message: "Bonjour" }),
    post({ name: "A" }),
  ];
  for (const req of requests) {
    const res = await handler()(req);
    const where = `${req.method} ${req.url} (${res.status})`;
    expect([where, res.headers.get("x-content-type-options")]).toEqual([where, "nosniff"]);
    expect([where, res.headers.get("x-frame-options")]).toEqual([where, "SAMEORIGIN"]);
    expect([where, res.headers.get("referrer-policy")]).toEqual([where, "strict-origin-when-cross-origin"]);
    expect([where, res.headers.get("permissions-policy")]).toEqual([where, "camera=(), microphone=(), geolocation=()"]);
    expect([where, res.headers.get("content-security-policy")]).toEqual([where, CSP]);
  }
});

// ── CSP vs what site/index.html loads ─────────────────────────────────────────

const SITE = "https://mailysleguilloux.bzh";
const PRELOAD_AS = { style: "style-src", script: "script-src", font: "font-src", image: "img-src", fetch: "connect-src" };

// Third-party resources load more once they run, which index.html can't show.
// Keyed by the origin that triggers them.
const FOLLOW_ON_LOADS = {
  "https://fonts.googleapis.com": [["font-src", "https://fonts.gstatic.com"]], // the stylesheet's @font-face files
  "https://challenges.cloudflare.com": [["frame-src", "https://challenges.cloudflare.com"]], // the Turnstile widget iframe
  "https://static.cloudflareinsights.com": [["connect-src", "https://cloudflareinsights.com"]], // the beacon's reports
};

// [directive, origin] for every external origin site/index.html loads from.
async function externalLoads() {
  const loads = [];
  const add = (directive, url) => {
    const { origin } = new URL(url, SITE);
    if (origin !== SITE) loads.push([directive, origin]);
  };
  const attr = (name, directive) => ({ element: (el) => add(directive, el.getAttribute(name)) });
  const srcset = {
    element: (el) => el.getAttribute("srcset").split(",").forEach((c) => c.trim() && add("img-src", c.trim().split(/\s+/)[0])),
  };
  const link = {
    element(el) {
      const rel = (el.getAttribute("rel") || "").toLowerCase().split(/\s+/);
      const href = el.getAttribute("href");
      if (rel.includes("stylesheet")) add("style-src", href);
      else if (rel.includes("preload")) add(PRELOAD_AS[el.getAttribute("as")] ?? "default-src", href);
      else if (rel.includes("modulepreload")) add("script-src", href);
      else if (rel.includes("icon") || rel.includes("apple-touch-icon")) add("img-src", href);
      // preconnect / dns-prefetch / canonical / alternate load nothing CSP governs
    },
  };
  await new HTMLRewriter()
    .on("link[href]", link)
    .on("script[src]", attr("src", "script-src"))
    .on("iframe[src]", attr("src", "frame-src"))
    .on("img[src]", attr("src", "img-src"))
    .on("img[srcset]", srcset)
    .on("source[srcset]", srcset)
    .on("form[action]", attr("action", "form-action"))
    .transform(new Response(Bun.file(join(import.meta.dir, "site", "index.html"))))
    .text();
  for (const [, origin] of [...loads]) loads.push(...(FOLLOW_ON_LOADS[origin] ?? []));
  return loads;
}

test("the CSP allows every external origin site/index.html loads", async () => {
  const csp = (await get("/")).headers.get("content-security-policy");
  const sources = Object.fromEntries(csp.split("; ").map((d) => [d.split(" ")[0], d.split(" ").slice(1)]));
  const loads = await externalLoads();
  expect(loads.length).toBeGreaterThan(0);
  const blocked = loads.filter(([directive, origin]) => !(sources[directive] ?? sources["default-src"]).includes(origin));
  expect(blocked).toEqual([]);
});

// ── Cache-Control and Link, keyed on the file served ──────────────────────────

test("the homepage gets a short cache and preload Links, whichever URL serves it", async () => {
  for (const path of ["/", "/index.html", "/index"]) {
    const res = await get(path);
    expect([path, res.status]).toEqual([path, 200]);
    expect([path, res.headers.get("cache-control")]).toEqual([path, "public, max-age=3600, must-revalidate"]);
    expect(res.headers.get("link")).toContain("</images/mailys.webp>; rel=preload; as=image");
    expect(res.headers.get("link")).toContain("Cormorant+Garamond");
  }
});

test("sitemap and robots get a day cache", async () => {
  for (const path of ["/sitemap.xml", "/robots.txt"]) {
    const res = await get(path);
    expect([path, res.status]).toEqual([path, 200]);
    expect([path, res.headers.get("cache-control")]).toEqual([path, "public, max-age=86400, must-revalidate"]);
  }
});

test("images get an immutable one-year cache", async () => {
  for (const path of ["/images/mailys.webp", "/images/mailys.jpg", "/images/favicon.avif"]) {
    const res = await get(path);
    expect([path, res.status]).toEqual([path, 200]);
    expect([path, res.headers.get("cache-control")]).toEqual([path, "public, max-age=31536000, immutable"]);
  }
});

test("a 404 is never cached, even for a missing image", async () => {
  for (const path of ["/no-such-page", "/images/missing.webp"]) {
    const res = await get(path);
    expect([path, res.status]).toEqual([path, 404]);
    expect([path, res.headers.get("cache-control")]).toEqual([path, null]);
  }
});

// ── Static file serving ───────────────────────────────────────────────────────

test("serves index.html at /", async () => {
  const res = await get("/");
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/html");
});

test("unknown path returns 404 page", async () => {
  const res = await get("/no-such-page");
  expect(res.status).toBe(404);
  expect(res.headers.get("content-type")).toContain("text/html");
});

test("the 404 page answers 404 under its own URL too", async () => {
  for (const path of ["/404", "/404.html"]) {
    const res = await get(path);
    expect([path, res.status]).toEqual([path, 404]);
  }
});

// new URL() already resolves a literal "/../", so only an encoded slash reaches
// the guard with ".." still in the decoded path.
test("an encoded path traversal gets the 404 page, not a file outside site/", async () => {
  const notFoundPage = await Bun.file(join(import.meta.dir, "site", "404.html")).text();
  for (const path of ["/..%2fpackage.json", "/images%2f..%2f..%2fserver.js"]) {
    const res = await get(path);
    expect([path, res.status]).toEqual([path, 404]);
    expect([path, await res.text()]).toEqual([path, notFoundPage]);
  }
});

test("a URL that can't name a file gets 400 instead of an exception", async () => {
  for (const path of ["/%E0%A4%A", "/a%00b"]) {
    const res = await get(path);
    expect([path, res.status]).toEqual([path, 400]);
    expect([path, res.headers.get("content-type")]).toEqual([path, "text/plain; charset=utf-8"]);
  }
});

// ── /contact routing ──────────────────────────────────────────────────────────

test("POST /contact answers with the contact intake's reply as JSON", async () => {
  const sent = [];
  const res = await handler(sent)(post({ name: "Jean", email: "j@example.com", message: "Bonjour" }));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("application/json");
  expect(await res.json()).toEqual({ ok: true, message: "Message envoyé avec succès." });
  expect(sent).toHaveLength(1);
  expect(sent[0].replyTo).toBe("j@example.com");
});

test("POST /contact keeps the contact intake's error status", async () => {
  const res = await handler()(post({ name: "A" }));
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ ok: false, message: "Veuillez remplir les champs obligatoires (nom, e-mail, message)." });
});

test("every method but POST on /contact gets 405, OPTIONS included", async () => {
  for (const method of ["GET", "OPTIONS", "PUT"]) {
    const res = await fetchHandler(new Request("http://x/contact", { method }));
    expect([method, res.status]).toEqual([method, 405]);
    expect([method, res.headers.get("allow")]).toEqual([method, "POST"]);
  }
});

test("no response carries CORS headers: the form posts same-origin", async () => {
  const requests = [
    new Request("http://x/contact", { method: "OPTIONS" }),
    new Request("http://x/contact"),
    post({ name: "Jean", email: "j@example.com", message: "Bonjour" }),
  ];
  for (const req of requests) {
    const res = await handler()(req);
    const cors = [...res.headers.keys()].filter((name) => name.startsWith("access-control-"));
    expect([req.method, cors]).toEqual([req.method, []]);
  }
});
