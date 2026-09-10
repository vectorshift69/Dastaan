import type { FastifyInstance } from "fastify";
import { requireRole } from "../security.js";
import { creditBalanceFor } from "../rewards.js";

export default async function rewardsRoutes(app: FastifyInstance) {
  /* -------- client: my visit-based store credit -------- */
  app.get("/rewards/me", async (req, reply) => {
    const s = await requireRole(req, reply, ["client"]);
    if (!s) return;
    return creditBalanceFor(s.sub);
  });
}
