/* ------------------------------------------------------------------ */
/* Security utilities: hashing, session tokens, guards, CSRF defence.  */
/* ------------------------------------------------------------------ */

import { createHmac, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { FastifyReply, FastifyRequest } from "fastify";
import { db, uid, now } from "./db.js";

const JWT_SECRET = process.env.JWT_SECRET;
const CODE_PEPPER = process.env.CODE_PEPPER;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET missing or too short (min 32 chars). Set it in .env");
}
if (!CODE_PEPPER || CODE_PEPPER.length < 32) {
  throw new Error("CODE_PEPPER missing or too short (min 32 chars). Set it in .env");
}

/* shop_manager runs the online shop and its warehouse. Not salon staff: no
   chair, no branch, no keypad code — an id and a password, like a client. */
export type Role = "super_admin" | "admin" | "barber" | "client" | "shop_manager";
export type Session = {
  sub: string;
  role: Role;
  branchId: string | null;
  name: string;
};

export const COOKIE_NAME = "dastaan_session";
const SESSION_HOURS = 8;

/* ---- passwords (clients): bcrypt, cost 12 ---- */
export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);
// constant-work dummy compare so unknown user IDs take as long as wrong passwords
const DUMMY_HASH = bcrypt.hashSync("dummy-password-for-timing", 12);
export const dummyCompare = () => bcrypt.compare("x", DUMMY_HASH);

/* ---- staff 4-digit codes: HMAC-SHA256 with a server-side pepper ----
   A 4-digit space is tiny, so per-code salts add nothing; the security
   comes from (a) the pepper living only in env — a DB dump alone cannot
   be brute-forced, and (b) strict online rate-limiting + lockout.      */
export const hmacCode = (code: string) =>
  createHmac("sha256", CODE_PEPPER!).update(code).digest("hex");

export const safeEqualHex = (a: string, b: string) => {
  const ba = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ba.length === bb.length && timingSafeEqual(ba, bb);
};

/* ---- session cookie (JWT, httpOnly) ---- */
export async function issueSession(reply: FastifyReply, s: Session) {
  const token = jwt.sign(s, JWT_SECRET!, {
    expiresIn: `${SESSION_HOURS}h`,
    issuer: "dastaan-api",
  });
  reply.setCookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
}

export async function clearSession(reply: FastifyReply) {
  reply.clearCookie(COOKIE_NAME, { path: "/" });
}

export async function readSession(req: FastifyRequest): Promise<Session | null> {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET!, { issuer: "dastaan-api" }) as Session;
  } catch {
    return null;
  }
}

/* ---- guards ---- */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<Session | null> {
  const s = await readSession(req);
  if (!s) {
    reply.code(401).send({ error: "Not signed in" });
    return null;
  }
  return s;
}

export async function requireRole(
  req: FastifyRequest,
  reply: FastifyReply,
  roles: Role[]
): Promise<Session | null> {
  const s = await requireAuth(req, reply);
  if (!s) return null;
  if (!roles.includes(s.role)) {
    reply.code(403).send({ error: "Not allowed" });
    return null;
  }
  return s;
}

/* ---- CSRF defence: cookies are SameSite=Lax AND mutating requests
   must come from an allow-listed Origin (or no Origin: curl/native).  */
const ALLOWED_ORIGINS = (process.env.WEB_ORIGINS || "http://localhost:3000")
  .split(",")
  .map((s) => s.trim());

export async function originGuard(req: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return true;
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients; cookie theft not possible via CSRF without a browser
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  reply.code(403).send({ error: "Cross-origin request rejected" });
  return false;
}

/* ---- audit ---- */
export async function audit(
  action: string,
  opts: { actorId?: string | null; actorRole?: string | null; detail?: string; ip?: string }
) {
  await db.prepare(
    "INSERT INTO audit_log (id, actor_id, actor_role, action, detail, ip, created_at) VALUES (?,?,?,?,?,?,?)"
  ).run(uid(), opts.actorId ?? null, opts.actorRole ?? null, action, opts.detail ?? null, opts.ip ?? null, now());
}
