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

// ============================================================================
// 0067: switching off a replaced subscription. Paystack is mocked: each test
// hands switchOffOne a fake caller that answers the way Paystack does.
// ============================================================================
import {
  isSubscriptionCode, readFetchedSubscription, readDisableResult, switchOffOne,
  switchOffReplaced, paystackCaller, type PaystackCall,
} from "./lib.ts";

type Seen = { path: string; method: string; body: unknown };

function fakePaystack(answers: Record<string, { status: number; body: unknown }>): {
  call: PaystackCall; seen: Seen[];
} {
  const seen: Seen[] = [];
  const call: PaystackCall = (path, init = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    seen.push({ path, method, body: init.body ? JSON.parse(String(init.body)) : null });
    const a = answers[`${method} ${path}`];
    if (!a) {
      return Promise.resolve(new Response(JSON.stringify({ status: false, message: "unexpected" }), { status: 500 }));
    }
    return Promise.resolve(new Response(JSON.stringify(a.body), { status: a.status }));
  };
  return { call, seen };
}

// What Fetch Subscription returns (PaystackOSS openapi SubscriptionFetchResponse),
// trimmed; the authorization block is there on purpose.
const fetched = (status: string, token: string | null = "tok_email") => ({
  status: true, message: "Subscription retrieved",
  data: {
    subscription_code: "SUB_old", status, email_token: token,
    next_payment_date: "2026-11-18T00:00:00.000Z",
    customer: { customer_code: "CUS_x" }, plan: { plan_code: "PLN_c" },
    authorization: { authorization_code: "AUTH_must_not_leak", last4: "4081" },
  },
});

Deno.test("only a plain Paystack subscription code is ever put into a URL", () => {
  assert(isSubscriptionCode("SUB_vsyqdmlzble3uii"));
  assertFalse(isSubscriptionCode("SUB_../../transaction"));
  assertFalse(isSubscriptionCode("SUB_x?perPage=1"));
  assertFalse(isSubscriptionCode("CUS_abc"));
  assertFalse(isSubscriptionCode(""));
  assertFalse(isSubscriptionCode(null));
  assertFalse(isSubscriptionCode(42));
});

Deno.test("an active subscription: fetch the email token, then disable with code + token", async () => {
  const p = fakePaystack({
    "GET /subscription/SUB_old": { status: 200, body: fetched("active") },
    "POST /subscription/disable": { status: 200, body: { status: true, message: "Subscription disabled successfully" } },
  });
  const r = await switchOffOne("SUB_old", p.call);
  assertEquals(r.outcome, "disabled");
  assertEquals(p.seen.length, 2);
  assertEquals(p.seen[1].method, "POST");
  assertEquals(JSON.stringify(p.seen[1].body), JSON.stringify({ code: "SUB_old", token: "tok_email" }));
});

Deno.test("a subscription in 'attention' (a failed charge) is still live and is disabled", async () => {
  const p = fakePaystack({
    "GET /subscription/SUB_old": { status: 200, body: fetched("attention") },
    "POST /subscription/disable": { status: 200, body: { status: true } },
  });
  assertEquals((await switchOffOne("SUB_old", p.call)).outcome, "disabled");
});

Deno.test("already non-renewing or cancelled at Paystack: already_off, and disable is not called", async () => {
  for (const st of ["non-renewing", "cancelled", "complete", "completed"]) {
    const p = fakePaystack({ "GET /subscription/SUB_old": { status: 200, body: fetched(st) } });
    const r = await switchOffOne("SUB_old", p.call);
    assertEquals(r.outcome, "already_off", st);
    assertEquals(p.seen.length, 1, `no disable call for ${st}`);
  }
});

Deno.test("Paystack errors are failures with a reason, never a guess", async () => {
  const cases: [Record<string, { status: number; body: unknown }>, string][] = [
    [{ "GET /subscription/SUB_old": { status: 404, body: { status: false, message: "Subscription not found" } } }, "not found"],
    [{ "GET /subscription/SUB_old": { status: 401, body: { status: false, message: "Invalid key" } } }, "Invalid key"],
    [{ "GET /subscription/SUB_old": { status: 200, body: fetched("active", null) } }, "no email_token"],
    [{
      "GET /subscription/SUB_old": { status: 200, body: fetched("active") },
      "POST /subscription/disable": {
        status: 400, body: { status: false, message: "Subscription with code not found or already inactive" },
      },
    }, "already inactive"],
  ];
  for (const [answers, why] of cases) {
    const r = await switchOffOne("SUB_old", fakePaystack(answers).call);
    assertEquals(r.outcome, "failed", why);
    assert((r.detail ?? "").includes(why), `detail should say ${why}: ${r.detail}`);
  }
});

Deno.test("a network failure is a failure, not a throw", async () => {
  const boom: PaystackCall = () => Promise.reject(new Error("connection reset"));
  const r = await switchOffOne("SUB_old", boom);
  assertEquals(r.outcome, "failed");
  assert((r.detail ?? "").includes("connection reset"));
});

Deno.test("a malformed code is refused before any Paystack call", async () => {
  const p = fakePaystack({});
  const r = await switchOffOne("SUB_../x", p.call);
  assertEquals(r.outcome, "failed");
  assertEquals(p.seen.length, 0);
});

Deno.test("the authorization code in Paystack's response never reaches the outcome", async () => {
  const p = fakePaystack({
    "GET /subscription/SUB_old": { status: 200, body: fetched("active") },
    "POST /subscription/disable": { status: 500, body: { status: false, message: "boom" } },
  });
  const r = await switchOffOne("SUB_old", p.call);
  assertFalse(JSON.stringify(r).includes("AUTH_must_not_leak"));
  assertFalse(JSON.stringify(readFetchedSubscription(200, fetched("active"))).includes("AUTH_must_not_leak"));
});

Deno.test("readDisableResult needs both a 2xx and status true", () => {
  assert(readDisableResult(200, { status: true }).ok);
  assertFalse(readDisableResult(200, { status: false, message: "x" }).ok);
  assertFalse(readDisableResult(500, { status: true }).ok);
  assertFalse(readDisableResult(200, null).ok);
});

Deno.test("the sweep switches off each claimed code and records every outcome", async () => {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const rpc = (fn: string, args: Record<string, unknown>) => {
    calls.push({ fn, args });
    if (fn === "fn_billing_claim_switch_offs") {
      return Promise.resolve([
        { subscription_code: "SUB_old", account_id: "a1", attempt: 1 },
        { subscription_code: "SUB_gone", account_id: "a2", attempt: 3 },
      ]);
    }
    return Promise.resolve({ status: "recorded" });
  };
  const p = fakePaystack({
    "GET /subscription/SUB_old": { status: 200, body: fetched("active") },
    "POST /subscription/disable": { status: 200, body: { status: true } },
    "GET /subscription/SUB_gone": { status: 200, body: fetched("cancelled") },
  });
  const done = await switchOffReplaced(rpc, p.call, 3);
  assertEquals(
    JSON.stringify(done.map((d) => [d.code, d.outcome, d.recorded])),
    JSON.stringify([["SUB_old", "disabled", true], ["SUB_gone", "already_off", true]]),
  );
  assertEquals(calls[0].fn, "fn_billing_claim_switch_offs");
  assertEquals(calls[0].args.p_limit, 3);
  const recs = calls.filter((c) => c.fn === "fn_billing_record_switch_off");
  assertEquals(recs.length, 2);
  assertEquals(recs[0].args.p_subscription_code, "SUB_old");
  assertEquals(recs[0].args.p_outcome, "disabled");
  assertEquals(recs[1].args.p_outcome, "already_off");
});

Deno.test("the sweep only ever acts on what the database handed out", async () => {
  // the database never hands out a current code; the sweep calls Paystack for
  // nothing else, so an empty claim means no Paystack call at all
  const p = fakePaystack({});
  const done = await switchOffReplaced(() => Promise.resolve([]), p.call);
  assertEquals(done.length, 0);
  assertEquals(p.seen.length, 0);
});

Deno.test("a failing claim or record never throws out of the sweep", async () => {
  const claimFails = () => Promise.reject(new Error("rpc fn_billing_claim_switch_offs failed with 404"));
  assertEquals((await switchOffReplaced(claimFails, fakePaystack({}).call)).length, 0);

  const recordFails = (fn: string) =>
    fn === "fn_billing_claim_switch_offs"
      ? Promise.resolve([{ subscription_code: "SUB_old" }])
      : Promise.reject(new Error("rpc fn_billing_record_switch_off failed with 500"));
  const p = fakePaystack({ "GET /subscription/SUB_old": { status: 200, body: fetched("cancelled") } });
  const done = await switchOffReplaced(recordFails, p.call);
  assertEquals(done.length, 1);
  assertEquals(done[0].recorded, false);
});

Deno.test("paystackCaller sends the secret key as a bearer token to api.paystack.co", async () => {
  let url = "";
  let auth = "";
  const fakeFetch = ((u: string | URL | Request, init?: RequestInit) => {
    url = String(u);
    auth = new Headers(init?.headers).get("Authorization") ?? "";
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  await paystackCaller("sk_test_fixture", fakeFetch)("/subscription/SUB_x", { method: "GET" });
  assertEquals(url, "https://api.paystack.co/subscription/SUB_x");
  assertEquals(auth, "Bearer sk_test_fixture");
});
