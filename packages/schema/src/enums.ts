import { z } from "zod";

export const ActorType = z.enum(["musician", "venue"]);
export type ActorType = z.infer<typeof ActorType>;

export const Genre = z.enum([
  "salsa",
  "timba",
  "afro_cuban",
  "jazz",
  "latin_jazz",
  "cumbia",
  "konpa",
  "rara",
  "acoustic_folk",
  "reggae",
  "latin_fusion",
  "classical",
  "bossa",
  "funk_soul",
  "other",
]);
export type Genre = z.infer<typeof Genre>;

export const VenueType = z.enum([
  "cafe",
  "farmers_market",
  "restaurant",
  "brewery",
  "gallery",
  "hotel_lobby",
  "rooftop",
  "cultural_center",
  "private",
]);
export type VenueType = z.infer<typeof VenueType>;

export const Neighborhood = z.enum([
  "wynwood",
  "midtown",
  "upper_east_side",
  "little_havana",
  "little_haiti",
  "miami_beach",
  "coconut_grove",
  "coral_gables",
  "brickell",
  "downtown",
  "north_beach",
  "hialeah",
  "other_miami",
]);
export type Neighborhood = z.infer<typeof Neighborhood>;

export const SlotType = z.enum([
  "brunch",
  "afternoon_market",
  "happy_hour",
  "dinner",
  "late",
  "event",
]);
export type SlotType = z.infer<typeof SlotType>;

export const PayModel = z.enum(["flat", "tips", "door_split", "hybrid"]);
export type PayModel = z.infer<typeof PayModel>;

export const LanguagePref = z.enum(["en", "es", "either"]);
export type LanguagePref = z.infer<typeof LanguagePref>;

export const EdgeType = z.enum([
  "GigCompleted",
  "Vouch",
  "Referral",
  "Dispute",
]);
export type EdgeType = z.infer<typeof EdgeType>;

export const BookingState = z.enum([
  "proposed",
  "accepted",
  "declined",
  "cancelled",
  "performed",
  "attested",
  "disputed",
  "expired",
]);
export type BookingState = z.infer<typeof BookingState>;

export const AttestationState = z.enum(["sealed", "revealed", "expired"]);
export type AttestationState = z.infer<typeof AttestationState>;
