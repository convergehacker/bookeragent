// Pure encoding helpers — no node:crypto, safe for browser use.

const B58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function base58btcEncode(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      const n = (digits[i] << 8) + carry;
      digits[i] = n % 58;
      carry = (n / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  return (
    "1".repeat(zeros) +
    digits
      .reverse()
      .map((d) => B58_ALPHABET[d])
      .join("")
  );
}

export function base58btcDecode(s: string): Uint8Array {
  const bytes = [0];
  for (const ch of s) {
    const val = B58_ALPHABET.indexOf(ch);
    if (val === -1) throw new Error(`invalid base58 char: ${ch}`);
    let carry = val;
    for (let i = 0; i < bytes.length; i++) {
      const n = bytes[i] * 58 + carry;
      bytes[i] = n & 0xff;
      carry = n >> 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let zeros = 0;
  while (zeros < s.length && s[zeros] === "1") zeros++;
  return new Uint8Array([...new Array(zeros).fill(0), ...bytes.reverse()]);
}

const ED25519_MULTICODEC = new Uint8Array([0xed, 0x01]);

export function didFromPublicKeyRaw(rawPub: Uint8Array): string {
  const prefixed = new Uint8Array(ED25519_MULTICODEC.length + rawPub.length);
  prefixed.set(ED25519_MULTICODEC);
  prefixed.set(rawPub, ED25519_MULTICODEC.length);
  return `did:key:z${base58btcEncode(prefixed)}`;
}

export function publicKeyRawFromDid(did: string): Uint8Array {
  if (!did.startsWith("did:key:z")) throw new Error("unsupported DID method");
  const decoded = base58btcDecode(did.slice("did:key:z".length));
  if (
    decoded[0] !== ED25519_MULTICODEC[0] ||
    decoded[1] !== ED25519_MULTICODEC[1]
  ) {
    throw new Error("not an ed25519 did:key");
  }
  return decoded.slice(2);
}
