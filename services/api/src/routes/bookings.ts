import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  canonicalJson,
  GigClaims,
  verifyPayload,
} from "@booker/schema";
import { db } from "../db.js";
import { requireAuth, type AuthedRequest } from "../auth.js";

const REVEAL_WINDOW_MS = 72 * 60 * 60 * 1000; // 72h post-gig

async function revealIfComplete(bookingId: string): Promise<void> {
  const atts = await db.attestation.findMany({ where: { bookingId } });
  if (atts.length < 2) return;
  await db.attestation.updateMany({
    where: { bookingId },
    data: { state: "revealed" },
  });
  const parsed = atts.map((a) => GigClaims.parse(a.claims));
  const agree =
    parsed[0].objective.showed_up === parsed[1].objective.showed_up &&
    parsed[0].objective.paid === parsed[1].objective.paid;
  await db.booking.update({
    where: { id: bookingId },
    data: { state: agree ? "attested" : "disputed" },
  });
}

async function expireStale(bookingId: string): Promise<void> {
  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: { attestations: true, slot: true },
  });
  if (!booking) return;
  const deadline = booking.slot.endsAt.getTime() + REVEAL_WINDOW_MS;
  if (Date.now() <= deadline) return;
  const sealed = booking.attestations.filter((a) => a.state === "sealed");
  if (sealed.length === 0) return;
  // Window closed: reveal whatever exists; a lone attestation carries
  // low confidence, no penalty for the non-submitter.
  await db.attestation.updateMany({
    where: { bookingId, state: "sealed" },
    data: { state: "revealed" },
  });
  await db.booking.update({
    where: { id: bookingId },
    data: { state: "attested" },
  });
}

const AttestBody = z.object({
  claims: GigClaims,
  signature: z.string(),
});

export async function bookingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/bookings", { preHandler: requireAuth }, async (req) => {
    const { did } = req as AuthedRequest;
    return db.booking.findMany({
      where: { OR: [{ venueDid: did }, { musicianDid: did }] },
      include: { attestations: true, slot: true },
      orderBy: { createdAt: "desc" },
    });
  });

  for (const action of ["accept", "decline", "cancel"] as const) {
    app.post(
      `/bookings/:id/${action}`,
      { preHandler: requireAuth },
      async (req, reply) => {
        const { did } = req as AuthedRequest;
        const { id } = req.params as { id: string };
        const booking = await db.booking.findUnique({
          where: { id },
          include: { slot: true },
        });
        if (!booking || (booking.venueDid !== did && booking.musicianDid !== did)) {
          return reply.code(404).send({ error: "not found" });
        }
        if (booking.state !== "proposed" && action !== "cancel") {
          return reply.code(409).send({ error: `cannot ${action} from ${booking.state}` });
        }
        const state =
          action === "accept"
            ? booking.slot.startsAt < new Date()
              ? "performed"
              : "accepted"
            : action === "decline"
              ? "declined"
              : "cancelled";
        const updated = await db.booking.update({
          where: { id },
          data: { state },
        });
        if (action === "accept") {
          await db.slot.update({
            where: { id: booking.slotId },
            data: { status: "filled" },
          });
        }
        return updated;
      },
    );
  }

  // Commit-reveal attestation: sealed until both submit or window expires.
  app.post("/bookings/:id/attest", { preHandler: requireAuth }, async (req, reply) => {
    const { did } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    const body = AttestBody.parse(req.body);

    const booking = await db.booking.findUnique({
      where: { id },
      include: { attestations: true, slot: true },
    });
    if (!booking || (booking.venueDid !== did && booking.musicianDid !== did)) {
      return reply.code(404).send({ error: "not found" });
    }
    if (!["accepted", "performed", "attested"].includes(booking.state)) {
      return reply.code(409).send({ error: `cannot attest from ${booking.state}` });
    }
    if (booking.attestations.some((a) => a.issuerDid === did)) {
      return reply.code(409).send({ error: "already attested" });
    }

    // Subject is the counterparty: venue attests about musician and vice versa.
    const subjectDid = did === booking.venueDid ? booking.musicianDid : booking.venueDid;
    const payload = Buffer.from(
      canonicalJson({ bookingId: id, issuerDid: did, subjectDid, claims: body.claims }),
      "utf8",
    );
    const ok = verifyPayload(
      new Uint8Array(payload),
      new Uint8Array(Buffer.from(body.signature, "base64")),
      did,
    );
    if (!ok) return reply.code(400).send({ error: "bad signature" });

    const attestation = await db.attestation.create({
      data: {
        type: "GigCompleted",
        issuerDid: did,
        subjectDid,
        bookingId: id,
        claims: body.claims,
        signature: body.signature,
        state: "sealed",
        revealAfter: new Date(booking.slot.endsAt.getTime() + REVEAL_WINDOW_MS),
      },
    });

    await revealIfComplete(id);
    return reply.code(201).send(attestation);
  });

  // Mark a performed gig (after slot end, either party).
  app.post("/bookings/:id/performed", { preHandler: requireAuth }, async (req, reply) => {
    const { did } = req as AuthedRequest;
    const { id } = req.params as { id: string };
    const booking = await db.booking.findUnique({ where: { id }, include: { slot: true } });
    if (!booking || (booking.venueDid !== did && booking.musicianDid !== did)) {
      return reply.code(404).send({ error: "not found" });
    }
    if (booking.state !== "accepted" || booking.slot.endsAt > new Date()) {
      return reply.code(409).send({ error: "not markable" });
    }
    return db.booking.update({ where: { id }, data: { state: "performed" } });
  });

  // Lazy expiry sweep on read — keeps state machine honest without a cron.
  app.post("/bookings/:id/sweep", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await expireStale(id);
    const booking = await db.booking.findUnique({ where: { id } });
    if (!booking) return reply.code(404).send({ error: "not found" });
    return booking;
  });
}
