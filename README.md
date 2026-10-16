# booker

A trustless coordination network that pairs musicians with venues — cafes,
farmers markets, galleries, hotel lobbies. A deterministic coordinator agent
matches both sides, and a signed attestation graph turns completed gigs into
portable reputation and measured second-order business effects.

Launch city: **Miami** (Wynwood / Midtown / Upper East Side cluster).

## The idea

Two-sided gig markets fail on trust: venues can't tell if an act will show up
or draw a crowd, musicians can't tell if a venue pays. Booker solves this with
one invariant:

> **Trust edges only form along real bookings.**

There are no free-floating reviews. After each gig, both parties submit a
*sealed* attestation — revealed simultaneously when both submit (or the
window expires) so neither can retaliate against the other's rating.
Reputation is *computed* from this signed log by anyone — it is never stored
as truth, never controlled by the platform.

## Trust model

- **Identity** — ed25519 keypairs, `did:key` identifiers, challenge-response
  auth. No passwords.
- **Commit-reveal attestations** — `sealed` until both parties submit or the
  72h window expires. Kills tit-for-tat review inflation.
- **Objective vs subjective claims** — `showed_up` / `paid` are facts
  (disagreement = dispute); `crowd_size` / `sales_lift` / `vibe_fit` are
  opinions (disagreement = lower-confidence data).
- **Computed reputation** — Wilson lower-bound reliability (5/5 gigs ≈ 0.21,
  50/50 ≈ 0.92), recency decay, per-pair multiplicity damping (colluding
  duos can't farm each other), ~5× weight on negative edges.
- **Second-order effects** — venues attest crowd/sales lift; the network
  aggregates which genres actually move business for which venue types.

## The coordinator

A **pure, deterministic, versioned function** — `assign(slots, musicians)`.
Same inputs always produce the same output; every proposal carries its
`coordinatorVersion` and an `inputHash` so anyone can reproduce it.

The coordinator is **advisory, not a gatekeeper**: it ranks and explains
(`rationale` on every proposal), never forces or blocks a match. Features:

- Hard constraints: availability windows, PA requirements, rate floors
- Genre/capacity fit scoring
- Miami seasonality priors (Art Basel → high, summer → trough)
- Neighborhood-adjacency saturation penalty — an act playing the same
  catchment weekly burns its own draw
- Exploration quota: ~20% of fills reserved for under-connected acts so
  reputation doesn't ossify

## Monorepo layout

```
packages/schema        enums (Miami genre/venue/neighborhood taxonomy),
                       zod validators, canonical-JSON signing, did:key crypto
packages/graph         reputation engine — attestation log → weighted edges →
                       per-subject reputation
packages/coordinator   scoring + epoch assignment (greedy w/ exploration quota)
services/api           Fastify + Prisma/Postgres REST API
apps/web               Next.js static SPA — WebCrypto keypairs, the whole
                       gig loop (register → slot/availability → coordinate →
                       accept → blind attest) in one page
```

## Quickstart

Requires Node ≥22, pnpm, Docker.

```bash
pnpm install
pnpm db:up                                   # postgres container :7105
cd services/api && cp ../../.env.example .env
pnpm db:push && pnpm db:generate             # schema → postgres
pnpm dev:api                                 # api on :7100
pnpm dev:web                                 # web on :7103  (repo root)
```

Smoke test the full loop (registers a venue + musician, posts a slot,
coordinates, accepts, dual-attests, prints reputation):

```bash
cd services/api
DATABASE_URL="postgresql://booker:booker@localhost:7105/booker" \
  npx tsx scripts/smoke.ts
```

## API surface

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/identities` | signature | register musician/venue (signed profile) |
| POST | `/auth/challenge` | — | issue login nonce |
| POST | `/auth/verify` | signature | verify sig → session token |
| GET | `/slots` | — | list open slots |
| POST | `/slots` | venue | create slot |
| DELETE | `/slots/:id` | venue | cancel own slot |
| POST/GET | `/availability` | musician | post/list availability windows |
| POST | `/coordinate` | session | run coordinator → proposed bookings |
| GET | `/bookings` | session | my bookings + attestations |
| POST | `/bookings/:id/accept\|decline\|cancel` | party | booking transitions |
| POST | `/bookings/:id/performed` | party | mark gig performed |
| POST | `/bookings/:id/attest` | party | submit sealed attestation |
| POST | `/bookings/:id/sweep` | session | lazy expiry of stale sealed attestations |
| GET | `/reputation/:did` | — | computed reputation |
| GET | `/musicians` `/venues` `/identities/:did` | — | discovery |

## Deploy

Frontend is a static export → Cloudflare Pages:

```bash
cd apps/web && npx next build        # emits out/
npx wrangler pages deploy out --project-name=booker
```

Live at **https://booker-46o.pages.dev**. Note the deployed SPA calls
`NEXT_PUBLIC_API_URL` (defaults `localhost:7100`) — expose the API publicly
(tunnel or host) and rebuild for the deployed site to function off-box.

## Roadmap

- [ ] Vouch/referral edges (endpoints exist in schema, need API routes)
- [ ] Payment rail (Stripe Connect) — doubles as the "paid" truth oracle
- [ ] Insights feed — aggregate second-order outcomes by genre × venue type
- [ ] Standby lists, cancellation windows
- [ ] Multiple competing coordinators (interface is already drop-in)
- [ ] es i18n
