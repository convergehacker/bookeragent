import type { FastifyInstance } from "fastify";
import { assign, type MusicianInput, type SlotInput } from "@booker/coordinator";
import { computeReputation } from "@booker/graph";
import type {
  Attestation,
  Genre,
  MusicianProfile,
  Neighborhood,
  SlotType,
  VenueProfile,
} from "@booker/schema";
import { db } from "../db.js";
import { requireAuth } from "../auth.js";

// DB rows use issuerDid/subjectDid; the Attestation type uses issuer/subject.
export function toAttestation(a: {
  id: string;
  type: string;
  issuerDid: string;
  subjectDid: string;
  bookingId: string | null;
  claims: unknown;
  signature: string;
  issuedAt: Date;
}): Attestation {
  return {
    id: a.id,
    type: a.type as Attestation["type"],
    issuer: a.issuerDid,
    subject: a.subjectDid,
    bookingId: a.bookingId ?? undefined,
    claims: a.claims as Record<string, unknown>,
    signature: a.signature,
    issuedAt: a.issuedAt.toISOString(),
  };
}

// Loads revealed attestations and computes reputation for every subject.
// Two-pass: issuer reps with neutral prior, then subject reps.
async function reputationMap(): Promise<Map<string, ReturnType<typeof computeReputation>>> {
  const atts = await db.attestation.findMany({ where: { state: "revealed" } });
  const typed = atts.map(toAttestation);
  const subjects = new Set(typed.map((a) => a.subject));
  const neutral = new Map<string, number>();
  const firstPass = new Map<string, ReturnType<typeof computeReputation>>();
  for (const did of subjects) {
    firstPass.set(did, computeReputation(did, typed, neutral));
  }
  const issuerReps = new Map(
    [...firstPass.entries()].map(([did, r]) => [did, r.score]),
  );
  const out = new Map<string, ReturnType<typeof computeReputation>>();
  for (const did of subjects) {
    out.set(did, computeReputation(did, typed, issuerReps));
  }
  return out;
}

function emptyRep(did: string) {
  return {
    did,
    score: 0,
    reliability: 0,
    edgeCount: 0,
    rebookRate: 0,
    disputes: 0,
    computedAt: new Date().toISOString(),
  };
}

export async function coordinateRoutes(app: FastifyInstance): Promise<void> {
  // Runs the coordinator over open slots and available musicians,
  // writes proposed bookings with full rationale for reproducibility.
  app.post("/coordinate", { preHandler: requireAuth }, async (req) => {
    const reps = await reputationMap();

    const slots = await db.slot.findMany({
      where: { status: "open" },
      include: { venue: true },
    });
    const availabilities = await db.availability.findMany();
    const musicianIds = [...new Set(availabilities.map((a) => a.musicianDid))];
    const musicians = await db.identity.findMany({
      where: { did: { in: musicianIds }, actorType: "musician" },
    });

    // Past gig locations per musician for the saturation penalty.
    const pastBookings = await db.booking.findMany({
      where: { state: { in: ["attested", "performed", "accepted"] } },
      include: { slot: { include: { venue: true } } },
    });
    const gigsByMusician = new Map<
      string,
      { neighborhood: Neighborhood; at: string }[]
    >();
    for (const b of pastBookings) {
      const venueProfile = b.slot.venue.profile as unknown as VenueProfile;
      const list = gigsByMusician.get(b.musicianDid) ?? [];
      list.push({
        neighborhood: venueProfile.neighborhood,
        at: b.slot.startsAt.toISOString(),
      });
      gigsByMusician.set(b.musicianDid, list);
    }

    const slotInputs: SlotInput[] = slots.map((s) => ({
      id: s.id,
      venueDid: s.venueDid,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      slotType: s.slotType as SlotType,
      genresWanted: s.genresWanted as Genre[],
      payCents: s.payCents ?? undefined,
      needsOwnPa: s.needsOwnPa,
      venue: s.venue.profile as unknown as VenueProfile,
    }));

    // One MusicianInput per availability window — same did, deduped at
    // assignment time by bookedMusicians.
    const musicianInputs: MusicianInput[] = availabilities.flatMap((a) => {
      const identity = musicians.find((m) => m.did === a.musicianDid);
      if (!identity) return [];
      return [
        {
          did: a.musicianDid,
          profile: identity.profile as unknown as MusicianProfile,
          reputation: reps.get(a.musicianDid) ?? emptyRep(a.musicianDid),
          availableFrom: a.startsAt.toISOString(),
          availableTo: a.endsAt.toISOString(),
          recentGigNeighborhoods: gigsByMusician.get(a.musicianDid) ?? [],
        },
      ];
    });

    const result = assign(slotInputs, musicianInputs);

    // Idempotent: never re-propose a slot+musician pair that already has
    // a live booking (declined/cancelled pairs may be re-proposed).
    const existing = await db.booking.findMany({
      where: {
        slotId: { in: slots.map((s) => s.id) },
        state: { notIn: ["declined", "cancelled", "expired"] },
      },
      select: { slotId: true, musicianDid: true },
    });
    const live = new Set(existing.map((e) => `${e.slotId}|${e.musicianDid}`));
    const fresh = result.proposals.filter(
      (p) => !live.has(`${p.slotId}|${p.musicianDid}`),
    );

    const created = await Promise.all(
      fresh.map((p) => {
        const slot = slots.find((s) => s.id === p.slotId)!;
        return db.booking.create({
          data: {
            slotId: p.slotId,
            venueDid: slot.venueDid,
            musicianDid: p.musicianDid,
            state: "proposed",
            terms: { payCents: slot.payCents, payModel: slot.payModel },
            utility: p.utility,
            rationale: p.rationale,
            coordinatorVersion: result.coordinatorVersion,
            inputHash: result.inputHash,
          },
        });
      }),
    );

    return {
      coordinatorVersion: result.coordinatorVersion,
      inputHash: result.inputHash,
      proposalsCreated: created.length,
      unfilledSlots: result.unfilledSlots,
      bookings: created,
    };
  });
}
