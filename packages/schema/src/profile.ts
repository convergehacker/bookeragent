import { z } from "zod";
import {
  Genre,
  LanguagePref,
  Neighborhood,
  PayModel,
  SlotType,
  VenueType,
} from "./enums.js";

export const MusicianProfile = z.object({
  displayName: z.string().min(1).max(120),
  bio: z.string().max(2000).optional(),
  genres: z.array(Genre).min(1),
  setLengthMin: z.number().int().min(15).max(480),
  drawEstimate: z.number().int().min(0).optional(),
  rateMinCents: z.number().int().min(0).optional(),
  needsPa: z.boolean().default(false),
  languagePref: LanguagePref.default("either"),
  homeNeighborhoods: z.array(Neighborhood).default([]),
});
export type MusicianProfile = z.infer<typeof MusicianProfile>;

export const VenueProfile = z.object({
  displayName: z.string().min(1).max(120),
  venueType: VenueType,
  neighborhood: Neighborhood,
  capacity: z.number().int().min(1).optional(),
  genresWanted: z.array(Genre).default([]),
  payModel: PayModel,
  payTypicalCents: z.number().int().min(0).optional(),
  hasPa: z.boolean().default(false),
  languagePref: LanguagePref.default("either"),
});
export type VenueProfile = z.infer<typeof VenueProfile>;

export const Slot = z.object({
  venueDid: z.string().startsWith("did:key:"),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  slotType: SlotType,
  genresWanted: z.array(Genre).default([]),
  payCents: z.number().int().min(0).optional(),
  payModel: PayModel,
  needsOwnPa: z.boolean().default(false),
  status: z.enum(["open", "filled", "cancelled"]).default("open"),
});
export type Slot = z.infer<typeof Slot>;
