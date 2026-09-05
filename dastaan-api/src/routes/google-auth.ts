/* ------------------------------------------------------------------ */
/* Sign in with Google (PRD 3: the login screen offers it).            */
/*                                                                     */
/* Server-side authorization-code flow, not the browser one. The whole */
/* app authenticates with an httpOnly cookie that JavaScript cannot    */
/* read; handing a token to the page and posting it back would give    */
/* that up for no benefit. The code never reaches the browser either:  */
/* Google redirects here, this service exchanges it, sets the same     */
/* session cookie the password login sets, and bounces to the web app. */
/*                                                                     */
/* Protections:                                                        */
/*   state   — random, stored in a short-lived httpOnly cookie and      */
/*             compared on return. Without it anyone could hand a user  */
/*             a crafted callback URL and log them into someone else's  */
/*             account (login CSRF).                                    */
/*   PKCE    — the code is useless to anyone who intercepts it without  */
/*             the verifier, which never leaves this service.           */
/*   nonce   — binds the id_token to this particular sign-in attempt.   */
/*                                                                     */
/* Google is only ever a way IN. The account model does not change:     */
/* clients still have a user ID, and a Google signup gets one           */
/* generated for them from their email.                                */
/* ------------------------------------------------------------------ */

import type { FastifyInstance, FastifyReply } from "fastify";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { db, uid, now } from "../db.js";
import { config } from "../config.js";
import { issueSession, audit } from "../security.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

const FLOW_COOKIE = "dastaan_oauth";
const FLOW_MINUTES = 10;

type Flow = { state: string; verifier: string; nonce: string; next: string };

/** Only ever redirect somewhere on our own site. */
const safeNext = (raw: string | undefined): string => {
  if (!raw) return "/book";
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/book";
};

const webOrigin = () =>
  (process.env.WEB_ORIGINS ?? "http://localhost:3000").split(",")[0]!.trim();

const base64url = (b: Buffer) => b.toString("base64url");

/** A user ID from an email, made unique if it is already taken. */
async function userIdFromEmail(email: string): Promise<string> {
  const base = (email.split("@")[0] ?? "client")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "")
    .slice(0, 24) || "client";
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? base : `${base}${attempt + 1}`;
    const taken = await db.prepare("SELECT id FROM users WHERE user_id = ?").get(candidate);
    if (!taken) return candidate;
  }
  return `${base}.${randomBytes(3).toString("hex")}`;
}

function fail(reply: FastifyReply, reason: string) {
  /* Never dump OAuth errors on the screen — bounce back to the login page
     with a short code the web app turns into a sentence. */
  return reply.redirect(`${webOrigin()}/login?error=${encodeURIComponent(reason)}`);
}

export default async function googleAuthRoutes(app: FastifyInstance) {
  /* -------- 1. send the user to Google -------- */
  app.get("/auth/google/start", async (req, reply) => {
    const g = config.auth.google;
    if (!g.enabled)
      return reply.code(503).send({ error: "Google sign-in is not configured" });

    const q = req.query as { next?: string; returnTo?: string };
    const flow: Flow = {
      state: base64url(randomBytes(24)),
      verifier: base64url(randomBytes(48)),
      nonce: base64url(randomBytes(16)),
      next: safeNext(q.returnTo ?? q.next),
    };

    /* The flow cookie has to survive Google's cross-site redirect back to us,
       so it needs SameSite=None; that in turn requires Secure, which is why
       this only works over HTTPS in production. */
    const secure = process.env.NODE_ENV === "production";
    reply.setCookie(FLOW_COOKIE, JSON.stringify(flow), {
      httpOnly: true,
      sameSite: secure ? "none" : "lax",
      secure,
      path: "/",
      maxAge: FLOW_MINUTES * 60,
    });

    const challenge = base64url(createHash("sha256").update(flow.verifier).digest());
    const url = new URL(AUTH_URL);
    url.searchParams.set("client_id", g.clientId);
    url.searchParams.set("redirect_uri", g.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("state", flow.state);
    url.searchParams.set("nonce", flow.nonce);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("prompt", "select_account");
    return reply.redirect(url.toString());
  });

  /* -------- 2. Google sends them back here -------- */
  app.get("/auth/google/callback", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const g = config.auth.google;
      if (!g.enabled) return fail(reply, "google_off");

      const q = req.query as { code?: string; state?: string; error?: string };
      if (q.error) return fail(reply, "cancelled");
      if (!q.code || !q.state) return fail(reply, "bad_response");

      let flow: Flow;
      try {
        flow = JSON.parse(req.cookies?.[FLOW_COOKIE] ?? "");
      } catch {
        return fail(reply, "expired");
      }
      reply.clearCookie(FLOW_COOKIE, { path: "/" });

      /* the check that makes login CSRF impossible */
      if (!flow.state || flow.state !== q.state) return fail(reply, "bad_state");

      /* ---- exchange the code, server to server ---- */
      let idToken: string;
      try {
        const res = await fetch(TOKEN_URL, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code: q.code,
            client_id: g.clientId,
            client_secret: g.clientSecret,
            redirect_uri: g.redirectUri,
            grant_type: "authorization_code",
            code_verifier: flow.verifier,
          }),
        });
        if (!res.ok) return fail(reply, "exchange_failed");
        const body = (await res.json()) as { id_token?: string };
        if (!body.id_token) return fail(reply, "no_id_token");
        idToken = body.id_token;
      } catch {
        return fail(reply, "google_unreachable");
      }

      /* ---- read the identity ----
         The token came straight from Google over TLS in the call above, so the
         signature is not what protects us here — the channel is. We still check
         the claims that bind it to this attempt and this app. */
      let claims: { sub?: string; email?: string; email_verified?: boolean; name?: string; nonce?: string; aud?: string; iss?: string };
      try {
        const payload = idToken.split(".")[1];
        if (!payload) return fail(reply, "bad_token");
        claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      } catch {
        return fail(reply, "bad_token");
      }

      if (claims.aud !== g.clientId) return fail(reply, "wrong_audience");
      if (claims.nonce !== flow.nonce) return fail(reply, "bad_nonce");
      if (!claims.iss || !/accounts\.google\.com$/.test(claims.iss.replace(/^https:\/\//, "")))
        return fail(reply, "bad_issuer");
      if (!claims.sub) return fail(reply, "no_subject");
      if (!claims.email || claims.email_verified === false) return fail(reply, "email_unverified");

      const googleSub = claims.sub;
      const email = claims.email.toLowerCase();
      const name = (claims.name ?? email.split("@")[0] ?? "Client").slice(0, 80);

      /* ---- find, link, or create ---- */
      type U = { id: string; name: string; role: string };
      let user = await db.prepare(
        "SELECT id, name, role FROM users WHERE google_sub = ?"
      ).get(googleSub) as U | undefined;

      if (!user) {
        /* Same person, already has a password account: link the two rather
           than creating a duplicate with a second loyalty balance. */
        const byEmail = await db.prepare(
          "SELECT id, name, role FROM users WHERE lower(email) = ? AND role = 'client'"
        ).get(email) as U | undefined;

        if (byEmail) {
          await db.prepare("UPDATE users SET google_sub = ? WHERE id = ?").run(googleSub, byEmail.id);
          await audit("google_linked", { actorId: byEmail.id, actorRole: "client", detail: email, ip: req.ip });
          user = byEmail;
        } else {
          const id = uid();
          const userId = await userIdFromEmail(email);
          await db.prepare(
            `INSERT INTO users (id, role, user_id, name, email, google_sub, created_at)
             VALUES (?,?,?,?,?,?,?)`
          ).run(id, "client", userId, name, email, googleSub, now());
          await audit("google_signup", { actorId: id, actorRole: "client", detail: email, ip: req.ip });
          user = { id, name, role: "client" };
        }
      }

      /* Staff never sign in this way — the front desk uses the keypad, and a
         Google account must not become a route into the console. */
      if (user.role !== "client") return fail(reply, "not_a_client_account");

      await issueSession(reply, { sub: user.id, role: "client", branchId: null, name: user.name });
      return reply.redirect(`${webOrigin()}${safeNext(flow.next)}`);
    });
}
