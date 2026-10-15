import type { Attestation, GigClaims } from "@booker/schema";

// Reputation is computed, never stored as truth. Anyone can recompute it
// from the attestation log. Robust by construction: Wilson lower bounds,
// recency decay, pair-multiplicity damping, asymmetric negative updates.

const HALF_LIFE_DAYS = 180;
const MAX_PAIR_EDGES_EFFECTIVE = 3; // diminishing returns beyond this
const NEGATIVE_WEIGHT = 5; // a no-show hits ~5x a smooth gig
const VOUCH_WEIGHT = 0.3;
const VOUCH_TTL_DAYS = 180; // vouches expire once real edges should exist
const CONFIDENCE_AGREE = 1.0;
const CONFIDENCE_DISAGREE = 0.4;

export interface TrustEdge {
  from: string;
  to: string;
  type: string;
  weight: number;
  positive: boolean;
  issuedAt: Date;
  bookingId?: string;
}

export interface Reputation {
  did: string;
  score: number; // 0..1 composite
  reliability: number; // Wilson lower bound on show-rate
  edgeCount: number;
  rebookRate: number; // repeat edges / total counterparty edges
  disputes: number;
  computedAt: string;
}

function recencyDecay(issuedAt: Date, now: Date): number {
  const ageDays = (now.getTime() - issuedAt.getTime()) / 86_400_000;
  return Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

// Wilson score lower bound: 5/5 gigs ~= 0.57, 50/50 ~= 0.92
export function wilsonLowerBound(successes: number, total: number, z = 1.96): number {
  if (total === 0) return 0;
  const p = successes / total;
  const denom = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * total)) / total);
  return Math.max(0, (centre - margin) / denom);
}

// Group mutual GigCompleted attestations by booking and judge agreement.
interface BookingPair {
  a: Attestation;
  b: Attestation;
}

export function pairGigAttestations(attestations: Attestation[]): {
  pairs: BookingPair[];
  singles: Attestation[];
} {
  const byBooking = new Map<string, Attestation[]>();
  for (const att of attestations) {
    if (att.type !== "GigCompleted" || !att.bookingId) continue;
    const list = byBooking.get(att.bookingId) ?? [];
    list.push(att);
    byBooking.set(att.bookingId, list);
  }
  const pairs: BookingPair[] = [];
  const singles: Attestation[] = [];
  for (const list of byBooking.values()) {
    if (list.length >= 2) pairs.push({ a: list[0], b: list[1] });
    else singles.push(list[0]);
  }
  return { pairs, singles };
}

function objectiveAgree(a: GigClaims, b: GigClaims): boolean {
  const fields: (keyof GigClaims["objective"])[] = [
    "showed_up",
    "paid",
    "paid_on_time",
    "set_length_ok",
  ];
  return fields.every((f) => {
    const va = a.objective[f];
    const vb = b.objective[f];
    return va === undefined || vb === undefined || va === vb;
  });
}

// Build weighted trust edges from the attestation log for a given subject.
export function edgesForSubject(
  subjectDid: string,
  attestations: Attestation[],
  issuerReps: Map<string, number>,
  now = new Date(),
): TrustEdge[] {
  const edges: TrustEdge[] = [];
  const { pairs } = pairGigAttestations(attestations);
  const pairCount = new Map<string, number>();

  for (const pair of pairs) {
    // Edges ABOUT this subject: attestations where subject is the target
    const about = [pair.a, pair.b].filter((x) => x.subject === subjectDid);
    for (const att of about) {
      const claims = att.claims as GigClaims;
      const other = [pair.a, pair.b].find((x) => x !== att)!;
      const agree = objectiveAgree(claims, other.claims as GigClaims);
      const issuerRep = issuerReps.get(att.issuer) ?? 0.1;
      const pairKey = [att.issuer, subjectDid].sort().join("|");
      const n = (pairCount.get(pairKey) ?? 0) + 1;
      pairCount.set(pairKey, n);
      const multiplicity = 1 / Math.min(n, MAX_PAIR_EDGES_EFFECTIVE);
      const positive = claims.objective.showed_up && claims.objective.paid;
      const conf = agree ? CONFIDENCE_AGREE : CONFIDENCE_DISAGREE;
      const magnitude = positive ? 1 : NEGATIVE_WEIGHT;
      edges.push({
        from: att.issuer,
        to: subjectDid,
        type: att.type,
        weight:
          issuerRep *
          recencyDecay(new Date(att.issuedAt), now) *
          multiplicity *
          conf *
          magnitude,
        positive,
        issuedAt: new Date(att.issuedAt),
        bookingId: att.bookingId,
      });
    }
  }

  for (const att of attestations) {
    if (att.type === "Vouch" && att.subject === subjectDid) {
      const ageDays = (now.getTime() - new Date(att.issuedAt).getTime()) / 86_400_000;
      if (ageDays > VOUCH_TTL_DAYS) continue; // expired
      const issuerRep = issuerReps.get(att.issuer) ?? 0.1;
      edges.push({
        from: att.issuer,
        to: subjectDid,
        type: "Vouch",
        weight: issuerRep * VOUCH_WEIGHT * recencyDecay(new Date(att.issuedAt), now),
        positive: true,
        issuedAt: new Date(att.issuedAt),
      });
    }
  }

  return edges;
}

export function computeReputation(
  subjectDid: string,
  attestations: Attestation[],
  issuerReps: Map<string, number>,
  now = new Date(),
): Reputation {
  const edges = edgesForSubject(subjectDid, attestations, issuerReps, now);
  const gigEdges = edges.filter((e) => e.type === "GigCompleted");
  const disputes = gigEdges.filter(
    (e) => e.weight < 0.5 && !e.positive,
  ).length;

  let pos = 0;
  let neg = 0;
  for (const e of edges) {
    if (e.positive) pos += e.weight;
    else neg += e.weight;
  }

  const successes = gigEdges.filter((e) => e.positive).length;
  const reliability = wilsonLowerBound(successes, gigEdges.length);

  // Rebook rate: counterparties with >=2 gig edges / distinct counterparties
  const counterpartyEdges = new Map<string, number>();
  for (const e of gigEdges) {
    counterpartyEdges.set(e.from, (counterpartyEdges.get(e.from) ?? 0) + 1);
  }
  const distinct = counterpartyEdges.size;
  const repeat = [...counterpartyEdges.values()].filter((n) => n >= 2).length;
  const rebookRate = distinct === 0 ? 0 : repeat / distinct;

  const score =
    gigEdges.length === 0
      ? Math.min(0.5, pos * 0.1) // vouch-only ceiling
      : Math.max(
          0,
          Math.min(
            1,
            reliability * 0.6 +
              Math.min(1, pos / (pos + neg + 1)) * 0.3 +
              rebookRate * 0.1,
          ),
        );

  return {
    did: subjectDid,
    score: Math.round(score * 1000) / 1000,
    reliability: Math.round(reliability * 1000) / 1000,
    edgeCount: edges.length,
    rebookRate: Math.round(rebookRate * 1000) / 1000,
    disputes,
    computedAt: now.toISOString(),
  };
}
