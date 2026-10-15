# booker

Trustless coordination network pairing musicians with venues. Launch: Miami (Wynwood/Midtown/UES cluster).

## Layout
- `packages/schema` — enums (Miami taxonomy), zod validators, did:key + ed25519 crypto, canonical JSON signing. `encoding.ts`/`enums.ts`/`attestation.ts` are browser-safe subpaths; `crypto.ts` is node-only.
- `packages/graph` — reputation computed from revealed attestations (Wilson bound, recency decay, pair-multiplicity damping, 5x negative weight).
- `packages/coordinator` — pure deterministic matching: `assign(slots, musicians) → proposals + rationale`. Versioned (`COORDINATOR_VERSION`), reproducible via `inputHash`.
- `services/api` — Fastify + Prisma/Postgres. Challenge-response auth over did:key. Commit-reveal attestations (sealed → revealed on dual submit or 72h expiry).
- `apps/web` — Next.js, WebCrypto ed25519 keypairs in localStorage.

## Run
```
pnpm install
pnpm db:up          # postgres on :7105
cd services/api && cp ../../.env.example .env && pnpm db:push && pnpm db:generate
pnpm dev:api        # :7100
pnpm dev:web        # :7103
pnpm --filter @booker/api exec tsx scripts/smoke.ts   # e2e smoke
```

## Invariants
- Trust edges only form along real bookings — no free-floating reviews.
- Attestations are blind: sealed until both parties submit or window expires.
- Reputation is computed from the attestation log, never stored as truth.
- Coordinator is advisory: ranks + explains, never forces or blocks a match.
