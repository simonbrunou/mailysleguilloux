// server.js
import { join, normalize } from "path";
const SITE_DIR = join(import.meta.dir, "site");

const IMMUTABLE = new Set(["css","js","woff","woff2","webp","jpg","jpeg","png","svg","ico","avif"]);

// 'unsafe-inline' is required by the static page's inline <style>, inline <script>,
// and inline event handlers (onerror on <img>). External origins are limited to
// Google Fonts and the optional Cloudflare Insights beacon (currently commented out
// in index.html, pre-allowed so enabling it needs no CSP change).
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
  "img-src 'self' data:",
  "font-src 'self' https://fonts.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
  "connect-src 'self' https://cloudflareinsights.com",
].join("; ");

const SECURITY = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": CSP,
};

// Note: applying HOME_LINK preloads to both "/" and "/index.html" is an intentional,
// harmless divergence from the static _headers file (which only set them on "/").
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
  // Behind the Cloudflare Tunnel, cf-connecting-ip is always set; the fallbacks
  // are only for local/health-check requests.
  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "unknown";
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

  if (name.length > 200 || email.length > 254 || message.length > 5000 || (subject && subject.length > 300)) {
    return json({ ok: false, message: "Un ou plusieurs champs dépassent la longueur maximale autorisée." }, 400);
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

export async function fetchHandler(req) {
  const url = new URL(req.url);
  const pathname = decodeURIComponent(url.pathname);
  if (pathname === "/contact") {
    if (req.method === "OPTIONS") return preflight();
    if (req.method === "POST") return handleContact(req);
    return new Response("Method Not Allowed", {
      status: 405,
      headers: {
        "Allow": "POST, OPTIONS",
        "Access-Control-Allow-Origin": ALLOW_ORIGIN,
      },
    });
  }
  return serveStatic(pathname);
}

if (import.meta.main) {
  const port = Number(process.env.PORT) || 3000;
  Bun.serve({ port, fetch: fetchHandler });
  console.log(`mailysleguilloux listening on :${port}`);
}
