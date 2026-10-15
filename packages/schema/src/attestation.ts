import { z } from "zod";
import { EdgeType } from "./enums.js";

// Claims both parties can make after a gig. Split objective (verifiable,
// dispute = someone is lying) from subjective (opinion, disagreement is data).

export const ObjectiveClaims = z.object({
  showed_up: z.boolean(),
  paid: z.boolean(),
  paid_on_time: z.boolean().optional(),
  set_length_ok: z.boolean().optional(),
});
export type ObjectiveClaims = z.infer<typeof ObjectiveClaims>;

export const SubjectiveClaims = z.object({
  crowd_size: z.enum(["empty", "light", "normal", "busy", "packed"]).optional(),
  sales_lift: z.enum(["worse", "same", "better", "much_better"]).optional(),
  vibe_fit: z.number().int().min(1).max(5).optional(),
  would_rebook: z.boolean().optional(),
});
export type SubjectiveClaims = z.infer<typeof SubjectiveClaims>;

export const GigClaims = z.object({
  objective: ObjectiveClaims,
  subjective: SubjectiveClaims.optional(),
});
export type GigClaims = z.infer<typeof GigClaims>;

export const VouchClaims = z.object({
  statement: z.string().max(500).optional(),
});
export type VouchClaims = z.infer<typeof VouchClaims>;

export const ReferralClaims = z.object({
  targetDid: z.string().startsWith("did:key:"),
  context: z.string().max(500).optional(),
});
export type ReferralClaims = z.infer<typeof ReferralClaims>;

// An attestation edge in the trust graph. `payload` is the canonical JSON
// bytes that were signed — stored so any node can re-verify.
export const Attestation = z.object({
  id: z.string(),
  type: EdgeType,
  issuer: z.string().startsWith("did:key:"),
  subject: z.string().startsWith("did:key:"),
  bookingId: z.string().optional(),
  claims: z.record(z.unknown()),
  signature: z.string(), // base64 ed25519 sig over canonical payload
  issuedAt: z.string().datetime(),
});
export type Attestation = z.infer<typeof Attestation>;

// Canonical serialization for signing: sorted keys, no whitespace.
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}
