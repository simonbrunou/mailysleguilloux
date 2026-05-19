const TO_EMAIL = "contact@mailysleguilloux.bzh";
const FROM_EMAIL = "Formulaire de contact <noreply@mailysleguilloux.bzh>";
const ALLOWED_ORIGIN = "https://mailysleguilloux.bzh";

const MAX_BODY_BYTES = 16 * 1024;
const FIELD_LIMITS = {
  name: 100,
  email: 200,
  subject: 200,
  message: 5000,
};

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/images/")) {
      return handleImage(request, env, url);
    }

    if (url.pathname === "/contact") {
      if (request.method === "OPTIONS") return corsPreflight();
      if (request.method === "POST") return handleContact(request, env);
      return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST, OPTIONS" } });
    }

    // run_worker_first only routes /images/* and /contact here; everything else
    // is served from static assets and never reaches the Worker.
    return new Response("Not Found", { status: 404 });
  },
};

async function handleImage(request, env, url) {
  const key = url.pathname.slice("/images/".length);
  const method = request.method;

  if (method !== "GET" && method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }

  const object = method === "HEAD" ? await env.R2.head(key) : await env.R2.get(key);
  if (!object) return new Response("Not Found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");

  if (!headers.get("content-type")) {
    const ext = key.split(".").pop()?.toLowerCase();
    const mimeTypes = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      svg: "image/svg+xml",
      gif: "image/gif",
      avif: "image/avif",
    };
    headers.set("content-type", mimeTypes[ext] || "application/octet-stream");
  }

  headers.set("x-content-type-options", "nosniff");

  const body = method === "HEAD" ? null : object.body;
  return new Response(body, { headers });
}

function corsPreflight() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}

async function handleContact(request, env) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";

  // Per-PoP rate limit: 1 submission per IP per 60s.
  const cacheKey = new Request(`https://rate-limit.internal/contact/${ip}`);
  const cache = caches.default;
  if (await cache.match(cacheKey)) {
    return jsonResponse(
      { ok: false, message: "Veuillez patienter 60 secondes avant de renvoyer un message." },
      429
    );
  }

  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > MAX_BODY_BYTES) {
    return jsonResponse({ ok: false, message: "Message trop volumineux." }, 413);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, message: "Corps de requête invalide." }, 400);
  }

  const name = strField(body.name);
  const email = strField(body.email);
  const subject = strField(body.subject);
  const message = strField(body.message);
  const turnstileToken = strField(body.turnstileToken);

  if (!name || !email || !message) {
    return jsonResponse(
      { ok: false, message: "Veuillez remplir les champs obligatoires (nom, e-mail, message)." },
      400
    );
  }

  if (name.length > FIELD_LIMITS.name ||
      email.length > FIELD_LIMITS.email ||
      subject.length > FIELD_LIMITS.subject ||
      message.length > FIELD_LIMITS.message) {
    return jsonResponse({ ok: false, message: "Un ou plusieurs champs dépassent la longueur autorisée." }, 400);
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse({ ok: false, message: "Adresse e-mail invalide." }, 400);
  }

  if (env.TURNSTILE_SECRET_KEY) {
    if (!turnstileToken) {
      return jsonResponse({ ok: false, message: "Vérification anti-robot manquante." }, 400);
    }
    const verifyOk = await verifyTurnstile(turnstileToken, ip, env.TURNSTILE_SECRET_KEY);
    if (!verifyOk) {
      return jsonResponse({ ok: false, message: "Vérification anti-robot échouée." }, 400);
    }
  } else {
    console.warn("TURNSTILE_SECRET_KEY not set — skipping bot verification");
  }

  if (!env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY secret not configured");
    return jsonResponse({ ok: false, message: "Service de messagerie non configuré." }, 503);
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
  ]
    .filter((line) => line !== null)
    .join("\n");

  let resendRes;
  try {
    resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [TO_EMAIL],
        reply_to: email,
        subject: emailSubject,
        text: emailBody,
      }),
    });
  } catch (err) {
    console.error("Resend fetch error:", err);
    return jsonResponse({ ok: false, message: "Erreur réseau lors de l'envoi." }, 502);
  }

  if (!resendRes.ok) {
    const errText = await resendRes.text();
    console.error("Resend API error:", resendRes.status, errText);
    return jsonResponse({ ok: false, message: "Erreur lors de l'envoi de l'e-mail." }, 502);
  }

  await cache.put(
    cacheKey,
    new Response("1", { headers: { "Cache-Control": "public, max-age=60" } })
  );

  return jsonResponse({ ok: true, message: "Message envoyé avec succès." }, 200);
}

async function verifyTurnstile(token, ip, secret) {
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip && ip !== "unknown") form.append("remoteip", ip);

  try {
    const res = await fetch(TURNSTILE_VERIFY_URL, { method: "POST", body: form });
    if (!res.ok) {
      console.error("Turnstile verify HTTP error:", res.status);
      return false;
    }
    const data = await res.json();
    if (!data.success) {
      console.warn("Turnstile verify failed:", data["error-codes"]);
    }
    return data.success === true;
  } catch (err) {
    console.error("Turnstile verify network error:", err);
    return false;
  }
}

function strField(value) {
  return typeof value === "string" ? value.trim() : "";
}

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    },
  });
}
