import type { FastifyInstance } from "fastify";
import { z } from "zod";
import QRCode from "qrcode";
import { readFileSync, existsSync } from "node:fs";
import { requireAuth, requireRole, audit } from "../security.js";
import { ensureAccount, findByToken, recentTransactions } from "../loyalty.js";

const QR_PREFIX = "DSTN:"; // QR payload = DSTN:<token>

const scanSchema = z.object({ token: z.string().min(8).max(80) });

export default async function loyaltyRoutes(app: FastifyInstance) {
  /* -------- client: my loyalty card -------- */
  app.get("/loyalty/me", async (req, reply) => {
    const s = requireRole(req, reply, ["client"]);
    if (!s) return;
    const acc = ensureAccount(s.sub);
    return {
      tier: acc.tier,
      points: acc.points,
      lifetimePoints: acc.lifetimePoints,
      qrPayload: QR_PREFIX + acc.qrToken,
      nextTier:
        acc.tier === "Gold" ? null
        : acc.tier === "Silver" ? { name: "Gold", at: 5000 }
        : { name: "Silver", at: 2000 },
    };
  });

  /* QR as SVG — crisp on any screen, and dense enough for webcam scanning */
  app.get("/loyalty/me/qr.svg", async (req, reply) => {
    const s = requireRole(req, reply, ["client"]);
    if (!s) return;
    const acc = ensureAccount(s.sub);
    const svg = await QRCode.toString(QR_PREFIX + acc.qrToken, {
      type: "svg",
      errorCorrectionLevel: "M", // tolerant of screen glare for webcam scans
      margin: 2,
      color: { dark: "#141414", light: "#f7f5f0" },
    });
    reply.header("content-type", "image/svg+xml").header("cache-control", "private, max-age=300").send(svg);
  });

  /* -------- POS: staff scans a client's phone screen -------- */
  app.post("/loyalty/scan", async (req, reply) => {
    const s = requireRole(req, reply, ["admin", "super_admin"]);
    if (!s) return;
    const parsed = scanSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "Invalid scan" });
    const token = parsed.data.token.replace(QR_PREFIX, "").trim();
    const acc = findByToken(token);
    if (!acc) return reply.code(404).send({ error: "Card not recognised" });
    audit("loyalty_scanned", { actorId: s.sub, actorRole: s.role, detail: acc.clientId, ip: req.ip });
    return {
      clientName: acc.clientName,
      clientPhone: acc.clientPhone,
      tier: acc.tier,
      points: acc.points,
      lifetimePoints: acc.lifetimePoints,
      recent: recentTransactions(acc.id, 5),
    };
  });

  /* -------- Apple Wallet pass (activates when certificates are configured) -------- */
  app.get("/loyalty/me/wallet.pkpass", async (req, reply) => {
    const s = requireRole(req, reply, ["client"]);
    if (!s) return;

    const certPath = process.env.APPLE_PASS_CERT;      // signerCert.pem
    const keyPath = process.env.APPLE_PASS_KEY;        // signerKey.pem
    const wwdrPath = process.env.APPLE_WWDR_CERT;      // Apple WWDR CA
    const passTypeId = process.env.APPLE_PASS_TYPE_ID; // pass.com.dastaan.loyalty
    const teamId = process.env.APPLE_TEAM_ID;

    if (!certPath || !keyPath || !wwdrPath || !passTypeId || !teamId ||
        !existsSync(certPath) || !existsSync(keyPath) || !existsSync(wwdrPath)) {
      return reply.code(503).send({
        error: "Apple Wallet passes need Apple Developer certificates. Set APPLE_PASS_CERT, APPLE_PASS_KEY, APPLE_WWDR_CERT, APPLE_PASS_TYPE_ID, APPLE_TEAM_ID — see README.",
      });
    }

    const acc = ensureAccount(s.sub);
    const { PKPass } = await import("passkit-generator");
    const pass = new PKPass(
      {},
      {
        signerCert: readFileSync(certPath),
        signerKey: readFileSync(keyPath),
        wwdr: readFileSync(wwdrPath),
      },
      {
        formatVersion: 1,
        passTypeIdentifier: passTypeId,
        teamIdentifier: teamId,
        serialNumber: acc.id,
        organizationName: "Dastaan",
        description: "Dastaan Loyalty Card",
        foregroundColor: "rgb(242,237,225)",
        backgroundColor: "rgb(12,12,12)",
        labelColor: "rgb(201,162,39)",
        logoText: "DASTAAN",
      }
    );
    pass.type = "storeCard";
    pass.primaryFields.push({ key: "points", label: "POINTS", value: acc.points });
    pass.secondaryFields.push({ key: "tier", label: "TIER", value: acc.tier });
    pass.setBarcodes({
      message: QR_PREFIX + acc.qrToken,
      format: "PKBarcodeFormatQR",
      messageEncoding: "iso-8859-1",
    });

    reply
      .header("content-type", "application/vnd.apple.pkpass")
      .header("content-disposition", 'attachment; filename="dastaan-loyalty.pkpass"')
      .send(pass.getAsBuffer());
  });
}
