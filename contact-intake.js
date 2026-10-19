// contact-intake.js
//
// Contact intake: turns a POST /contact request into a plain reply
// { status, body: { ok, message } } and, when the submission is accepted, an
// e-mail to Maïlys. It owns validation, the per-IP rate limit, the e-mail text and
// every message the visitor sees. Turnstile and Resend sit behind two injected
// adapters (human check, mailer) and time behind an injected clock, so each
// instance is self-contained: build one at startup, or a fresh one per test.

const TO_EMAIL = "contact@mailysleguilloux.bzh";
const FROM_EMAIL = "Formulaire de contact <noreply@mailysleguilloux.bzh>";
const RATE_WINDOW_MS = 60_000;

function reply(status, message) {
  return { status, body: { ok: status === 200, message } };
}

// What the visitor is told for each human-check verdict and mailer outcome
// other than "passed" / "sent".
const REJECTIONS = {
  missing: [400, "Validation anti-robot manquante. Veuillez cocher la case."],
  failed: [400, "Échec de la validation anti-robot. Veuillez réessayer."],
  unavailable: [502, "Erreur lors de la validation anti-robot."],
  unconfigured: [503, "Service de messagerie non configuré."],
  unreachable: [502, "Erreur réseau lors de l'envoi."],
  rejected: [502, "Erreur lors de l'envoi de l'e-mail."],
};

const FIELDS = ["name", "email", "subject", "message", "cf-turnstile-response"];

// Returns the submitted fields as strings ("" when absent or null), or null when
// the body isn't a JSON object of strings.
async function readFields(request) {
  let body;
  try { body = await request.json(); } catch { return null; }
  if (body === null || typeof body !== "object" || Array.isArray(body)) return null;
  const fields = {};
  for (const key of FIELDS) {
    const value = body[key] ?? "";
    if (typeof value !== "string") return null;
    fields[key] = value;
  }
  return fields;
}

// Returns the message explaining why the fields are refused, or null.
function validationError({ name, email, subject, message }) {
  if (!name || !email || !message) return "Veuillez remplir les champs obligatoires (nom, e-mail, message).";
  if (name.length > 200 || email.length > 254 || message.length > 5000 || subject.length > 300) {
    return "Un ou plusieurs champs dépassent la longueur maximale autorisée.";
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Adresse e-mail invalide.";
  return null;
}

function composeEmail({ name, email, subject, message }, sentAt) {
  const text = [
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
    `Envoyé le : ${new Date(sentAt).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}`,
  ].filter((l) => l !== null).join("\n");
  return {
    from: FROM_EMAIL,
    to: TO_EMAIL,
    replyTo: email,
    subject: subject ? `[Contact] ${subject}` : `[Contact] Message de ${name}`,
    text,
  };
}

// Behind the Cloudflare Tunnel, cf-connecting-ip is always set; the fallbacks
// are only for local/health-check requests.
function clientIp(request) {
  return request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown";
}

export function createContactIntake({ humanCheck, mailer, now = Date.now }) {
  // ip -> epoch ms of the last sent message, or of the start of one in flight
  const slots = new Map();

  async function submit(request) {
    const ip = clientIp(request);
    for (const [key, t] of slots) if (now() - t >= RATE_WINDOW_MS) slots.delete(key);
    if (slots.has(ip)) {
      return reply(429, "Veuillez patienter 60 secondes avant de renvoyer un message.");
    }

    // Reserve the slot before the first await so parallel requests from one IP
    // can't all pass; only a sent message keeps it.
    slots.set(ip, now());
    let result;
    try {
      result = await deliver(request, ip);
      return result;
    } finally {
      if (result?.status === 200) slots.set(ip, now());
      else slots.delete(ip);
    }
  }

  async function deliver(request, ip) {
    const fields = await readFields(request);
    if (!fields) return reply(400, "Corps de requête invalide.");
    const invalid = validationError(fields);
    if (invalid) return reply(400, invalid);

    const verdict = await humanCheck.verify({ token: fields["cf-turnstile-response"], ip });
    if (verdict !== "passed") return reply(...REJECTIONS[verdict]);

    const outcome = await mailer.send(composeEmail(fields, now()));
    if (outcome !== "sent") return reply(...REJECTIONS[outcome]);
    return reply(200, "Message envoyé avec succès.");
  }

  return { submit };
}

// ── Human-check adapters: verify({ token, ip }) resolves to "passed",
// "missing", "failed" or "unavailable". ──────────────────────────────────────

// Fail-open stand-in, composed when TURNSTILE_SECRET_KEY is unset.
export const alwaysPassHumanCheck = { verify: async () => "passed" };

export function turnstileHumanCheck({ secret, fetch }) {
  return {
    async verify({ token, ip }) {
      if (!token) return "missing";
      try {
        const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ secret, response: token, remoteip: ip }),
        });
        const outcome = await res.json();
        return outcome.success ? "passed" : "failed";
      } catch (err) {
        console.error("Turnstile verify error:", err);
        return "unavailable";
      }
    },
  };
}

// ── Mailer adapters: send({ from, to, replyTo, subject, text }) resolves to
// "sent", "unconfigured", "unreachable" or "rejected". ───────────────────────

// Composed when RESEND_API_KEY is unset: every submission gets a 503.
export const unconfiguredMailer = {
  async send() {
    console.error("RESEND_API_KEY not configured");
    return "unconfigured";
  },
};

export function resendMailer({ apiKey, fetch }) {
  return {
    async send({ from, to, replyTo, subject, text }) {
      let res;
      try {
        res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from, to: [to], reply_to: replyTo, subject, text }),
        });
      } catch (err) {
        console.error("Resend fetch error:", err);
        return "unreachable";
      }
      if (!res.ok) {
        console.error("Resend API error:", res.status, await res.text());
        return "rejected";
      }
      return "sent";
    },
  };
}

// ── Composition ───────────────────────────────────────────────────────────────

// Reads the secrets once. Turnstile fails open (always-pass adapter) when
// TURNSTILE_SECRET_KEY is unset and enforces when it's set; a missing
// RESEND_API_KEY makes every submission a 503.
export function contactIntakeFromEnv(env, fetch = globalThis.fetch) {
  let humanCheck = alwaysPassHumanCheck;
  if (env.TURNSTILE_SECRET_KEY) humanCheck = turnstileHumanCheck({ secret: env.TURNSTILE_SECRET_KEY, fetch });
  else console.warn("TURNSTILE_SECRET_KEY not set: the contact form accepts submissions without a human check");

  const mailer = env.RESEND_API_KEY ? resendMailer({ apiKey: env.RESEND_API_KEY, fetch }) : unconfiguredMailer;
  return createContactIntake({ humanCheck, mailer });
}
