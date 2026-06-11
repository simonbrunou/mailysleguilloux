// server.test.js
import { test, expect, beforeEach, afterEach } from "bun:test";
import { headersFor, fetchHandler, __resetRateLimit } from "./server.js";

// ── Task 2: Header rules ──────────────────────────────────────────────────────

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

// ── Task 3: Static file serving ───────────────────────────────────────────────

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

// ── Task 4: /contact endpoint ─────────────────────────────────────────────────

// alias to match the plan's test code
const fh = fetchHandler;

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
