// contact-intake.test.js
import { test, expect, spyOn, mock, afterEach } from "bun:test";
import {
  createContactIntake, contactIntakeFromEnv, alwaysPassHumanCheck, turnstileHumanCheck, resendMailer,
} from "./contact-intake.js";

afterEach(() => mock.restore());

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const RESEND = "https://api.resend.com/emails";

// ── Fakes ─────────────────────────────────────────────────────────────────────

// Adapters log their failures; keep test output clean and let tests assert on it.
function silence(method) {
  return spyOn(console, method).mockImplementation(() => {});
}

// A fetch stand-in that records each call and answers with a fresh Response.
function recordingFetch(respond = () => new Response("{}")) {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, init }); return respond(); };
  return { calls, fetch };
}

// A fetch stand-in that never answers: it settles only when the request's signal
// aborts, rejecting with the abort reason as fetch does.
function hangingFetch() {
  return (_, init) => new Promise((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal.reason));
  });
}

function fakeMailer(outcome = "sent") {
  const sent = [];
  return { sent, send: async (email) => { sent.push(email); return outcome; } };
}

function fakeHumanCheck(verdict = "passed") {
  const checked = [];
  return { checked, verify: async (submission) => { checked.push(submission); return verdict; } };
}

function intake({ humanCheck = alwaysPassHumanCheck, mailer = fakeMailer(), now = () => 0 } = {}) {
  return createContactIntake({ humanCheck, mailer, now });
}

function post(body, ip = "1.1.1.1") {
  return new Request("http://x/contact", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cf-Connecting-Ip": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const valid = { name: "Jean", email: "j@example.com", subject: "Hello", message: "Bonjour" };

// ── Contact intake ────────────────────────────────────────────────────────────

test("valid submission sends the e-mail and replies 200", async () => {
  const mailer = fakeMailer();
  const reply = await intake({ mailer }).submit(post(valid));
  expect(reply).toEqual({ status: 200, body: { ok: true, message: "Message envoyé avec succès." } });
  expect(mailer.sent).toHaveLength(1);
  const [email] = mailer.sent;
  expect(email.from).toBe("Formulaire de contact <noreply@mailysleguilloux.bzh>");
  expect(email.to).toBe("contact@mailysleguilloux.bzh");
  expect(email.replyTo).toBe("j@example.com");
  expect(email.subject).toBe("[Contact] Hello");
});

test("e-mail text lists the fields and the send time in Paris", async () => {
  const mailer = fakeMailer();
  await intake({ mailer, now: () => Date.UTC(2026, 9, 19, 12, 30) }).submit(post(valid));
  expect(mailer.sent[0].text).toBe([
    "Nouveau message reçu depuis le formulaire de contact de mailysleguilloux.bzh",
    "",
    "Nom    : Jean",
    "E-mail : j@example.com",
    "Objet  : Hello",
    "",
    "--- Message ---",
    "Bonjour",
    "",
    "--- Fin du message ---",
    "Envoyé le : 19/10/2026 14:30:00",
  ].join("\n"));
});

test("without a subject, the e-mail is titled after the sender and has no Objet line", async () => {
  const mailer = fakeMailer();
  await intake({ mailer }).submit(post({ ...valid, subject: "" }));
  expect(mailer.sent[0].subject).toBe("[Contact] Message de Jean");
  expect(mailer.sent[0].text).not.toContain("Objet");
});

const INVALID_BODY = "Corps de requête invalide.";
const REQUIRED = "Veuillez remplir les champs obligatoires (nom, e-mail, message).";
const TOO_LONG = "Un ou plusieurs champs dépassent la longueur maximale autorisée.";

test.each([
  ["unparseable JSON", "{nope", INVALID_BODY],
  ["a null body", "null", INVALID_BODY],
  ["an array body", "[]", INVALID_BODY],
  ["a non-string name", { ...valid, name: 1 }, INVALID_BODY],
  ["a non-string subject", { ...valid, subject: ["x"] }, INVALID_BODY],
  ["a non-string human-check token", { ...valid, "cf-turnstile-response": {} }, INVALID_BODY],
  ["a missing name", { email: "a@b.co", message: "x" }, REQUIRED],
  ["an empty message", { ...valid, message: "" }, REQUIRED],
  ["a name over 200 characters", { ...valid, name: "x".repeat(201) }, TOO_LONG],
  ["an e-mail over 254 characters", { ...valid, email: "a@b.co" + "x".repeat(249) }, TOO_LONG],
  ["a subject over 300 characters", { ...valid, subject: "x".repeat(301) }, TOO_LONG],
  ["a message over 5000 characters", { ...valid, message: "x".repeat(5001) }, TOO_LONG],
  ["an invalid e-mail", { ...valid, email: "nope" }, "Adresse e-mail invalide."],
])("rejects %s with 400 and sends nothing", async (_, body, message) => {
  const mailer = fakeMailer();
  const reply = await intake({ mailer }).submit(post(body));
  expect(reply).toEqual({ status: 400, body: { ok: false, message } });
  expect(mailer.sent).toHaveLength(0);
});

test("accepts fields at their maximum length", async () => {
  const reply = await intake().submit(post({
    name: "x".repeat(200),
    email: "a@b.co" + "x".repeat(248),
    subject: "x".repeat(300),
    message: "x".repeat(5000),
  }));
  expect(reply.status).toBe(200);
});

// ── Human check ───────────────────────────────────────────────────────────────

test("the human check gets the token and the visitor's IP before the e-mail is sent", async () => {
  const order = [];
  const humanCheck = { verify: async (s) => { order.push(["check", s]); return "passed"; } };
  const mailer = { send: async () => { order.push(["send"]); return "sent"; } };
  await intake({ humanCheck, mailer }).submit(post({ ...valid, "cf-turnstile-response": "tok" }, "4.4.4.4"));
  expect(order).toEqual([["check", { token: "tok", ip: "4.4.4.4" }], ["send"]]);
});

test("without cf-connecting-ip, the IP comes from x-forwarded-for", async () => {
  const humanCheck = fakeHumanCheck();
  const request = new Request("http://x/contact", {
    method: "POST",
    headers: { "X-Forwarded-For": "6.6.6.6" },
    body: JSON.stringify(valid),
  });
  await intake({ humanCheck }).submit(request);
  expect(humanCheck.checked[0].ip).toBe("6.6.6.6");
});

test.each([
  ["missing", 400, "Validation anti-robot manquante. Veuillez cocher la case."],
  ["failed", 400, "Échec de la validation anti-robot. Veuillez réessayer."],
  ["unavailable", 502, "Erreur lors de la validation anti-robot."],
])("human check %s -> %i and no e-mail", async (verdict, status, message) => {
  const mailer = fakeMailer();
  const reply = await intake({ humanCheck: fakeHumanCheck(verdict), mailer }).submit(post(valid));
  expect(reply).toEqual({ status, body: { ok: false, message } });
  expect(mailer.sent).toHaveLength(0);
});

// ── Mailer ────────────────────────────────────────────────────────────────────

test.each([
  ["unconfigured", 503, "Service de messagerie non configuré."],
  ["unreachable", 502, "Erreur réseau lors de l'envoi."],
  ["rejected", 502, "Erreur lors de l'envoi de l'e-mail."],
])("mailer %s -> %i", async (outcome, status, message) => {
  const reply = await intake({ mailer: fakeMailer(outcome) }).submit(post(valid));
  expect(reply).toEqual({ status, body: { ok: false, message } });
});

// ── Rate limit: one sent message per IP per 60 s ──────────────────────────────

const TOO_SOON = { status: 429, body: { ok: false, message: "Veuillez patienter 60 secondes avant de renvoyer un message." } };

test("after a sent message, the same IP waits 60 000 ms", async () => {
  let t = 1_000_000;
  const contact = intake({ now: () => t });
  expect((await contact.submit(post(valid, "9.9.9.9"))).status).toBe(200);
  t += 59_999;
  expect(await contact.submit(post(valid, "9.9.9.9"))).toEqual(TOO_SOON);
  t += 1;
  expect((await contact.submit(post(valid, "9.9.9.9"))).status).toBe(200);
});

test("the wait applies before the body is read", async () => {
  const contact = intake();
  await contact.submit(post(valid, "9.9.9.9"));
  expect(await contact.submit(post("{nope", "9.9.9.9"))).toEqual(TOO_SOON);
});

test("other IPs are not held back", async () => {
  const contact = intake();
  await contact.submit(post(valid, "9.9.9.9"));
  expect((await contact.submit(post(valid, "7.7.7.7"))).status).toBe(200);
});

test("a refused or failed submission does not use up the IP's budget", async () => {
  let outcome = "rejected";
  const mailer = { send: async () => outcome };
  const contact = intake({ mailer });
  expect((await contact.submit(post({ name: "A" }, "8.8.8.8"))).status).toBe(400);
  expect((await contact.submit(post(valid, "8.8.8.8"))).status).toBe(502);
  outcome = "sent";
  expect((await contact.submit(post(valid, "8.8.8.8"))).status).toBe(200);
});

// A mailer whose sends all wait until the test opens the gate.
function gatedMailer() {
  const gate = Promise.withResolvers();
  const sent = [];
  return { sent, open: gate.resolve, send: async (email) => { sent.push(email); return gate.promise; } };
}

test("parallel submissions from one IP send only one message", async () => {
  const mailer = gatedMailer();
  const contact = intake({ mailer });
  const first = contact.submit(post(valid, "2.2.2.2"));
  const second = contact.submit(post(valid, "2.2.2.2"));
  mailer.open("sent");
  expect((await first).status).toBe(200);
  expect(await second).toEqual(TOO_SOON);
  expect(mailer.sent).toHaveLength(1);
});

test("when the first of two parallel submissions fails, the next one from that IP reaches the mailer", async () => {
  const mailer = gatedMailer();
  const contact = intake({ mailer });
  const first = contact.submit(post(valid, "2.2.2.2"));
  expect(await contact.submit(post(valid, "2.2.2.2"))).toEqual(TOO_SOON);
  mailer.open("rejected");
  expect((await first).status).toBe(502);
  expect((await contact.submit(post(valid, "2.2.2.2"))).status).toBe(502);
  expect(mailer.sent).toHaveLength(2);
});

test("a mailer that throws does not lock the IP", async () => {
  let calls = 0;
  const mailer = { send: async () => { if (calls++ === 0) throw new Error("boom"); return "sent"; } };
  const contact = intake({ mailer });
  await expect(contact.submit(post(valid, "2.2.2.2"))).rejects.toThrow("boom");
  expect((await contact.submit(post(valid, "2.2.2.2"))).status).toBe(200);
});

async function waitFor(condition) {
  while (!condition()) await Bun.sleep(1);
}

test("a send that hangs past the window and then fails does not free a newer request's slot", async () => {
  let t = 0;
  const pending = {}; // replyTo -> resolve the send to an outcome
  const mailer = { send: (email) => new Promise((resolve) => { pending[email.replyTo] = resolve; }) };
  const contact = intake({ mailer, now: () => t });

  const first = contact.submit(post({ ...valid, email: "one@example.com" }, "2.2.2.2"));
  await waitFor(() => pending["one@example.com"]);
  t = 60_000; // the first send is still hanging when its reservation expires
  const second = contact.submit(post({ ...valid, email: "two@example.com" }, "2.2.2.2"));
  await waitFor(() => pending["two@example.com"]);

  pending["one@example.com"]("rejected");
  expect((await first).status).toBe(502);
  expect(await contact.submit(post(valid, "2.2.2.2"))).toEqual(TOO_SOON);
  pending["two@example.com"]("sent");
  expect((await second).status).toBe(200);
});

test("each contact intake keeps its own rate-limit state", async () => {
  await intake().submit(post(valid, "9.9.9.9"));
  expect((await intake().submit(post(valid, "9.9.9.9"))).status).toBe(200);
});

// ── Turnstile human-check adapter ─────────────────────────────────────────────

test("Turnstile posts the siteverify form and passes on success", async () => {
  const http = recordingFetch(() => Response.json({ success: true }));
  const check = turnstileHumanCheck({ secret: "s3cret", fetch: http.fetch });
  expect(await check.verify({ token: "tok", ip: "4.4.4.4" })).toBe("passed");
  expect(http.calls).toHaveLength(1);
  const [{ url, init }] = http.calls;
  expect(url).toBe(SITEVERIFY);
  expect(init.method).toBe("POST");
  expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
  expect(Object.fromEntries(new URLSearchParams(init.body))).toEqual({ secret: "s3cret", response: "tok", remoteip: "4.4.4.4" });
  expect(init.signal).toBeInstanceOf(AbortSignal);
});

test("Turnstile fails when siteverify says so", async () => {
  const http = recordingFetch(() => Response.json({ success: false }));
  const check = turnstileHumanCheck({ secret: "s", fetch: http.fetch });
  expect(await check.verify({ token: "bad", ip: "4.4.4.4" })).toBe("failed");
});

test("Turnstile reports a missing token without calling siteverify", async () => {
  const http = recordingFetch();
  const check = turnstileHumanCheck({ secret: "s", fetch: http.fetch });
  expect(await check.verify({ token: "", ip: "4.4.4.4" })).toBe("missing");
  expect(http.calls).toHaveLength(0);
});

test.each([
  ["siteverify is unreachable", () => { throw new TypeError("network down"); }],
  ["siteverify answers garbage", () => new Response("<html>", { status: 500 })],
])("Turnstile is unavailable when %s", async (_, respond) => {
  const logged = silence("error");
  const check = turnstileHumanCheck({ secret: "s", fetch: recordingFetch(respond).fetch });
  expect(await check.verify({ token: "tok", ip: "4.4.4.4" })).toBe("unavailable");
  expect(logged).toHaveBeenCalledTimes(1);
});

test("Turnstile is unavailable when siteverify does not answer in time", async () => {
  const logged = silence("error");
  const check = turnstileHumanCheck({ secret: "s", fetch: hangingFetch(), timeoutMs: 5 });
  expect(await check.verify({ token: "tok", ip: "4.4.4.4" })).toBe("unavailable");
  expect(logged).toHaveBeenCalledTimes(1);
});

// ── Resend mailer adapter ─────────────────────────────────────────────────────

const email = { from: "F <f@x.bzh>", to: "t@x.bzh", replyTo: "r@x.bzh", subject: "S", text: "T" };

test("Resend posts the e-mail as JSON with the API key", async () => {
  const http = recordingFetch(() => Response.json({ id: "1" }));
  const mailer = resendMailer({ apiKey: "re_key", fetch: http.fetch });
  expect(await mailer.send(email)).toBe("sent");
  expect(http.calls).toHaveLength(1);
  const [{ url, init }] = http.calls;
  expect(url).toBe(RESEND);
  expect(init.method).toBe("POST");
  expect(init.headers).toEqual({ Authorization: "Bearer re_key", "Content-Type": "application/json" });
  expect(JSON.parse(init.body)).toEqual({ from: "F <f@x.bzh>", to: ["t@x.bzh"], reply_to: "r@x.bzh", subject: "S", text: "T" });
  expect(init.signal).toBeInstanceOf(AbortSignal);
});

test("Resend reports a refused e-mail as rejected", async () => {
  const logged = silence("error");
  const mailer = resendMailer({ apiKey: "k", fetch: recordingFetch(() => new Response("err", { status: 500 })).fetch });
  expect(await mailer.send(email)).toBe("rejected");
  expect(logged).toHaveBeenCalledWith("Resend API error:", 500, "err");
});

test("Resend reports a network failure as unreachable", async () => {
  const logged = silence("error");
  const mailer = resendMailer({ apiKey: "k", fetch: recordingFetch(() => { throw new TypeError("network down"); }).fetch });
  expect(await mailer.send(email)).toBe("unreachable");
  expect(logged).toHaveBeenCalledTimes(1);
});

test("Resend is unreachable when the API does not answer in time", async () => {
  const logged = silence("error");
  const mailer = resendMailer({ apiKey: "k", fetch: hangingFetch(), timeoutMs: 5 });
  expect(await mailer.send(email)).toBe("unreachable");
  expect(logged).toHaveBeenCalledTimes(1);
});

// ── Composition from the environment ──────────────────────────────────────────

// One answer that satisfies both Turnstile (success) and Resend (2xx).
const allGood = () => Response.json({ success: true });

test("without TURNSTILE_SECRET_KEY, contact intake skips the human check and warns once at startup", async () => {
  const warned = silence("warn");
  const http = recordingFetch(allGood);
  const contact = contactIntakeFromEnv({ RESEND_API_KEY: "k" }, http.fetch);
  expect(warned).toHaveBeenCalledTimes(1);
  expect(warned.mock.calls[0][0]).toContain("TURNSTILE_SECRET_KEY");
  expect((await contact.submit(post(valid, "1.1.1.1"))).status).toBe(200);
  expect((await contact.submit(post(valid, "2.2.2.2"))).status).toBe(200);
  expect(http.calls.map((c) => c.url)).toEqual([RESEND, RESEND]);
  expect(warned).toHaveBeenCalledTimes(1);
});

test("with TURNSTILE_SECRET_KEY, contact intake checks Turnstile before Resend", async () => {
  const warned = silence("warn");
  const http = recordingFetch(allGood);
  const contact = contactIntakeFromEnv({ TURNSTILE_SECRET_KEY: "s", RESEND_API_KEY: "k" }, http.fetch);
  expect((await contact.submit(post(valid))).status).toBe(400);
  expect(http.calls).toHaveLength(0);
  expect((await contact.submit(post({ ...valid, "cf-turnstile-response": "tok" }))).status).toBe(200);
  expect(http.calls.map((c) => c.url)).toEqual([SITEVERIFY, RESEND]);
  expect(warned).not.toHaveBeenCalled();
});

test("without RESEND_API_KEY, contact intake replies 503 and sends nothing", async () => {
  silence("warn");
  const logged = silence("error");
  const http = recordingFetch(allGood);
  const reply = await contactIntakeFromEnv({}, http.fetch).submit(post(valid));
  expect(reply).toEqual({ status: 503, body: { ok: false, message: "Service de messagerie non configuré." } });
  expect(http.calls).toHaveLength(0);
  expect(logged).toHaveBeenCalledWith("RESEND_API_KEY not configured");
});
