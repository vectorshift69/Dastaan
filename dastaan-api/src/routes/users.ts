/* ------------------------------------------------------------------ */
/* User administration — the console's Team tab.                       */
/*                                                                     */
/* Three kinds of account, three ways in, and three different ways of  */
/* handing over a credential. They are not the same problem:           */
/*                                                                     */
/*   staff (reception, barbers)                                        */
/*     4-digit keypad code. The owner types the new one and tells them */
/*     — they are standing in the same room, and a barber has no email */
/*     account here. Codes are stored as an HMAC, never in the clear,  */
/*     so nobody can read an existing code back, only replace it.      */
/*                                                                     */
/*   shop manager                                                      */
/*     id and password, created once by the owner. After that it is    */
/*     theirs: they change it themselves at /shop and the owner cannot */
/*     see it. The owner can still deactivate the account outright.    */
/*                                                                     */
/*   clients                                                           */
/*     never handled by hand. The owner can send a reset email; the    */
/*     link goes to the client and only they see it. Reception cannot  */
/*     set a client's password, because that would mean a member of    */
/*     staff could read a customer's account.                          */
/*                                                                     */
/* Deactivating never deletes. Invoices, bookings and stock movements  */
/* all point at these rows and history has to stay readable.           */
/* ------------------------------------------------------------------ */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db, uid, now } from "../db.js";
import { requireRole, hmacCode, hashPassword, audit } from "../security.js";
import { issueResetToken, sendResetEmail } from "../password-reset.js";

const codeRule = z.string().regex(/^\d{4}$/, "The code must be 4 digits");

const staffSchema = z.object({
  name: z.string().min(2, "Name is too short").max(80),
  role: z.enum(["admin", "barber"]),
  branchId: z.string().min(1, "Pick a branch"),
  title: z.string().max(60).optional(),
  code: codeRule,
});

const shopSchema = z.object({
  name: z.string().min(2, "Name is too short").max(80),
  userId: z.string().min(3, "At least 3 characters").max(32)
    .regex(/^[a-zA-Z0-9_.-]+$/, "Letters, numbers, and _ . - only"),
  password: z.string().min(8, "At least 8 characters").max(200),
});

export default async function userRoutes(app: FastifyInstance) {
  /* ---------------- everyone with a way in ---------------- */

  /* One list, so the owner can see at a glance who can open what. Codes and
     password hashes are never selected — there is nothing here to leak. */
  app.get("/users", async (req, reply) => {
    const s = await requireRole(req, reply, ["super_admin"]);
    if (!s) return;
    return await db.prepare(
      `SELECT u.id, u.role, u.name, u.title, u.user_id AS "userId", u.email,
              u.branch_id AS "branchId", b.area AS "branchArea", u.active,
              u.created_at AS "createdAt",
              (u.code_hmac IS NOT NULL) AS "hasCode",
              (u.password_hash IS NOT NULL) AS "hasPassword"
       FROM users u LEFT JOIN branches b ON b.id = u.branch_id
       WHERE u.role != 'client'
       ORDER BY CASE u.role WHEN 'super_admin' THEN 0 WHEN 'admin' THEN 1
                            WHEN 'shop_manager' THEN 2 ELSE 3 END, u.name`
    ).all();
  });

  /* ---------------- staff ---------------- */

  /* Reception can add barbers to their own branch; the owner can add anyone
     anywhere. Same rule as the old /staff endpoint, kept deliberately. */
  app.post("/users/staff", async (req, reply) => {
    const s = await requireRole(req, reply, ["admin", "super_admin"]);
    if (!s) return;
    const parsed = staffSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    const body = parsed.data;

    if (s.role === "admin" && (body.role !== "barber" || body.branchId !== s.branchId))
      return reply.code(403).send({ error: "You can only add barbers to your own branch" });

    if (!await db.prepare("SELECT id FROM branches WHERE id = ?").get(body.branchId))
      return reply.code(400).send({ error: "Unknown branch" });

    /* Codes have to be unique across the whole company — the keypad has no
       "who are you" step, the code IS the identity. */
    const h = hmacCode(body.code);
    if (await db.prepare("SELECT id FROM users WHERE code_hmac = ?").get(h))
      return reply.code(409).send({ error: "That code is already in use — pick another" });

    const id = uid();
    await db.prepare(
      "INSERT INTO users (id, role, name, title, branch_id, code_hmac, created_at) VALUES (?,?,?,?,?,?,?)"
    ).run(id, body.role, body.name, body.title ?? null, body.branchId, h, now());
    await audit("staff_created", { actorId: s.sub, actorRole: s.role, detail: `${body.role}:${body.name}`, ip: req.ip });
    return reply.code(201).send({ id, name: body.name, role: body.role });
  });

  /* The owner types the replacement code and passes it on in person. */
  app.post("/users/:id/code", async (req, reply) => {
    const s = await requireRole(req, reply, ["super_admin"]);
    if (!s) return;
    const { id } = req.params as { id: string };
    const parsed = z.object({ code: codeRule }).safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid input" });

    const target = await db.prepare(
      "SELECT id, name, role FROM users WHERE id = ?"
    ).get(id) as { id: string; name: string; role: string } | undefined;
    if (!target) return reply.code(404).send({ error: "No such person" });
    if (target.role === "client" || target.role === "shop_manager")
      return reply.code(400).send({ error: "That account signs in with a password, not a code" });

    const h = hmacCode(parsed.data.code);
    if (await db.prepare("SELECT id FROM users WHERE code_hmac = ? AND id != ?").get(h, id))
      return reply.code(409).send({ error: "That code is already in use — pick another" });

    await db.prepare("UPDATE users SET code_hmac = ? WHERE id = ?").run(h, id);
    await audit("staff_code_reset", { actorId: s.sub, actorRole: s.role, detail: `${target.role}:${target.name}`, ip: req.ip });
    return { ok: true, name: target.name };
  });

  /* ---------------- the online shop ---------------- */

  /* Created once, with a first password the owner types and hands over. From
     then on the manager owns it — see /auth/shop/change-password. */
  app.post("/users/shop-manager", async (req, reply) => {
    const s = await requireRole(req, reply, ["super_admin"]);
    if (!s) return;
    const parsed = shopSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    const { name, userId, password } = parsed.data;

    /* user_id is unique across clients and managers alike, so a sign-in can
       never be ambiguous about which door it belongs to. */
    if (await db.prepare("SELECT id FROM users WHERE lower(user_id) = ?").get(userId.toLowerCase()))
      return reply.code(409).send({ error: "That user ID is taken" });

    const id = uid();
    await db.prepare(
      "INSERT INTO users (id, role, user_id, name, title, password_hash, created_at) VALUES (?,?,?,?,?,?,?)"
    ).run(id, "shop_manager", userId.toLowerCase(), name, "Online shop manager",
      await hashPassword(password), now());
    await audit("shop_manager_created", { actorId: s.sub, actorRole: s.role, detail: userId, ip: req.ip });
    return reply.code(201).send({ id, name, userId: userId.toLowerCase() });
  });

  /* If a manager is locked out and cannot reset their own password, the owner
     sets a new first password — the same act as creating the account. There is
     no way to read the old one; it was only ever stored as a hash. */
  app.post("/users/:id/shop-password", async (req, reply) => {
    const s = await requireRole(req, reply, ["super_admin"]);
    if (!s) return;
    const { id } = req.params as { id: string };
    const parsed = z.object({ password: z.string().min(8, "At least 8 characters").max(200) })
      .safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid input" });

    const target = await db.prepare(
      "SELECT id, name, role FROM users WHERE id = ?"
    ).get(id) as { id: string; name: string; role: string } | undefined;
    if (!target || target.role !== "shop_manager")
      return reply.code(404).send({ error: "No such shop manager" });

    await db.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
      .run(await hashPassword(parsed.data.password), id);
    await audit("shop_password_reset_by_owner", { actorId: s.sub, actorRole: s.role, detail: target.name, ip: req.ip });
    return { ok: true, name: target.name };
  });

  /* ---------------- clients ---------------- */

  /* Registered clients only — the ones with an account and therefore a
     password to reset. Walk-ins have no login and nothing to send.
     Deliberately narrow: name, whether there is an email, and nothing else.
     The Clients screen is where you go to read about a client. */
  app.get("/users/clients", async (req, reply) => {
    const s = await requireRole(req, reply, ["super_admin"]);
    if (!s) return;
    const q = ((req.query as { q?: string }).q ?? "").trim().toLowerCase();
    if (q.length < 2) return [];
    return await db.prepare(
      `SELECT id, name, email, user_id AS "userId", active
       FROM users
       WHERE role = 'client'
         AND (lower(name) LIKE ? OR lower(COALESCE(email,'')) LIKE ?
              OR lower(COALESCE(user_id,'')) LIKE ? OR COALESCE(phone,'') LIKE ?)
       ORDER BY name LIMIT 8`
    ).all(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  });

  /* The owner can start a reset, but the link goes to the client's own inbox
     — staff never see it and never set the password themselves. */
  app.post("/users/clients/:id/send-reset", async (req, reply) => {
    const s = await requireRole(req, reply, ["super_admin"]);
    if (!s) return;
    const { id } = req.params as { id: string };
    const c = await db.prepare(
      "SELECT id, name, email FROM users WHERE id = ? AND role = 'client' AND active = 1"
    ).get(id) as { id: string; name: string; email: string | null } | undefined;
    if (!c) return reply.code(404).send({ error: "No such client" });
    if (!c.email)
      return reply.code(400).send({ error: `${c.name} has no email on file — ask them to add one, or they can register again` });

    const token = await issueResetToken(c.id, req.ip);
    await sendResetEmail(c.email, c.name, token);
    await audit("client_reset_sent_by_owner", { actorId: s.sub, actorRole: s.role, detail: c.id, ip: req.ip });
    /* the address is echoed back so the owner can tell the client which inbox
       to look in — it is already on the Clients screen, nothing new is exposed */
    return { ok: true, sentTo: c.email };
  });

  /* ---------------- switching people off ---------------- */

  /* Never a delete: invoices, bookings and stock movements all reference
     these rows, and the history has to stay readable. */
  app.patch("/users/:id/active", async (req, reply) => {
    const s = await requireRole(req, reply, ["super_admin"]);
    if (!s) return;
    const { id } = req.params as { id: string };
    const parsed = z.object({ active: z.boolean() }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid input" });

    if (id === s.sub)
      return reply.code(400).send({ error: "You cannot switch off your own account" });

    const target = await db.prepare("SELECT id, name, role FROM users WHERE id = ?")
      .get(id) as { id: string; name: string; role: string } | undefined;
    if (!target) return reply.code(404).send({ error: "No such person" });

    /* Locking out the last owner would lock everyone out of the console for
       good, with no way back in short of the database. */
    if (target.role === "super_admin" && !parsed.data.active) {
      const others = await db.prepare(
        "SELECT COUNT(*) AS n FROM users WHERE role = 'super_admin' AND active = 1 AND id != ?"
      ).get(id) as { n: number };
      if (Number(others.n) === 0)
        return reply.code(409).send({ error: "That is the only owner account — there would be no way back in" });
    }

    await db.prepare("UPDATE users SET active = ? WHERE id = ?").run(parsed.data.active ? 1 : 0, id);
    await audit(parsed.data.active ? "user_reactivated" : "user_deactivated", {
      actorId: s.sub, actorRole: s.role, detail: `${target.role}:${target.name}`, ip: req.ip,
    });
    return { ok: true };
  });
}
