import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  ActorType,
  canonicalJson,
  MusicianProfile,
  VenueProfile,
  verifyPayload,
} from "@booker/schema";
import { db } from "../db.js";

const RegisterBody = z.object({
  did: z.string().startsWith("did:key:"),
  actorType: ActorType,
  profile: z.unknown(),
  signature: z.string(), // base64 sig over canonicalJson({did, actorType, profile})
});

export async function identityRoutes(app: FastifyInstance): Promise<void> {
  app.post("/identities", async (req, reply) => {
    const body = RegisterBody.parse(req.body);
    const profile =
      body.actorType === "musician"
        ? MusicianProfile.parse(body.profile)
        : VenueProfile.parse(body.profile);

    const payload = Buffer.from(
      canonicalJson({
        did: body.did,
        actorType: body.actorType,
        profile: body.profile,
      }),
      "utf8",
    );
    const ok = verifyPayload(
      new Uint8Array(payload),
      new Uint8Array(Buffer.from(body.signature, "base64")),
      body.did,
    );
    if (!ok) return reply.code(400).send({ error: "bad signature" });

    const existing = await db.identity.findUnique({ where: { did: body.did } });
    if (existing) return reply.code(409).send({ error: "did already registered" });

    const identity = await db.identity.create({
      data: { did: body.did, actorType: body.actorType, profile },
    });
    return reply.code(201).send(identity);
  });

  app.get("/identities/:did", async (req) => {
    const { did } = req.params as { did: string };
    const identity = await db.identity.findUnique({ where: { did } });
    return identity ?? { error: "not found" };
  });

  app.get("/musicians", async () => {
    return db.identity.findMany({ where: { actorType: "musician" } });
  });

  app.get("/venues", async () => {
    return db.identity.findMany({ where: { actorType: "venue" } });
  });
}
