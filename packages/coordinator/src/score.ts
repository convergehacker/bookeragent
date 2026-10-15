import type {
  Genre,
  MusicianProfile,
  Neighborhood,
  SlotType,
  VenueProfile,
} from "@booker/schema";
import type { Reputation } from "@booker/graph";

// Coordinator v0 — deterministic, pure, reproducible.
// Same inputs must always produce the same output. No IO, no clocks.

export const COORDINATOR_VERSION = "v0.1.0";

// Miami seasonal demand priors (month index 0-11). Attestation data
// corrects these over time; they're priors, not truth.
const MIAMI_SEASONALITY: number[] = [
  1.0, // Jan — high season
  1.0, // Feb
  1.1, // Mar — Ultra
  0.95, // Apr — tail of season
  0.8, // May
  0.7, // Jun — summer trough
  0.7, // Jul
  0.7, // Aug
  0.75, // Sep
  0.85, // Oct
  0.95, // Nov
  1.15, // Dec — Art Basel
];

// Neighborhood adjacency for saturation penalty — Miami is water-cut,
// radius math is wrong. Same neighborhood = 1.0, adjacent = 0.5, else 0.
const NEIGHBORHOOD_ADJACENCY: Record<string, string[]> = {
  wynwood: ["midtown", "downtown", "upper_east_side"],
  midtown: ["wynwood", "upper_east_side"],
  upper_east_side: ["midtown", "little_haiti", "north_beach"],
  little_haiti: ["upper_east_side", "wynwood"],
  little_havana: ["downtown", "brickell", "coral_gables"],
  downtown: ["brickell", "wynwood", "little_havana"],
  brickell: ["downtown", "little_havana"],
  miami_beach: ["north_beach"],
  north_beach: ["miami_beach", "upper_east_side"],
  coconut_grove: ["coral_gables"],
  coral_gables: ["coconut_grove", "little_havana"],
  hialeah: [],
  other_miami: [],
};

export interface SlotInput {
  id: string;
  venueDid: string;
  startsAt: string;
  endsAt: string;
  slotType: SlotType;
  genresWanted: Genre[];
  payCents?: number;
  needsOwnPa: boolean;
  venue: VenueProfile;
}

export interface MusicianInput {
  did: string;
  profile: MusicianProfile;
  reputation: Reputation;
  availableFrom: string;
  availableTo: string;
  recentGigNeighborhoods: { neighborhood: Neighborhood; at: string }[];
}

export interface ScoredPair {
  slotId: string;
  musicianDid: string;
  utility: number;
  feasible: boolean;
  rejectReasons: string[];
  rationale: string[];
}

function genreFit(musicianGenres: Genre[], wanted: Genre[]): number {
  if (wanted.length === 0) return 0.7; // open call
  const overlap = musicianGenres.filter((g) => wanted.includes(g)).length;
  if (overlap === 0) return 0;
  return Math.min(1, 0.5 + 0.5 * (overlap / wanted.length));
}

function neighborhoodProximity(a: Neighborhood, b: Neighborhood): number {
  if (a === b) return 1;
  return (NEIGHBORHOOD_ADJACENCY[a] ?? []).includes(b) ? 0.5 : 0;
}

function saturationPenalty(musician: MusicianInput, slot: SlotInput): number {
  // Penalize recent gigs in same/adjacent catchment — burn your own draw.
  const slotStart = new Date(slot.startsAt).getTime();
  let penalty = 0;
  for (const gig of musician.recentGigNeighborhoods) {
    const daysSince = Math.abs(
      (slotStart - new Date(gig.at).getTime()) / 86_400_000,
    );
    if (daysSince > 14) continue;
    const prox = neighborhoodProximity(
      gig.neighborhood,
      slot.venue.neighborhood,
    );
    penalty += prox * (1 - daysSince / 14) * 0.3;
  }
  return Math.min(0.6, penalty);
}

// Hard constraints — any failure makes the pair infeasible.
function checkConstraints(
  slot: SlotInput,
  musician: MusicianInput,
): string[] {
  const reasons: string[] = [];
  const s = new Date(slot.startsAt).getTime();
  const e = new Date(slot.endsAt).getTime();
  if (
    s < new Date(musician.availableFrom).getTime() ||
    e > new Date(musician.availableTo).getTime()
  ) {
    reasons.push("outside availability window");
  }
  if (slot.needsOwnPa && musician.profile.needsPa) {
    reasons.push("PA mismatch: slot requires own PA, musician needs house PA");
  }
  if (
    slot.payCents !== undefined &&
    musician.profile.rateMinCents !== undefined &&
    slot.payCents < musician.profile.rateMinCents
  ) {
    reasons.push("below rate floor");
  }
  return reasons;
}

export function scorePair(slot: SlotInput, musician: MusicianInput): ScoredPair {
  const rejectReasons = checkConstraints(slot, musician);
  const feasible = rejectReasons.length === 0;

  const fit = genreFit(musician.profile.genres, slot.genresWanted);
  const reliability = musician.reputation.reliability;
  const repScore = musician.reputation.score;
  const saturation = saturationPenalty(musician, slot);
  const month = new Date(slot.startsAt).getMonth();
  const seasonal = MIAMI_SEASONALITY[month];

  // Exploration bonus: under-connected musicians get a shot, scaled by
  // how much edge data exists (they need SOME signal to route).
  const exploration =
    musician.reputation.edgeCount < 5 ? 0.1 * (1 - musician.reputation.edgeCount / 5) : 0;

  const utility = feasible
    ? fit * 0.35 +
      reliability * 0.3 +
      repScore * 0.2 +
      exploration +
      seasonal * 0.05 -
      saturation
    : 0;

  const rationale: string[] = [];
  rationale.push(`genre fit ${fit.toFixed(2)} (${musician.profile.genres.join("/")} vs ${slot.genresWanted.join("/") || "open"})`);
  rationale.push(`reliability ${reliability.toFixed(2)} over ${musician.reputation.edgeCount} edges`);
  rationale.push(`reputation ${repScore.toFixed(2)}, rebook ${musician.reputation.rebookRate.toFixed(2)}`);
  if (exploration > 0) rationale.push(`exploration bonus +${exploration.toFixed(2)}`);
  if (saturation > 0) rationale.push(`saturation penalty -${saturation.toFixed(2)}`);
  rationale.push(`seasonal ×${seasonal.toFixed(2)}`);

  return {
    slotId: slot.id,
    musicianDid: musician.did,
    utility: Math.round(utility * 10000) / 10000,
    feasible,
    rejectReasons,
    rationale,
  };
}
