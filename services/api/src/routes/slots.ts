import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Genre, PayModel, SlotType } from "@booker/schema";
import { db } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth.js";

const SlotBody = z.object({
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  slotType: SlotType,
  genresWanted: z.array(Genre).default([]),
  payCents: z.number().int().min(0).optional(),
  payModel: PayModel,
  needsOwnPa: z.boolean().default(false),
});

const AvailabilityBody = z.object({
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
});

export async function slotRoutes(app: FastifyInstance): Promise<void> {
  app.get("/slots", async (req) => {
    const { status } = req.query as { status?: string };
    return db.slot.findMany({
      where: { status: status ?? "open" },
      orderBy: { startsAt: "asc" },
    });
  });

  app.post("/slots", { preHandler: requireAuth }, async (req, reply) => {
    const { did } = req as AuthedRequest;
    const identity = await db.identity.findUnique({ where: { did } });
    if (identity?.actorType !== "venue") {
      return reply.code(403).send({ error: "venues only" });
    }
    const body = SlotBody.parse(req.body);
    const slot = await db.slot.create({ data: { ...body, venueDid: did } });
    return reply.code(201).send(slot);
  });

  app.delete("/slots/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { did } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    const slot = await db.slot.findUnique({ where: { id } });
    if (!slot || slot.venueDid !== did) {
      return reply.code(404).send({ error: "not found" });
    }
    return db.slot.update({ where: { id }, data: { status: "cancelled" } });
  });

  app.post("/availability", { preHandler: requireAuth }, async (req, reply) => {
    const { did } = req as AuthedRequest;
    const identity = await db.identity.findUnique({ where: { did } });
    if (identity?.actorType !== "musician") {
      return reply.code(403).send({ error: "musicians only" });
    }
    const body = AvailabilityBody.parse(req.body);
    const avail = await db.availability.create({
      data: { ...body, musicianDid: did },
    });
    return reply.code(201).send(avail);
  });

  app.get("/availability", { preHandler: requireAuth }, async (req) => {
    const { did } = req as AuthedRequest;
    return db.availability.findMany({ where: { musicianDid: did } });
  });
}
