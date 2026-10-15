import {
  generateKeyPairSync,
  createPublicKey,
  createPrivateKey,
  sign as edSign,
  verify as edVerify,
  KeyObject,
} from "node:crypto";
import {
  didFromPublicKeyRaw,
  publicKeyRawFromDid,
} from "./encoding.js";

// Extract the 32-byte raw key from a DER-encoded ed25519 SubjectPublicKeyInfo.
// DER SPKI for ed25519 is fixed-length: 12-byte header + 32-byte key.
function rawFromPublicKeyObject(key: KeyObject): Uint8Array {
  const der = key.export({ format: "der", type: "spki" });
  return new Uint8Array(der.subarray(der.length - 32));
}

export interface KeyPair {
  did: string;
  publicKeyDer: Uint8Array;
  privateKeyDer: Uint8Array;
}

export function generateIdentity(): KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyDer = new Uint8Array(
    publicKey.export({ format: "der", type: "spki" }),
  );
  const privateKeyDer = new Uint8Array(
    privateKey.export({ format: "der", type: "pkcs8" }),
  );
  return {
    did: didFromPublicKeyRaw(rawFromPublicKeyObject(publicKey)),
    publicKeyDer,
    privateKeyDer,
  };
}

export function publicKeyObjectFromDid(did: string): KeyObject {
  const raw = publicKeyRawFromDid(did);
  const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
  return createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, Buffer.from(raw)]),
    format: "der",
    type: "spki",
  });
}

export function privateKeyObjectFromDer(privateKeyDer: Uint8Array): KeyObject {
  return createPrivateKey({
    key: Buffer.from(privateKeyDer),
    format: "der",
    type: "pkcs8",
  });
}

export function signPayload(
  payload: Uint8Array,
  privateKeyDer: Uint8Array,
): Uint8Array {
  return new Uint8Array(
    edSign(null, Buffer.from(payload), privateKeyObjectFromDer(privateKeyDer)),
  );
}

export function verifyPayload(
  payload: Uint8Array,
  signature: Uint8Array,
  did: string,
): boolean {
  try {
    return edVerify(
      null,
      Buffer.from(payload),
      publicKeyObjectFromDid(did),
      Buffer.from(signature),
    );
  } catch {
    return false;
  }
}
