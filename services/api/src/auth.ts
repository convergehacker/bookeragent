import { createHash, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { canonicalJson, verifyPayload } from "@booker/schema";
import { db } from "./db.js";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function issueChallenge(did: string): Promise<string> {
  const nonce = randomBytes(32).toString("hex");
  await db.challenge.create({
    data: {
      nonce,
      did,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
  });
  return nonce;
}

export async function verifyChallenge(
  did: string,
  nonce: string,
  signatureB64: string,
): Promise<string | null> {
  const challenge = await db.challenge.findUnique({ where: { nonce } });
  if (!challenge || challenge.did !== did || challenge.expiresAt < new Date()) {
    return null;
  }
  const payload = Buffer.from(canonicalJson({ did, nonce }), "utf8");
  const ok = verifyPayload(
    new Uint8Array(payload),
    new Uint8Array(Buffer.from(signatureB64, "base64")),
    did,
  );
  if (!ok) return null;
  await db.challenge.delete({ where: { nonce } });

  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await db.session.create({
    data: { token: tokenHash, did, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  });
  return token;
}

export interface AuthedRequest extends FastifyRequest {
  did: string;
}

export async function requireAuth(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    await reply.code(401).send({ error: "missing bearer token" });
    return;
  }
  const tokenHash = createHash("sha256")
    .update(header.slice(7))
    .digest("hex");
  const session = await db.session.findUnique({ where: { token: tokenHash } });
  if (!session || session.expiresAt < new Date()) {
    await reply.code(401).send({ error: "invalid or expired session" });
    return;
  }
  (req as AuthedRequest).did = session.did;
}
