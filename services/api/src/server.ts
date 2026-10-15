import Fastify from "fastify";
import { z } from "zod";
import { db } from "./db.js";
import { issueChallenge, verifyChallenge } from "./auth.js";
import { identityRoutes } from "./routes/identities.js";
import { slotRoutes } from "./routes/slots.js";
import { bookingRoutes } from "./routes/bookings.js";
import { coordinateRoutes } from "./routes/coordinate.js";
import { reputationRoutes } from "./routes/reputation.js";

const app = Fastify({ logger: true });

app.get("/health", async () => ({ ok: true }));

app.post(
  "/auth/challenge",
  async (req) => {
    const { did } = z
      .object({ did: z.string().startsWith("did:key:") })
      .parse(req.body);
    return { nonce: await issueChallenge(did) };
  },
);

app.post("/auth/verify", async (req, reply) => {
  const { did, nonce, signature } = z
    .object({
      did: z.string().startsWith("did:key:"),
      nonce: z.string(),
      signature: z.string(),
    })
    .parse(req.body);
  const token = await verifyChallenge(did, nonce, signature);
  if (!token) return reply.code(401).send({ error: "verification failed" });
  return { token };
});

await app.register(identityRoutes);
await app.register(slotRoutes);
await app.register(bookingRoutes);
await app.register(coordinateRoutes);
await app.register(reputationRoutes);

const port = Number(process.env.API_PORT ?? 7100);
await app.listen({ port, host: "0.0.0.0" });

const shutdown = async () => {
  await app.close();
  await db.$disconnect();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
