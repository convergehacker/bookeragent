import type { FastifyInstance } from "fastify";
import { computeReputation } from "@booker/graph";
import { db } from "../db.js";
import { toAttestation } from "./coordinate.js";

export async function reputationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/reputation/:did", async (req, reply) => {
    const { did } = req.params as { did: string };
    const atts = await db.attestation.findMany({
      where: { state: "revealed" },
    });
    const typed = atts.map(toAttestation);

    // Two-pass: issuer reps with neutral prior, then subject.
    const subjects = new Set(typed.map((a) => a.subject));
    const neutral = new Map<string, number>();
    const issuerReps = new Map<string, number>();
    for (const s of subjects) {
      issuerReps.set(s, computeReputation(s, typed, neutral).score);
    }
    const rep = computeReputation(did, typed, issuerReps);
    if (rep.edgeCount === 0) {
      const exists = await db.identity.findUnique({ where: { did } });
      if (!exists) return reply.code(404).send({ error: "not found" });
    }
    return rep;
  });
}
