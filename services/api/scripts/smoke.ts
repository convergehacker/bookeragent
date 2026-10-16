import {
  canonicalJson,
  generateIdentity,
  signPayload,
} from "@booker/schema";

const API = process.env.API_URL ?? "http://localhost:7100";

async function call<T = any>(path: string, opts: any = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      ...(opts.body !== undefined
        ? { "content-type": "application/json" }
        : {}),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path}: ${JSON.stringify(json)}`);
  return json as T;
}

function sign(kp: ReturnType<typeof generateIdentity>, payload: object) {
  const bytes = new TextEncoder().encode(canonicalJson(payload));
  return Buffer.from(signPayload(bytes, kp.privateKeyDer)).toString("base64");
}

async function login(kp: ReturnType<typeof generateIdentity>) {
  const { nonce } = await call("/auth/challenge", {
    method: "POST",
    body: { did: kp.did },
  });
  const signature = sign(kp, { did: kp.did, nonce });
  const { token } = await call("/auth/verify", {
    method: "POST",
    body: { did: kp.did, nonce, signature },
  });
  return token as string;
}

async function register(kp: ReturnType<typeof generateIdentity>, actorType: string, profile: object) {
  const payload = { did: kp.did, actorType, profile };
  const signature = sign(kp, payload);
  await call("/identities", { method: "POST", body: { ...payload, signature } });
}

const venue = generateIdentity();
const musician = generateIdentity();

await register(venue, "venue", {
  displayName: "Wynwood Cafe Test",
  venueType: "cafe",
  neighborhood: "wynwood",
  genresWanted: ["jazz", "bossa"],
  payModel: "flat",
  hasPa: true,
  languagePref: "either",
});
console.log("venue registered:", venue.did);

await register(musician, "musician", {
  displayName: "Test Trio",
  genres: ["jazz", "latin_jazz"],
  setLengthMin: 90,
  needsPa: false,
  languagePref: "either",
  homeNeighborhoods: ["wynwood"],
});
console.log("musician registered:", musician.did);

const venueToken = await login(venue);
const musicianToken = await login(musician);
console.log("both logged in");

const slot = await call("/slots", {
  method: "POST",
  token: venueToken,
  body: {
    startsAt: new Date(Date.now() + 48 * 3600_000).toISOString(),
    endsAt: new Date(Date.now() + 50 * 3600_000).toISOString(),
    slotType: "dinner",
    genresWanted: ["jazz"],
    payCents: 15000,
    payModel: "flat",
    needsOwnPa: false,
  },
});
console.log("slot:", slot.id);

await call("/availability", {
  method: "POST",
  token: musicianToken,
  body: {
    startsAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
    endsAt: new Date(Date.now() + 96 * 3600_000).toISOString(),
  },
});
console.log("availability posted");

const coord = await call("/coordinate", { method: "POST", token: venueToken });
console.log("coordinator:", coord.proposalsCreated, "proposals, hash", coord.inputHash);
const booking = coord.bookings.find((b: any) => b.musicianDid === musician.did);
if (!booking) throw new Error("no proposal for our musician");
console.log("rationale:", booking.rationale);

await call(`/bookings/${booking.id}/accept`, { method: "POST", token: musicianToken });
console.log("musician accepted");

// Both attest (blind)
const attestVenue = async (claims: object) => {
  const payload = {
    bookingId: booking.id,
    issuerDid: venue.did,
    subjectDid: musician.did,
    claims,
  };
  await call(`/bookings/${booking.id}/attest`, {
    method: "POST",
    token: venueToken,
    body: { claims, signature: sign(venue, payload) },
  });
};
const attestMusician = async (claims: object) => {
  const payload = {
    bookingId: booking.id,
    issuerDid: musician.did,
    subjectDid: venue.did,
    claims,
  };
  await call(`/bookings/${booking.id}/attest`, {
    method: "POST",
    token: musicianToken,
    body: { claims, signature: sign(musician, payload) },
  });
};

const venueSays = {
  objective: { showed_up: true, paid: true, paid_on_time: true },
  subjective: { crowd_size: "busy", sales_lift: "better", vibe_fit: 5, would_rebook: true },
};
const musicianSays = {
  objective: { showed_up: true, paid: true, paid_on_time: true },
  subjective: { crowd_size: "busy", vibe_fit: 4, would_rebook: true },
};

await attestVenue(venueSays);
console.log("venue attested (sealed)");
await attestMusician(musicianSays);
console.log("musician attested (should trigger reveal)");

const rep = await call(`/reputation/${musician.did}`);
console.log("musician rep:", rep);
const repV = await call(`/reputation/${venue.did}`);
console.log("venue rep:", repV);
