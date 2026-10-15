"use client";

import { useCallback, useEffect, useState } from "react";
import { canonicalJson } from "@booker/schema/attestation";
import {
  generateIdentity,
  loadIdentity,
  saveIdentity,
  signBytes,
  type StoredIdentity,
} from "@/lib/keys";
import { api } from "@/lib/api";

interface Booking {
  id: string;
  state: string;
  musicianDid: string;
  venueDid: string;
  utility?: number;
  rationale?: string[];
  slot: { startsAt: string; endsAt: string; slotType: string };
  attestations: { issuerDid: string; state: string }[];
}

const GENRES = [
  "salsa", "timba", "afro_cuban", "jazz", "latin_jazz", "cumbia", "konpa",
  "rara", "acoustic_folk", "reggae", "latin_fusion", "classical", "bossa",
  "funk_soul", "other",
];
const VENUE_TYPES = [
  "cafe", "farmers_market", "restaurant", "brewery", "gallery",
  "hotel_lobby", "rooftop", "cultural_center", "private",
];
const NEIGHBORHOODS = [
  "wynwood", "midtown", "upper_east_side", "little_havana", "little_haiti",
  "miami_beach", "coconut_grove", "coral_gables", "brickell", "downtown",
  "north_beach", "hialeah", "other_miami",
];
const SLOT_TYPES = [
  "brunch", "afternoon_market", "happy_hour", "dinner", "late", "event",
];

export default function Home() {
  const [identity, setIdentity] = useState<StoredIdentity | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [actorType, setActorType] = useState<"musician" | "venue">("musician");
  const [name, setName] = useState("");
  const [genre, setGenre] = useState("jazz");
  const [neighborhood, setNeighborhood] = useState("wynwood");
  const [venueType, setVenueType] = useState("cafe");
  const [slots, setSlots] = useState<Record<string, unknown>[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [rep, setRep] = useState<Record<string, unknown> | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    setIdentity(loadIdentity());
    api<{ ok: boolean }>("/health").then((h) =>
      setMsg(h.ok ? "api up" : "api down"),
    );
    refreshSlots();
  }, []);

  const refreshSlots = useCallback(async () => {
    setSlots(await api<Record<string, unknown>[]>("/slots"));
  }, []);

  const refreshBookings = useCallback(async (t: string) => {
    setBookings(await api<Booking[]>("/bookings", { token: t }));
  }, []);

  const sign = useCallback(
    async (payload: object) => {
      const bytes = new TextEncoder().encode(canonicalJson(payload));
      return signBytes(identity!, bytes);
    },
    [identity],
  );

  async function register() {
    setErr("");
    try {
      const id = identity ?? (await generateIdentity());
      const profile =
        actorType === "musician"
          ? {
              displayName: name,
              genres: [genre],
              setLengthMin: 90,
              needsPa: false,
              languagePref: "either",
              homeNeighborhoods: [neighborhood],
            }
          : {
              displayName: name,
              venueType,
              neighborhood,
              genresWanted: [genre],
              payModel: "flat",
              hasPa: true,
              languagePref: "either",
            };
      const payload = { did: id.did, actorType, profile };
      const signature = await signBytes(
        id,
        new TextEncoder().encode(canonicalJson(payload)),
      );
      await api("/identities", {
        method: "POST",
        body: { ...payload, signature },
      });
      saveIdentity({ ...id, actorType });
      setIdentity({ ...id, actorType });
      setMsg("registered");
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function login() {
    setErr("");
    try {
      const { nonce } = await api<{ nonce: string }>("/auth/challenge", {
        method: "POST",
        body: { did: identity!.did },
      });
      const signature = await sign({ did: identity!.did, nonce });
      const { token: t } = await api<{ token: string }>("/auth/verify", {
        method: "POST",
        body: { did: identity!.did, nonce, signature },
      });
      setToken(t);
      setMsg("logged in");
      await refreshBookings(t);
      setRep(await api(`/reputation/${identity!.did}`));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function postSlot() {
    setErr("");
    try {
      const startsAt = new Date(Date.now() + 48 * 3600_000).toISOString();
      await api("/slots", {
        method: "POST",
        token: token!,
        body: {
          startsAt,
          endsAt: new Date(Date.now() + 50 * 3600_000).toISOString(),
          slotType: "dinner",
          genresWanted: [genre],
          payCents: 15000,
          payModel: "flat",
          needsOwnPa: false,
        },
      });
      setMsg("slot posted");
      await refreshSlots();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function postAvailability() {
    setErr("");
    try {
      await api("/availability", {
        method: "POST",
        token: token!,
        body: {
          startsAt: new Date(Date.now() + 24 * 3600_000).toISOString(),
          endsAt: new Date(Date.now() + 96 * 3600_000).toISOString(),
        },
      });
      setMsg("availability posted");
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function coordinate() {
    setErr("");
    try {
      const r = await api<{ proposalsCreated: number }>("/coordinate", {
        method: "POST",
        token: token!,
      });
      setMsg(`${r.proposalsCreated} proposals created`);
      await refreshBookings(token!);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function bookingAction(id: string, action: string) {
    setErr("");
    try {
      await api(`/bookings/${id}/${action}`, { method: "POST", token: token! });
      await refreshBookings(token!);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function attest(id: string) {
    setErr("");
    try {
      const booking = bookings.find((b) => b.id === id)!;
      const subjectDid =
        identity!.did === booking.venueDid ? booking.musicianDid : booking.venueDid;
      const claims = {
        objective: { showed_up: true, paid: true, paid_on_time: true },
        subjective: { crowd_size: "busy", sales_lift: "better", vibe_fit: 4, would_rebook: true },
      };
      const payload = { bookingId: id, issuerDid: identity!.did, subjectDid, claims };
      const signature = await sign(payload);
      await api(`/bookings/${id}/attest`, {
        method: "POST",
        token: token!,
        body: { claims, signature },
      });
      setMsg("attestation sealed");
      await refreshBookings(token!);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <main>
      <h1>booker — miami</h1>
      <p className="mono">{msg}</p>
      {err && <p className="err">{err}</p>}

      <h2>identity</h2>
      <div className="card">
        {identity ? (
          <>
            <p className="mono">{identity.did}</p>
            <div className="row">
              {!token && <button onClick={login}>login (sign challenge)</button>}
              {token && <span className="ok">session active</span>}
            </div>
          </>
        ) : (
          <button
            onClick={async () => setIdentity(await generateIdentity())}
          >
            generate keypair
          </button>
        )}
      </div>

      {identity && !token && (
        <>
          <h2>register</h2>
          <div className="card">
            <div className="row">
              <select
                value={actorType}
                onChange={(e) =>
                  setActorType(e.target.value as "musician" | "venue")
                }
              >
                <option value="musician">musician</option>
                <option value="venue">venue</option>
              </select>
              <input
                placeholder="display name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <select value={genre} onChange={(e) => setGenre(e.target.value)}>
                {GENRES.map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
              {actorType === "venue" && (
                <select
                  value={venueType}
                  onChange={(e) => setVenueType(e.target.value)}
                >
                  {VENUE_TYPES.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              )}
              <select
                value={neighborhood}
                onChange={(e) => setNeighborhood(e.target.value)}
              >
                {NEIGHBORHOODS.map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
              <button onClick={register} disabled={!name}>
                register (signed)
              </button>
            </div>
          </div>
        </>
      )}

      {token && (
        <>
          <h2>actions</h2>
          <div className="card">
            <div className="row">
              {identity?.actorType === "venue" && (
                <button onClick={postSlot}>post slot (+48h, $150)</button>
              )}
              {identity?.actorType === "musician" && (
                <button onClick={postAvailability}>
                  post availability (+24h→+96h)
                </button>
              )}
              <button className="secondary" onClick={coordinate}>
                run coordinator
              </button>
              <button
                className="secondary"
                onClick={() => refreshBookings(token)}
              >
                refresh
              </button>
            </div>
          </div>

          {rep && (
            <>
              <h2>my reputation</h2>
              <div className="card mono">
                score {String(rep.score)} · reliability{" "}
                {String(rep.reliability)} · edges {String(rep.edgeCount)} ·
                rebook {String(rep.rebookRate)} · disputes{" "}
                {String(rep.disputes)}
              </div>
            </>
          )}

          <h2>my bookings</h2>
          {bookings.map((b) => (
            <div className="card" key={b.id}>
              <div>
                <span className="tag">{b.state}</span>
                <span className="tag">{b.slot.slotType}</span>{" "}
                {new Date(b.slot.startsAt).toLocaleString()} · utility{" "}
                {b.utility?.toFixed(3)}
              </div>
              <div className="mono">
                venue {b.venueDid.slice(0, 28)}… ↔ musician{" "}
                {b.musicianDid.slice(0, 28)}…
              </div>
              {(b.rationale ?? []).map((r, i) => (
                <div className="mono" key={i}>
                  · {r}
                </div>
              ))}
              <div className="row" style={{ marginTop: "0.5rem" }}>
                {b.state === "proposed" && (
                  <>
                    <button onClick={() => bookingAction(b.id, "accept")}>
                      accept
                    </button>
                    <button
                      className="secondary"
                      onClick={() => bookingAction(b.id, "decline")}
                    >
                      decline
                    </button>
                  </>
                )}
                {["accepted", "performed"].includes(b.state) &&
                  !b.attestations.some((a) => a.issuerDid === identity!.did) && (
                    <button onClick={() => attest(b.id)}>
                      attest (blind)
                    </button>
                  )}
                {b.attestations.length > 0 && (
                  <span className="mono">
                    attestations: {b.attestations.map((a) => a.state).join(", ")}
                  </span>
                )}
              </div>
            </div>
          ))}
        </>
      )}

      <h2>open slots</h2>
      {slots.length === 0 && <p className="mono">none</p>}
      {slots.map((s) => (
        <div className="card mono" key={String(s.id)}>
          {String(s.slotType)} · {new Date(String(s.startsAt)).toLocaleString()}{" "}
          · pay ${((s.payCents as number) ?? 0) / 100} ·{" "}
          {(s.genresWanted as string[]).join(", ") || "open"}
        </div>
      ))}
    </main>
  );
}
