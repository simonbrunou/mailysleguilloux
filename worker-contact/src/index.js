/**
 * Cloudflare Worker — Contact Form Handler
 *
 * Receives POST requests from the contact form on mailysleguilloux.bzh
 * and forwards them as emails to contact@mailysleguilloux.bzh via the
 * Resend API (https://resend.com — free tier: 3 000 emails/month).
 *
 * Required secret (set via wrangler secret put RESEND_API_KEY):
 *   RESEND_API_KEY  — your Resend API key (starts with "re_")
 *
 * Optional variable (wrangler.toml [vars]):
 *   ALLOWED_ORIGIN  — e.g. "https://mailysleguilloux.bzh"
 *   TO_EMAIL        — recipient address (default: contact@mailysleguilloux.bzh)
 *   FROM_EMAIL      — sender address verified in Resend (default: noreply@mailysleguilloux.bzh)
 */

const DEFAULT_TO = 'contact@mailysleguilloux.bzh';
const DEFAULT_FROM = 'Formulaire de contact <noreply@mailysleguilloux.bzh>';

export default {
  async fetch(request, env) {
    const allowedOrigin = env.ALLOWED_ORIGIN || 'https://mailysleguilloux.bzh';

    // Handle CORS pre-flight
    if (request.method === 'OPTIONS') {
      return cors(new Response(null, { status: 204 }), allowedOrigin);
    }

    if (request.method !== 'POST') {
      return cors(new Response('Method Not Allowed', { status: 405 }), allowedOrigin);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return cors(jsonError('Corps de requête invalide', 400), allowedOrigin);
    }

    const { name, email, subject, message, "cf-turnstile-response": turnstileToken } = body;

    // Verify Cloudflare Turnstile token
    if (!turnstileToken) {
      return cors(jsonError('Vérification anti-spam manquante.', 400), allowedOrigin);
    }

    if (!env.TURNSTILE_SECRET_KEY) {
      console.error('TURNSTILE_SECRET_KEY secret not configured');
      return cors(jsonError('Service de vérification non configuré.', 503), allowedOrigin);
    }

    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    const turnstileRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: env.TURNSTILE_SECRET_KEY,
        response: turnstileToken,
        remoteip: ip,
      }),
    });

    const turnstileData = await turnstileRes.json();
    if (!turnstileData.success) {
      return cors(jsonError('Échec de la vérification anti-spam. Veuillez réessayer.', 403), allowedOrigin);
    }

    if (!name || !email || !message) {
      return cors(jsonError('Champs requis manquants : nom, e-mail, message', 400), allowedOrigin);
    }

    // Basic e-mail format validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return cors(jsonError('Adresse e-mail invalide', 400), allowedOrigin);
    }

    if (!env.RESEND_API_KEY) {
      console.error('RESEND_API_KEY secret not configured');
      return cors(jsonError('Service de messagerie non configuré', 503), allowedOrigin);
    }

    const toEmail = env.TO_EMAIL || DEFAULT_TO;
    const fromEmail = env.FROM_EMAIL || DEFAULT_FROM;
    const emailSubject = subject
      ? `[Contact] ${subject}`
      : `[Contact] Message de ${name}`;

    const emailBody = [
      `Nouveau message reçu depuis le formulaire de contact de mailysleguilloux.bzh`,
      '',
      `Nom    : ${name}`,
      `E-mail : ${email}`,
      subject ? `Objet  : ${subject}` : null,
      '',
      '--- Message ---',
      message,
      '',
      '--- Fin du message ---',
      `Envoyé le : ${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}`,
    ]
      .filter((line) => line !== null)
      .join('\n');

    const resendPayload = {
      from: fromEmail,
      to: [toEmail],
      reply_to: email,
      subject: emailSubject,
      text: emailBody,
    };

    let resendRes;
    try {
      resendRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(resendPayload),
      });
    } catch (err) {
      console.error('Resend fetch error:', err);
      return cors(jsonError("Erreur lors de l'envoi de l'e-mail", 502), allowedOrigin);
    }

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      console.error('Resend API error:', resendRes.status, errText);
      return cors(jsonError("Erreur lors de l'envoi de l'e-mail", 502), allowedOrigin);
    }

    return cors(
      new Response(JSON.stringify({ ok: true, message: 'Message envoyé avec succès.' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
      allowedOrigin,
    );
  },
};

function jsonError(message, status) {
  return new Response(JSON.stringify({ ok: false, message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function cors(response, origin) {
  const res = new Response(response.body, response);
  res.headers.set('Access-Control-Allow-Origin', origin);
  res.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return res;
}
