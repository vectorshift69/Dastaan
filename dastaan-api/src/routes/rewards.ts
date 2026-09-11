import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireRole, audit } from "../security.js";
import { creditBalanceFor, visitRewardSettings, setVisitRewardSettings } from "../rewards.js";

const settingsSchema = z.object({
  visitsPerReward: z.number().int().min(1).max(50),
  rewardAmount: z.number().min(0).max(10000),
});

export default async function rewardsRoutes(app: FastifyInstance) {
  /* -------- client: my visit-based store credit -------- */
  app.get("/rewards/me", async (req, reply) => {
    const s = await requireRole(req, reply, ["client"]);
    if (!s) return;
    return creditBalanceFor(s.sub);
  });

  /* -------- super admin: tune the reward interval/amount -------- */
  app.get("/rewards/settings", async (req, reply) => {
    const s = await requireRole(req, reply, ["super_admin"]);
    if (!s) return;
    return visitRewardSettings();
  });

  app.put("/rewards/settings", async (req, reply) => {
    const s = await requireRole(req, reply, ["super_admin"]);
    if (!s) return;
    const parsed = settingsSchema.safeParse(req.body);
    if (!parsed.success)
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    await setVisitRewardSettings(parsed.data.visitsPerReward, parsed.data.rewardAmount);
    await audit("reward_settings_updated", {
      actorId: s.sub, actorRole: s.role,
      detail: `every ${parsed.data.visitsPerReward} visits → AED ${parsed.data.rewardAmount}`,
      ip: req.ip,
    });
    return visitRewardSettings();
  });
}
