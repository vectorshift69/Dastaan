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

const codeSchema = z.object({ code: z.string().regex(/^\d{4}$/, "4 digits") });

const registerSchema = z.object({
  userId: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_.-]+$/, "letters, numbers, _ . - only"),
  name: z.string().min(2).max(80),
  phone: z.string().max(24).optional(),
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
    const locked = checkLock(key);
    if (locked > 0) return reply.code(429).send(lockedReply(locked));

    const row = db
      .prepare(
        "SELECT id, role, branch_id, name FROM users WHERE code_hmac = ? AND active = 1 AND role != 'client'"
      )
      .get(hmacCode(parsed.data.code)) as
      | { id: string; role: Role; branch_id: string | null; name: string }
      | undefined;

    if (!row) {
      const lockFor = recordFailure(key);
      audit("staff_login_failed", { ip: req.ip });
      if (lockFor > 0) return reply.code(429).send(lockedReply(lockFor));
      return reply.code(401).send({ error: "Code not recognised" });
    }

    clearFailures(key);
    issueSession(reply, { sub: row.id, role: row.role, branchId: row.branch_id, name: row.name });
    audit("staff_login", { actorId: row.id, actorRole: row.role, ip: req.ip });
    return { name: row.name, role: row.role, branchId: row.branch_id };
  });

  /* -------- staff: change own code -------- */
  app.post("/auth/team/change-code", async (req, reply) => {
    const s = requireAuth(req, reply);
    if (!s) return;
    if (s.role === "client") return reply.code(403).send({ error: "Not allowed" });
    const parsed = codeSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "New code must be 4 digits" });
    const h = hmacCode(parsed.data.code);
    const clash = db.prepare("SELECT id FROM users WHERE code_hmac = ? AND id != ?").get(h, s.sub);
    if (clash) return reply.code(409).send({ error: "That code is unavailable" });
    db.prepare("UPDATE users SET code_hmac = ? WHERE id = ?").run(h, s.sub);
    audit("staff_code_changed_self", { actorId: s.sub, actorRole: s.role, ip: req.ip });
    return { ok: true };
  });

  /* -------- client register: user ID + password -------- */
  app.post("/auth/client/register", { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } }, async (req, reply) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    const { userId, name, phone, password } = parsed.data;

    const exists = db.prepare("SELECT id FROM users WHERE user_id = ?").get(userId.toLowerCase());
    if (exists) return reply.code(409).send({ error: "That user ID is taken" });

    const id = uid();
    db.prepare(
      "INSERT INTO users (id, role, user_id, name, phone, password_hash, created_at) VALUES (?,?,?,?,?,?,?)"
    ).run(id, "client", userId.toLowerCase(), name, phone ?? null, await hashPassword(password), now());

    issueSession(reply, { sub: id, role: "client", branchId: null, name });
    audit("client_registered", { actorId: id, actorRole: "client", ip: req.ip });
    return { name, role: "client" };
  });

  /* -------- client login: user ID + password -------- */
  app.post("/auth/client/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Enter your user ID and password" });
    const userId = parsed.data.userId.toLowerCase();

    const key = `client:${req.ip}:${userId}`;
    const locked = checkLock(key);
    if (locked > 0) return reply.code(429).send(lockedReply(locked));

    const row = db
      .prepare(
        "SELECT id, name, password_hash FROM users WHERE user_id = ? AND role = 'client' AND active = 1"
      )
      .get(userId) as { id: string; name: string; password_hash: string | null } | undefined;

    const ok = row?.password_hash
      ? await verifyPassword(parsed.data.password, row.password_hash)
      : (await dummyCompare(), false); // equalize timing for unknown IDs

    if (!ok || !row) {
      const lockFor = recordFailure(key);
      audit("client_login_failed", { ip: req.ip, detail: userId });
      if (lockFor > 0) return reply.code(429).send(lockedReply(lockFor));
      return reply.code(401).send({ error: "Wrong user ID or password" });
    }

    clearFailures(key);
    issueSession(reply, { sub: row.id, role: "client", branchId: null, name: row.name });
    audit("client_login", { actorId: row.id, actorRole: "client", ip: req.ip });
    return { name: row.name, role: "client" };
  });

  /* -------- session -------- */
  app.get("/auth/me", async (req, reply) => {
    const s = readSession(req);
    if (!s) return reply.code(401).send({ error: "Not signed in" });
    return { name: s.name, role: s.role, branchId: s.branchId };
  });

  app.post("/auth/logout", async (req, reply) => {
    clearSession(reply);
    return { ok: true };
  });
}
