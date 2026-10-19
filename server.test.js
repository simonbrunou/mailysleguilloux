// server.test.js
// Contact intake behaviour (validation, rate limit, Turnstile, Resend) is tested
// in contact-intake.test.js; this file covers headers, static files and routing.
import { test, expect } from "bun:test";
import { headersFor, createFetchHandler } from "./server.js";
import { createContactIntake, alwaysPassHumanCheck } from "./contact-intake.js";

const sent = [];
const mailer = { send: async (email) => { sent.push(email); return "sent"; } };
const fetchHandler = createFetchHandler({
  contactIntake: createContactIntake({ humanCheck: alwaysPassHumanCheck, mailer }),
});

// ── Task 2: Header rules ──────────────────────────────────────────────────────

test("global security headers on every path", () => {
  const h = headersFor("/anything.txt");
  expect(h["X-Content-Type-Options"]).toBe("nosniff");
  expect(h["X-Frame-Options"]).toBe("SAMEORIGIN");
  expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["Permissions-Policy"]).toBe("camera=(), microphone=(), geolocation=()");
  expect(h["Content-Security-Policy"]).toContain("default-src 'self'");
});

test("CSP locks sources down but allows the page's inline + Google Fonts origins", () => {
  const csp = headersFor("/index.html")["Content-Security-Policy"];
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("frame-ancestors 'self'");
  expect(csp).toContain("form-action 'self'");
  // inline <style>/<script>/onerror handlers must keep working on the static page
  expect(csp).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
  expect(csp).toContain("script-src 'self' 'unsafe-inline'");
  expect(csp).toContain("font-src 'self' https://fonts.gstatic.com");
});

test("homepage gets short cache + preload Links", () => {
  const h = headersFor("/index.html");
  expect(h["Cache-Control"]).toBe("public, max-age=3600, must-revalidate");
  expect(h["Link"]).toContain("</images/mailys.webp>; rel=preload; as=image");
  expect(h["Link"]).toContain("Cormorant+Garamond");
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

// ── Task 3: Static file serving ───────────────────────────────────────────────

test("serves index.html at /", async () => {
  const res = await fetchHandler(new Request("http://x/"));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/html");
  expect(res.headers.get("x-frame-options")).toBe("SAMEORIGIN");
  expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");
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

// ── Task 4: /contact routing ──────────────────────────────────────────────────

function post(body, ip = "1.1.1.1") {
  return new Request("http://x/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cf-Connecting-Ip": ip },
    body: JSON.stringify(body),
  });
}

test("OPTIONS /contact returns CORS preflight", async () => {
  const res = await fetchHandler(new Request("http://x/contact", { method: "OPTIONS" }));
  expect(res.status).toBe(204);
  expect(res.headers.get("access-control-allow-methods")).toContain("POST");
});

test("POST /contact answers with the contact intake's reply as JSON", async () => {
  const res = await fetchHandler(post({ name: "Jean", email: "j@example.com", message: "Bonjour" }, "1.1.1.1"));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("application/json");
  expect(res.headers.get("access-control-allow-origin")).toBe("https://mailysleguilloux.bzh");
  expect(await res.json()).toEqual({ ok: true, message: "Message envoyé avec succès." });
  expect(sent.at(-1).replyTo).toBe("j@example.com");
});

test("POST /contact keeps the contact intake's error status", async () => {
  const res = await fetchHandler(post({ name: "A" }, "2.2.2.2"));
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ ok: false, message: "Veuillez remplir les champs obligatoires (nom, e-mail, message)." });
});

test("other methods on /contact -> 405", async () => {
  const res = await fetchHandler(new Request("http://x/contact"));
  expect(res.status).toBe(405);
  expect(res.headers.get("allow")).toBe("POST, OPTIONS");
});
