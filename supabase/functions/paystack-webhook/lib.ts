// ============================================================================
// Pure webhook logic, extracted so it can be unit-tested without a server, a
// network or a real secret. index.ts imports from here; nothing is duplicated.
// ============================================================================

export const MAX_BODY_BYTES = 256 * 1024; // step 5: reject before hashing

const enc = new TextEncoder();

/** Constant-time comparison. A byte-by-byte compare with early exit leaks the
 *  signature through timing, which is step 3's whole point. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hmacSha512Hex(key: string, body: Uint8Array<ArrayBuffer>): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(key),
    { name: "HMAC", hash: "SHA-512" }, false, ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", cryptoKey, body));
}

export async function sha256Hex(body: Uint8Array<ArrayBuffer>): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", body));
}

/** Strip the bearer credential before the payload ever leaves this process.
 *  The database strips it again on insert (0027); this is the first of the two
 *  layers, not the only one. */
export function redact(payload: unknown): unknown {
  const p = payload as Record<string, any>;
  const auth = p?.data?.authorization;
  if (auth && typeof auth === "object") {
    delete auth.authorization_code;
    delete auth.signature;
    delete auth.bin;
    delete auth.exp_month;
    delete auth.exp_year;
  }
  return p;
}

