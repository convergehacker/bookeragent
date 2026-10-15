"use client";

import { didFromPublicKeyRaw } from "@booker/schema/encoding";

export interface StoredIdentity {
  did: string;
  pkcs8: string; // base64 private key
  spki: string; // base64 public key
  actorType?: "musician" | "venue";
}

const STORAGE_KEY = "booker.identity";

export async function generateIdentity(): Promise<StoredIdentity> {
  const pair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  );
  const rawPub = new Uint8Array(
    await crypto.subtle.exportKey("raw", pair.publicKey),
  );
  const pkcs8 = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", pair.privateKey),
  );
  const identity: StoredIdentity = {
    did: didFromPublicKeyRaw(rawPub),
    pkcs8: btoa(String.fromCharCode(...pkcs8)),
    spki: btoa(String.fromCharCode(...rawPub)),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
  return identity;
}

export function loadIdentity(): StoredIdentity | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as StoredIdentity) : null;
}

export function saveIdentity(identity: StoredIdentity): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(identity));
}

async function privateKey(identity: StoredIdentity): Promise<CryptoKey> {
  const bytes = Uint8Array.from(atob(identity.pkcs8), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", bytes, { name: "Ed25519" }, false, [
    "sign",
  ]);
}

export async function signBytes(
  identity: StoredIdentity,
  payload: Uint8Array,
): Promise<string> {
  const key = await privateKey(identity);
  const sig = await crypto.subtle.sign("Ed25519", key, payload as BufferSource);
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}
