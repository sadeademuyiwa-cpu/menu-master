// ============================================================================
// Unit tests for the pure checkout logic.
// No server, no network, no real secret.
//   deno test supabase/functions/paystack-checkout/lib_test.ts
// ============================================================================
import { initializeBody, missingPlanCode, parseTier, safeError, type Quote } from "./lib.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}
function assertEquals(a: unknown, b: unknown, msg = "") {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg}\n  got      ${x}\n  expected ${y}`);
}

const quote: Quote = {
  account_id: "11111111-1111-1111-1111-111111111111",
  plan_id: "founding_costing",
  plan_name: "Founding Costing",
  tier: "costing",
  price_tier: "founding",
  price_kobo: 350000,
  currency: "NGN",
  provider_plan_code: "PLN_founding_costing",
  founder_seq: 7,
  slots_remaining: 93,
};

Deno.test("only costing and trading are accepted as a tier", () => {
  assertEquals(parseTier({ tier: "costing" }), "costing");
  assertEquals(parseTier({ tier: "trading" }), "trading");
  assertEquals(parseTier({ tier: "founding" }), null);
  assertEquals(parseTier({ tier: "enterprise" }), null);
  assertEquals(parseTier({}), null);
  assertEquals(parseTier(null), null);
});

Deno.test("a hostile body cannot set the amount, the tier or the account", () => {
  // the client sends this...
  const hostile = {
    tier: "costing",
    amount: 100,
    price_kobo: 1,
    price_tier: "founding",
    plan_id: "founding_trading",
    account_id: "22222222-2222-2222-2222-222222222222",
  };
  // ...and the only field read is the tier
  assertEquals(parseTier(hostile), "costing");

  // the request Paystack receives is built entirely from the server's quote
  const body = initializeBody(quote, "a@b.test", "https://x.test/checkout/callback");
  assertEquals(body.amount, "350000", "amount comes from the quote, not the client");
  assertEquals((body.metadata as Record<string, string>).account_id, quote.account_id);
  assertEquals((body.metadata as Record<string, string>).plan_id, "founding_costing");
  assert(!("price_tier" in body), "no client field survives into the request");
});

Deno.test("metadata carries exactly what fn_billing_apply reads", () => {
  const body = initializeBody(quote, "a@b.test", "https://x.test/cb");
  const md = body.metadata as Record<string, string>;
  assertEquals(Object.keys(md).sort(), ["account_id", "plan_id"]);
});

Deno.test("the amount is a string of kobo, never naira and never a float", () => {
  const body = initializeBody(quote, "a@b.test", "https://x.test/cb");
  assertEquals(body.amount, "350000");
  assert(typeof body.amount === "string", "Paystack wants a string");
  assert(!String(body.amount).includes("."), "kobo are integers");
});

Deno.test("the plan code is sent so the charge becomes a subscription", () => {
  const body = initializeBody(quote, "a@b.test", "https://x.test/cb");
  assertEquals(body.plan, "PLN_founding_costing");
});

Deno.test("a quote with no plan code is refused before Paystack", () => {
  assert(!missingPlanCode(quote), "a mapped plan is fine");
  assert(missingPlanCode({ ...quote, provider_plan_code: null }),
    "an unmapped plan must be refused: a one-off charge is not what was sold");
  const body = initializeBody({ ...quote, provider_plan_code: null }, "a@b.test", "u");
  assert(!("plan" in body), "and no plan key is sent at all");
});

Deno.test("the callback url is ours, and is passed through unchanged", () => {
  const body = initializeBody(quote, "a@b.test", "https://menumasterng.com/checkout/callback");
  assertEquals(body.callback_url, "https://menumasterng.com/checkout/callback");
});

Deno.test("standard pricing initializes identically -- one code path, not two", () => {
  const std: Quote = {
    ...quote, plan_id: "costing", plan_name: "Costing", price_tier: "standard",
    price_kobo: 750000, provider_plan_code: "PLN_costing", founder_seq: null,
  };
  const body = initializeBody(std, "a@b.test", "https://x.test/cb");
  assertEquals(body.amount, "750000");
  assertEquals(body.plan, "PLN_costing");
  assertEquals((body.metadata as Record<string, string>).plan_id, "costing");
});

Deno.test("an error response is a fixed code and never a provider message", () => {
  const e = safeError("provider_unavailable");
  assertEquals(e, { error: "provider_unavailable" });
  assertEquals(Object.keys(e), ["error"]);
});
