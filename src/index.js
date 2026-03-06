const TO_EMAIL = "contact@mailysleguilloux.bzh";
const FROM_EMAIL = "Formulaire de contact <noreply@mailysleguilloux.bzh>";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/images/")) {
      const key = url.pathname.slice("/images/".length);
      const object = await env.R2.get(key);

      if (!object) {
        return new Response("Not Found", { status: 404 });
      }

      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("etag", object.httpEtag);
      headers.set("cache-control", "public, max-age=31536000, immutable");

      return new Response(object.body, { headers });
    }

    if (url.pathname === "/contact" && request.method === "POST") {
      return handleContact(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleContact(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, message: "Corps de requête invalide." }, 400);
  }

  const { name, email, subject, message } = body;

  if (!name || !email || !message) {
    return jsonResponse({ ok: false, message: "Veuillez remplir les champs obligatoires (nom, e-mail, message)." }, 400);
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse({ ok: false, message: "Adresse e-mail invalide." }, 400);
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

  return jsonResponse({ ok: true, message: "Message envoyé avec succès." }, 200);
}

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
