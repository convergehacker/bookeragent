import { createHash } from "node:crypto";
import { COORDINATOR_VERSION, scorePair } from "./score.js";
import type { MusicianInput, ScoredPair, SlotInput } from "./score.js";

// Assignment: one musician per slot, one slot per musician per epoch.
// Greedy-by-utility over feasible pairs — adequate at launch scale; the
// interface supports swapping in a Hungarian/LP solver later without
// changing consumers.

export interface AssignmentProposal {
  slotId: string;
  musicianDid: string;
  utility: number;
  rationale: string[];
  exploration: boolean;
}

export interface AssignmentResult {
  coordinatorVersion: string;
  inputHash: string;
  proposals: AssignmentProposal[];
  unfilledSlots: string[];
}

function hashInputs(slots: SlotInput[], musicians: MusicianInput[]): string {
  const canonical = JSON.stringify(
    {
      slots: slots.map((s) => s.id).sort(),
      musicians: musicians.map((m) => m.did).sort(),
    },
    Object.keys({ slots: [], musicians: [] }).sort(),
  );
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

const EXPLORATION_FRACTION = 0.2; // reserve ~1 in 5 fills for rising acts

export function assign(
  slots: SlotInput[],
  musicians: MusicianInput[],
  explorationFraction = EXPLORATION_FRACTION,
): AssignmentResult {
  const pairs: ScoredPair[] = [];
  for (const slot of slots) {
    for (const musician of musicians) {
      pairs.push(scorePair(slot, musician));
    }
  }

  const feasible = pairs
    .filter((p) => p.feasible && p.utility > 0)
    .sort((a, b) => b.utility - a.utility);

  const filledSlots = new Set<string>();
  const bookedMusicians = new Set<string>();
  const proposals: AssignmentProposal[] = [];

  const targetExplorations = Math.floor(slots.length * explorationFraction);
  let explorations = 0;

  // Pass 1: reserve exploration quota — under-connected musicians first.
  if (targetExplorations > 0) {
    for (const pair of feasible) {
      if (explorations >= targetExplorations) break;
      const musician = musicians.find((m) => m.did === pair.musicianDid)!;
      if (musician.reputation.edgeCount >= 5) continue; // not an exploration pick
      if (filledSlots.has(pair.slotId) || bookedMusicians.has(pair.musicianDid))
        continue;
      filledSlots.add(pair.slotId);
      bookedMusicians.add(pair.musicianDid);
      proposals.push({
        slotId: pair.slotId,
        musicianDid: pair.musicianDid,
        utility: pair.utility,
        rationale: pair.rationale,
        exploration: true,
      });
      explorations++;
    }
  }

  // Pass 2: fill remaining slots by utility.
  for (const pair of feasible) {
    if (filledSlots.has(pair.slotId) || bookedMusicians.has(pair.musicianDid))
      continue;
    filledSlots.add(pair.slotId);
    bookedMusicians.add(pair.musicianDid);
    proposals.push({
      slotId: pair.slotId,
      musicianDid: pair.musicianDid,
      utility: pair.utility,
      rationale: pair.rationale,
      exploration: false,
    });
  }

  const unfilledSlots = slots
    .map((s) => s.id)
    .filter((id) => !filledSlots.has(id));

  return {
    coordinatorVersion: COORDINATOR_VERSION,
    inputHash: hashInputs(slots, musicians),
    proposals,
    unfilledSlots,
  };
}
