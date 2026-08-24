import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, uid, now, checkLock, recordFailure, clearFailures } from "../db.js";
import {
  hashPassword,
  verifyPassword,
  dummyCompare,
  hmacCode,
  issueSession,
  clearSession,
  readSession,
  requireAuth,
  audit,
  type Role,
} from "../security.js";
import { issueResetToken, sendResetEmail, checkResetToken, consumeResetToken } from "../password-reset.js";

const codeSchema = z.object({ code: z.string().regex(/^\d{4}$/, "4 digits") });

const registerSchema = z.object({
  userId: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_.-]+$/, "letters, numbers, _ . - only"),
  name: z.string().min(2).max(80),
  /* Email matters beyond contact: it is what links a password account to the
     same person arriving later through Google, instead of creating a second
     account with its own loyalty balance. */
  email: z.string().email().max(120),
  phone: z.string().min(7).max(24),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  userId: z.string().min(1).max(32),
  password: z.string().min(1).max(128),
});

const lockedReply = (seconds: number) => ({
  error: `Too many attempts — locked for ${seconds}s`,
  retryAfter: seconds,
});

export default async function authRoutes(app: FastifyInstance) {
  /* -------- staff login: 4-digit code ONLY (the code IS the identity) -------- */
  app.post("/auth/team", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const parsed = codeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Enter a 4-digit code" });

    const key = `team:${req.ip}`;
    const locked = await checkLock(key);
    if (locked > 0) return reply.code(429).send(lockedReply(locked));

    const row = await db
      .prepare(
        "SELECT id, role, branch_id, name FROM users WHERE code_hmac = ? AND active = 1 AND role != 'client'"
      )
      .get(hmacCode(parsed.data.code)) as
      | { id: string; role: Role; branch_id: string | null; name: string }
      | undefined;

    if (!row) {
      const lockFor = await recordFailure(key);
      await audit("staff_login_failed", { ip: req.ip });
      if (lockFor > 0) return reply.code(429).send(lockedReply(lockFor));
      return reply.code(401).send({ error: "Code not recognised" });
    }

    await clearFailures(key);
    await issueSession(reply, { sub: row.id, role: row.role, branchId: row.branch_id, name: row.name });
    await audit("staff_login", { actorId: row.id, actorRole: row.role, ip: req.ip });
    return { name: row.name, role: row.role, branchId: row.branch_id };
  });

  /* -------- staff: change own code -------- */
  app.post("/auth/team/change-code", async (req, reply) => {
    const s = await requireAuth(req, reply);
    if (!s) return;
    if (s.role === "client") return reply.code(403).send({ error: "Not allowed" });
    const parsed = codeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "New code must be 4 digits" });
    const h = hmacCode(parsed.data.code);
    const clash = await db.prepare("SELECT id FROM users WHERE code_hmac = ? AND id != ?").get(h, s.sub);
    if (clash) return reply.code(409).send({ error: "That code is unavailable" });
    await db.prepare("UPDATE users SET code_hmac = ? WHERE id = ?").run(h, s.sub);
    await audit("staff_code_changed_self", { actorId: s.sub, actorRole: s.role, ip: req.ip });
    return { ok: true };
  });

  /* -------- client register: user ID + password -------- */
  app.post("/auth/client/register", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    const { userId, name, email, phone, password } = parsed.data;

    const exists = await db.prepare("SELECT id FROM users WHERE user_id = ?").get(userId.toLowerCase());
    if (exists) return reply.code(409).send({ error: "That user ID is taken" });

    const emailTaken = await db.prepare(
      "SELECT id FROM users WHERE lower(email) = ? AND role = 'client'"
    ).get(email.toLowerCase());
    if (emailTaken)
      return reply.code(409).send({ error: "There is already an account with that email — try signing in" });

    const id = uid();
    await db.prepare(
      "INSERT INTO users (id, role, user_id, name, email, phone, password_hash, created_at) VALUES (?,?,?,?,?,?,?,?)"
    ).run(id, "client", userId.toLowerCase(), name, email.toLowerCase(), phone, await hashPassword(password), now());

    await issueSession(reply, { sub: id, role: "client", branchId: null, name });
    await audit("client_registered", { actorId: id, actorRole: "client", ip: req.ip });
    return { name, role: "client" };
  });

  /* -------- client login: user ID + password -------- */
  app.post("/auth/client/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Enter your user ID and password" });
    const userId = parsed.data.userId.toLowerCase();

    const key = `client:${req.ip}:${userId}`;
    const locked = await checkLock(key);
    if (locked > 0) return reply.code(429).send(lockedReply(locked));

    const row = await db
      .prepare(
        "SELECT id, name, password_hash FROM users WHERE user_id = ? AND role = 'client' AND active = 1"
      )
      .get(userId) as { id: string; name: string; password_hash: string | null } | undefined;

    const ok = row?.password_hash
      ? await verifyPassword(parsed.data.password, row.password_hash)
      : (await dummyCompare(), false); // equalize timing for unknown IDs

    if (!ok || !row) {
      const lockFor = await recordFailure(key);
      await audit("client_login_failed", { ip: req.ip, detail: userId });
      if (lockFor > 0) return reply.code(429).send(lockedReply(lockFor));
      return reply.code(401).send({ error: "Wrong user ID or password" });
    }

    await clearFailures(key);
    await issueSession(reply, { sub: row.id, role: "client", branchId: null, name: row.name });
    await audit("client_login", { actorId: row.id, actorRole: "client", ip: req.ip });
    return { name: row.name, role: "client" };
  });

  /* -------- online shop login: user ID + password --------
     A separate door from the team keypad, on purpose. The person running the
     online shop is not on the salon floor: they have no chair, no branch and
     no reason to hold a code that opens the till. Same lockout as everywhere
     else, and the same deliberate vagueness in the error — "wrong user ID or
     password" tells an attacker nothing about which half was wrong. */
  app.post("/auth/shop/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Enter your user ID and password" });
    const userId = parsed.data.userId.toLowerCase();

    const key = `shop:${req.ip}:${userId}`;
    const locked = await checkLock(key);
    if (locked > 0) return reply.code(429).send(lockedReply(locked));

    const row = await db
      .prepare(
        "SELECT id, name, password_hash FROM users WHERE user_id = ? AND role = 'shop_manager' AND active = 1"
      )
      .get(userId) as { id: string; name: string; password_hash: string | null } | undefined;

    const ok = row?.password_hash
      ? await verifyPassword(parsed.data.password, row.password_hash)
      : (await dummyCompare(), false); // equalize timing for unknown IDs

    if (!ok || !row) {
      const lockFor = await recordFailure(key);
      await audit("shop_login_failed", { ip: req.ip, detail: userId });
      if (lockFor > 0) return reply.code(429).send(lockedReply(lockFor));
      return reply.code(401).send({ error: "Wrong user ID or password" });
    }

    await clearFailures(key);
    await issueSession(reply, { sub: row.id, role: "shop_manager", branchId: null, name: row.name });
    await audit("shop_login", { actorId: row.id, actorRole: "shop_manager", ip: req.ip });
    return { name: row.name, role: "shop_manager" };
  });

  /* -------- online shop: change your own password --------
     The owner creates the account with a first password; after that it is
     the manager's own, and the owner has no way to read or reuse it. Asking
     for the current one means a walked-away session cannot silently take the
     account over. */
  app.post("/auth/shop/change-password", async (req, reply) => {
    const s = await requireAuth(req, reply);
    if (!s) return;
    if (s.role !== "shop_manager") return reply.code(403).send({ error: "Not allowed" });
    const parsed = z.object({
      current: z.string().min(1),
      password: z.string().min(8, "At least 8 characters").max(200),
    }).safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid input" });

    const row = await db.prepare("SELECT password_hash FROM users WHERE id = ?")
      .get(s.sub) as { password_hash: string | null } | undefined;
    const ok = row?.password_hash ? await verifyPassword(parsed.data.current, row.password_hash) : false;
    if (!ok) {
      await audit("shop_password_change_failed", { actorId: s.sub, actorRole: s.role, ip: req.ip });
      return reply.code(401).send({ error: "That current password is wrong" });
    }

    await db.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
      .run(await hashPassword(parsed.data.password), s.sub);
    await audit("shop_password_changed", { actorId: s.sub, actorRole: s.role, ip: req.ip });
    return { ok: true };
  });

  /* -------- forgot password (clients) --------
     Always answers the same, whether or not there is an account with that
     address. Anything else turns this form into a way of finding out who
     has an account here, and at a men's salon that is nobody's business.
     Rate limited so it cannot be used to hammer somebody's inbox either. */
  app.post("/auth/forgot", { config: { rateLimit: { max: 5, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const parsed = z.object({ email: z.string().email().max(120) }).safeParse(req.body);
    /* even a malformed address gets the bland answer — no hints */
    const bland = { ok: true, message: "If that email is on an account, a reset link is on its way." };
    if (!parsed.success) return bland;

    const email = parsed.data.email.toLowerCase();
    const user = await db.prepare(
      "SELECT id, name, email FROM users WHERE lower(email) = ? AND role = 'client' AND active = 1"
    ).get(email) as { id: string; name: string; email: string } | undefined;

    if (user) {
      const token = await issueResetToken(user.id, req.ip);
      await sendResetEmail(user.email, user.name, token);
      await audit("password_reset_requested", { actorId: user.id, actorRole: "client", ip: req.ip });
    } else {
      await audit("password_reset_requested_unknown", { ip: req.ip, detail: email });
    }
    return bland;
  });

  /* Is this link still good? Lets the reset page say "expired" before the
     person types a new password, rather than after. */
  app.get("/auth/reset/check", async (req) => {
    const q = req.query as { token?: string };
    const check = await checkResetToken(q.token ?? "");
    return check.ok ? { ok: true } : { ok: false, error: check.reason };
  });

  app.post("/auth/reset", { config: { rateLimit: { max: 10, timeWindow: "10 minutes" } } }, async (req, reply) => {
    const parsed = z.object({
      token: z.string().min(20),
      password: z.string().min(8, "At least 8 characters").max(200),
    }).safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid input" });

    const check = await checkResetToken(parsed.data.token);
    if (!check.ok) return reply.code(400).send({ error: check.reason });

    /* Spend the token BEFORE changing anything. If two requests race, only
       one wins the UPDATE, so a link can never be used twice. */
    if (!await consumeResetToken(check.resetId))
      return reply.code(400).send({ error: "That link has already been used" });

    await db.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
      .run(await hashPassword(parsed.data.password), check.userId);
    await audit("password_reset_completed", { actorId: check.userId, actorRole: "client", ip: req.ip });
    return { ok: true };
  });

  /* -------- session -------- */
  app.get("/auth/me", async (req, reply) => {
    const s = await readSession(req);
    if (!s) return reply.code(401).send({ error: "Not signed in" });
    return { id: s.sub, name: s.name, role: s.role, branchId: s.branchId };
  });

  app.post("/auth/logout", async (req, reply) => {
    await clearSession(reply);
    return { ok: true };
  });
}
