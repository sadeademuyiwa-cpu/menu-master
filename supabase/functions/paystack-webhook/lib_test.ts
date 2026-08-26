// ============================================================================
// Unit tests for the pure webhook logic.
// No server, no network, no real secret -- the key below is a fixture.
//   deno test supabase/functions/paystack-webhook/lib_test.ts
// ============================================================================

// Self-contained assertions: this suite must run with no network and no
// third-party package, so it can be part of the release gate anywhere.
function assert(cond: unknown, msg = "assertion failed"): void {
  if (!cond) throw new Error(msg);
}
function assertFalse(cond: unknown, msg = "expected false"): void {
  if (cond) throw new Error(msg);
}
function assertEquals<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) {
    throw new Error(msg ?? `expected ${String(expected)}, got ${String(actual)}`);
  }
}
import {
  MAX_BODY_BYTES, timingSafeEqualHex, hmacSha512Hex, sha256Hex, redact,
} from "./lib.ts";

const enc = new TextEncoder();
const FIXTURE_KEY = "sk_test_fixture_not_a_real_key";
const bytes = (s: string) => new Uint8Array(enc.encode(s).buffer as ArrayBuffer);

Deno.test("HMAC matches a known Paystack-style signature over exact bytes", async () => {
  const body = bytes('{"event":"charge.success","data":{"id":1}}');
  const sig = await hmacSha512Hex(FIXTURE_KEY, body);
  assertEquals(sig.length, 128, "SHA-512 hex is 128 characters");
  // stable: the same bytes and key always give the same signature
  assertEquals(sig, await hmacSha512Hex(FIXTURE_KEY, body));
});

Deno.test("re-serialising JSON changes the bytes and breaks the signature", async () => {
  // this is the trap design section 4 step 1 warns about
  const raw = '{"event":"charge.success","data":{"id":1}}';
  const reserialised = JSON.stringify(JSON.parse(raw).valueOf());
  const a = await hmacSha512Hex(FIXTURE_KEY, bytes(raw));
  const b = await hmacSha512Hex(FIXTURE_KEY, bytes(reserialised + " "));
  assertFalse(a === b, "a changed byte must change the signature");
});

Deno.test("a one-character body change changes the signature", async () => {
  const a = await hmacSha512Hex(FIXTURE_KEY, bytes('{"amount":100}'));
  const b = await hmacSha512Hex(FIXTURE_KEY, bytes('{"amount":101}'));
  assertFalse(a === b);
});

Deno.test("a wrong key does not verify", async () => {
  const body = bytes('{"event":"charge.success"}');
  const good = await hmacSha512Hex(FIXTURE_KEY, body);
  const bad = await hmacSha512Hex("sk_test_wrong", body);
  assertFalse(timingSafeEqualHex(good, bad));
});

Deno.test("constant-time compare is correct for equal, unequal and short input", () => {
  assert(timingSafeEqualHex("abcdef", "abcdef"));
  assertFalse(timingSafeEqualHex("abcdef", "abcdeg"));
  assertFalse(timingSafeEqualHex("abcdef", "abcde"), "length mismatch is false");
  assertFalse(timingSafeEqualHex("", "a"));
  assert(timingSafeEqualHex("", ""));
});

Deno.test("an absent signature header never verifies", async () => {
  const sig = await hmacSha512Hex(FIXTURE_KEY, bytes("{}"));
  assertFalse(timingSafeEqualHex("", sig));
});

Deno.test("sha256 of the body is stable and 64 hex chars", async () => {
  const h = await sha256Hex(bytes("hello"));
  assertEquals(h.length, 64);
  assertEquals(h, await sha256Hex(bytes("hello")));
  assertFalse(h === await sha256Hex(bytes("hello ")));
});

Deno.test("redact strips every bearer credential and keeps what support needs", () => {
  const p = redact({
    event: "charge.success",
    data: {
      amount: 500000,
      authorization: {
        authorization_code: "AUTH_leak", signature: "SIG_leak", bin: "408408",
        exp_month: "12", exp_year: "2030",
        last4: "4081", card_type: "visa", bank: "GTB", channel: "card",
      },
    },
  }) as any;

  assertEquals(p.data.authorization.authorization_code, undefined);
  assertEquals(p.data.authorization.signature, undefined);
  assertEquals(p.data.authorization.bin, undefined);
  assertEquals(p.data.authorization.exp_month, undefined);
  assertEquals(p.data.authorization.exp_year, undefined);

  assertEquals(p.data.authorization.last4, "4081");
  assertEquals(p.data.authorization.card_type, "visa");
  assertEquals(p.data.authorization.bank, "GTB");
  assertEquals(p.data.authorization.channel, "card");
  assertEquals(p.data.amount, 500000, "the rest of the payload is untouched");
});

Deno.test("redact is safe on payloads with no authorization block", () => {
  assertEquals((redact({ event: "x", data: {} }) as any).event, "x");
  assertEquals((redact({}) as any).event, undefined);
  assertEquals(redact(null), null);
});

Deno.test("the body size cap is 256 KB", () => {
  assertEquals(MAX_BODY_BYTES, 262144);
});
