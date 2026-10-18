// ============================================================================
// Unit tests for the pure checkout logic.
// No server, no network, no real secret.
//   deno test supabase/functions/paystack-checkout/lib_test.ts
// ============================================================================
import {
  billableEmail,
  initializeBody,
  missingPlanCode,
  parseTier,
  pickAccount,
  resolveCallbackUrl,
  safeError,
  type Quote,
} from "./lib.ts";

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

Deno.test("one membership resolves to that account", () => {
  assertEquals(pickAccount([{ account_id: "a1" }]), { accountId: "a1" });
  // the same account listed twice is still one account: a user can hold a
  // membership per business under one account
  assertEquals(pickAccount([{ account_id: "a1" }, { account_id: "a1" }]), { accountId: "a1" });
});

Deno.test("no membership is refused, not defaulted", () => {
  assertEquals(pickAccount([]), { error: "no_account" });
  assertEquals(pickAccount(null), { error: "no_account" });
  assertEquals(pickAccount([{}]), { error: "no_account" });
});

Deno.test("TWO accounts REFUSES rather than billing the wrong business", () => {
  assertEquals(pickAccount([{ account_id: "a1" }, { account_id: "a2" }]),
    { error: "ambiguous_account" });
  // and order must not decide it -- there is no 'first' account to prefer
  assertEquals(pickAccount([{ account_id: "a2" }, { account_id: "a1" }]),
    { error: "ambiguous_account" });
});

Deno.test("a session without a usable email is refused before Paystack", () => {
  assertEquals(billableEmail({ email: "a@b.test" }), "a@b.test");
  assertEquals(billableEmail({}), null);
  assertEquals(billableEmail({ email: "" }), null);
  assertEquals(billableEmail({ email: "not-an-email" }), null);
  assertEquals(billableEmail(null), null);
});

// ============================================================================
// REGRESSION: the callback 404
//
// The first real test payment succeeded and Paystack sent the browser to
// https://menumasterng.com/checkout/callback, which 404s -- the route is not
// on the production-tracked branch. The payment was fine; the landing was not.
// ============================================================================

const SITE = "https://menumasterng.com";

Deno.test("with no proposed origin it uses SITE_URL, as before", () => {
  assertEquals(resolveCallbackUrl(undefined, SITE), `${SITE}/checkout/callback`);
  assertEquals(resolveCallbackUrl(null, SITE), `${SITE}/checkout/callback`);
  assertEquals(resolveCallbackUrl("", SITE), `${SITE}/checkout/callback`);
});

Deno.test("REGRESSION: a Vercel preview comes back to ITSELF, not to production", () => {
  assertEquals(
    resolveCallbackUrl("https://menu-master-work-abc123.vercel.app", SITE),
    "https://menu-master-work-abc123.vercel.app/checkout/callback",
  );
});

Deno.test("the production origin is honoured too", () => {
  assertEquals(resolveCallbackUrl(SITE, SITE), `${SITE}/checkout/callback`);
  assertEquals(resolveCallbackUrl(`${SITE}/`, SITE), `${SITE}/checkout/callback`);
});

Deno.test("a foreign origin is IGNORED, never redirected to", () => {
  for (const hostile of [
    "https://evil.test",
    "https://menumasterng.com.evil.test",
    "https://evil-vercel.app",              // the unanchored-suffix trap
    "https://vercel.app.evil.test",
    "http://menumasterng.com",              // http would strip the session
    "https://user:pass@x.vercel.app",       // credentials in the origin
    "https://x.vercel.app/../../elsewhere", // a path smuggled in
    "https://x.vercel.app?next=evil",       // a query smuggled in
    "javascript:alert(1)",
    "not a url at all",
    12345,
    {},
  ]) {
    assertEquals(
      resolveCallbackUrl(hostile as unknown, SITE),
      `${SITE}/checkout/callback`,
      `hostile origin was honoured: ${String(hostile)}`,
    );
  }
});

Deno.test("whatever it resolves to, the path is always our callback", () => {
  for (const o of [undefined, SITE, "https://p.vercel.app", "https://evil.test"]) {
    assert(
      resolveCallbackUrl(o as unknown, SITE).endsWith("/checkout/callback"),
      "the callback path must never be replaced",
    );
  }
});

Deno.test("the resolved callback is what reaches Paystack", () => {
  const cb = resolveCallbackUrl("https://p.vercel.app", SITE);
  const body = initializeBody(quote, "a@b.test", cb);
  assertEquals(body.callback_url, "https://p.vercel.app/checkout/callback");
});

// ============================================================================
// 0067: self-serve plan changes (owner decision D5). The refusals happen
// before the quote, so a refused request never takes a founder hold.
// ============================================================================
import {
  changeInProgress, checkoutRefusal, isPaying, pickAccountRole, readSubState, replacesCode, selfServeOn,
  type SubState,
} from "./lib.ts";
import { changeInProgress as manageChangeInProgress } from "../paystack-manage/lib.ts";

function ok(cond: unknown, msg = "assertion failed") { assert(cond, msg); }
function assertFalse(cond: unknown, msg = "expected false") { assert(!cond, msg); }

const NOW = new Date("2026-10-18T12:00:00Z");
const sub = (over: Partial<SubState>): SubState => ({
  status: "active", tier: "costing",
  current_period_end: "2026-11-18T12:00:00Z", provider_subscription_code: "SUB_old", ...over,
});

Deno.test("the owner of an account is recognised; staff are not", () => {
  assertEquals(pickAccountRole([{ account_id: "a1", role: "owner" }]), { accountId: "a1", isOwner: true });
  assertEquals(pickAccountRole([{ account_id: "a1", role: "manager" }]), { accountId: "a1", isOwner: false });
  assertEquals(pickAccountRole([{ account_id: "a1", role: "kitchen" }, { account_id: "a1", role: "owner" }]),
    { accountId: "a1", isOwner: true }, "an owner row on any business of the account counts");
  assertEquals(pickAccountRole([{ account_id: "a1", role: "owner" }, { account_id: "a2", role: "owner" }]),
    { error: "ambiguous_account" }, "two accounts still refuses, exactly as pickAccount");
  assertEquals(pickAccountRole([]), { error: "no_account" });
});

Deno.test("the subscription row is read from PostgREST's shape, plan tier embedded", () => {
  assertEquals(readSubState([{
    status: "active", current_period_end: "2026-11-18T12:00:00+00:00",
    provider_subscription_code: "SUB_x", plans: { tier: "trading" },
  }]), { status: "active", tier: "trading", current_period_end: "2026-11-18T12:00:00+00:00",
         provider_subscription_code: "SUB_x" });
  assertEquals(readSubState([]), null);
  assertEquals(readSubState(null), null);
  assertEquals(readSubState([{ status: "trialing", plans: null, provider_subscription_code: "" }])?.provider_subscription_code,
    null, "an empty code is no code");
});

Deno.test("paying means active, past_due, or cancelled inside the paid period", () => {
  ok(isPaying(sub({ status: "active" }), NOW));
  ok(isPaying(sub({ status: "past_due" }), NOW));
  ok(isPaying(sub({ status: "cancelled" }), NOW), "non-renewing, still inside the month paid for");
  assertFalse(isPaying(sub({ status: "cancelled", current_period_end: "2026-10-01T00:00:00Z" }), NOW));
  assertFalse(isPaying(sub({ status: "cancelled", current_period_end: null }), NOW));
  assertFalse(isPaying(sub({ status: "trialing", tier: "trial" }), NOW));
  assertFalse(isPaying(null, NOW));
});

Deno.test("the same tier while ACTIVE is already_on_plan (409)", () => {
  assertEquals(checkoutRefusal(sub({ status: "active", tier: "costing" }), "costing", true, NOW),
    { error: "already_on_plan", status: 409 });
  assertEquals(checkoutRefusal(sub({ status: "active", tier: "trading" }), "trading", false, NOW),
    { error: "already_on_plan", status: 409 }, "for anyone, before the owner check");
});

Deno.test("X2: overdue on the same tier is Pay now, a replacement of the failed subscription", () => {
  const overdue = sub({ status: "past_due", tier: "trading", current_period_end: "2026-10-10T12:00:00Z" });
  assertEquals(checkoutRefusal(overdue, "trading", true, NOW), null, "the owner may pay again by itself");
  assertEquals(replacesCode(overdue), "SUB_old", "and the payment names the failed subscription it replaces");
  const md = initializeBody(quote, "a@b.test", "https://x.test/cb", replacesCode(overdue)).metadata as
    Record<string, string>;
  assertEquals(md.replaces, "SUB_old", "exactly like a tier change, so the webhook switches it off");
});

Deno.test("X2: Pay now is still owner only, still needs a code on file, and obeys the kill switch", () => {
  const overdue = sub({ status: "past_due", tier: "trading" });
  assertEquals(checkoutRefusal(overdue, "trading", false, NOW), { error: "owner_only", status: 403 });
  assertEquals(checkoutRefusal(sub({ status: "past_due", tier: "trading", provider_subscription_code: null }),
    "trading", true, NOW), { error: "switch_needs_support", status: 409 },
    "with no code on file the failed subscription could not be switched off");
  assertEquals(checkoutRefusal(overdue, "trading", true, NOW, false), { error: "switch_needs_support", status: 409 });
});

Deno.test("a different tier goes ahead for the owner: no refusal", () => {
  assertEquals(checkoutRefusal(sub({ status: "active", tier: "costing" }), "trading", true, NOW), null);
  assertEquals(checkoutRefusal(sub({ status: "active", tier: "trading" }), "costing", true, NOW), null,
    "moving down is a different tier too");
  assertEquals(checkoutRefusal(sub({ status: "past_due", tier: "costing" }), "trading", true, NOW), null);
});

Deno.test("a cancelled plan still inside its period may choose again, same tier included (X8)", () => {
  assertEquals(checkoutRefusal(sub({ status: "cancelled", tier: "costing" }), "costing", true, NOW), null);
  assertEquals(replacesCode(sub({ status: "cancelled", tier: "costing" })), "SUB_old",
    "the ending subscription is named, so its own later events change nothing");
});

Deno.test("an account that already pays: only its owner may change, cancel or re-pay (owner_only 403)", () => {
  for (const s of [sub({ status: "active" }), sub({ status: "past_due" }), sub({ status: "cancelled" })]) {
    assertEquals(checkoutRefusal(s, "trading", false, NOW), { error: "owner_only", status: 403 }, s.status);
  }
});

Deno.test("a trial's first payment is unchanged: any member may pay", () => {
  const trial = sub({ status: "trialing", tier: "trial", provider_subscription_code: null });
  assertEquals(checkoutRefusal(trial, "costing", false, NOW), null);
  assertEquals(checkoutRefusal(trial, "trading", true, NOW), null);
  const ended = sub({ status: "trialing", tier: "trial", current_period_end: "2026-10-01T00:00:00Z",
                      provider_subscription_code: null });
  assertEquals(checkoutRefusal(ended, "costing", false, NOW), null, "an ended trial too");
  const lapsed = sub({ status: "cancelled", current_period_end: "2026-10-01T00:00:00Z" });
  assertEquals(checkoutRefusal(lapsed, "costing", false, NOW), null, "and a plan that has run out");
  assertEquals(checkoutRefusal(null, "costing", false, NOW), null);
});

Deno.test("a paying account with no subscription code on file cannot switch by itself", () => {
  assertEquals(checkoutRefusal(sub({ status: "active", provider_subscription_code: null }), "trading", true, NOW),
    { error: "switch_needs_support", status: 409 },
    "without the code the old subscription could not be switched off: a double charge");
  assertEquals(checkoutRefusal(sub({ status: "cancelled", provider_subscription_code: null }), "trading", true, NOW),
    null, "a non-renewing plan will not charge again, so it may go ahead");
});

Deno.test("the kill switch: BILLING_SELF_SERVE=off sends every live plan change to support", () => {
  assertEquals(checkoutRefusal(sub({ status: "active" }), "trading", true, NOW, false),
    { error: "switch_needs_support", status: 409 });
  assertEquals(checkoutRefusal(sub({ status: "past_due" }), "trading", true, NOW, false),
    { error: "switch_needs_support", status: 409 });
  assertEquals(checkoutRefusal(sub({ status: "cancelled" }), "trading", true, NOW, false), null,
    "a non-renewing plan cannot double charge, so it may still choose again");
  assertEquals(checkoutRefusal(sub({ status: "trialing", tier: "trial", provider_subscription_code: null }),
    "costing", false, NOW, false), null, "a trial's first payment is never blocked by it");
  ok(selfServeOn(undefined), "on by default");
  ok(selfServeOn(""));
  ok(selfServeOn("on"));
  assertFalse(selfServeOn("off"));
  assertFalse(selfServeOn(" OFF "));
});

Deno.test("refusals are checked in contract order: same plan first, then owner", () => {
  assertEquals(checkoutRefusal(sub({ status: "active", tier: "costing" }), "costing", false, NOW)?.error,
    "already_on_plan");
});

Deno.test("metadata.replaces carries the code on file when an account past its trial pays", () => {
  assertEquals(replacesCode(sub({ status: "active" })), "SUB_old");
  assertEquals(replacesCode(sub({ status: "past_due" })), "SUB_old");
  assertEquals(replacesCode(sub({ status: "cancelled" })), "SUB_old");
  assertEquals(replacesCode(sub({ status: "trialing", provider_subscription_code: null })), null);
  assertEquals(replacesCode(null), null);

  const body = initializeBody(quote, "a@b.test", "https://x.test/cb", replacesCode(sub({})));
  const md = body.metadata as Record<string, string>;
  assertEquals(Object.keys(md).sort(), ["account_id", "plan_id", "replaces"]);
  assertEquals(md.replaces, "SUB_old");
  assertEquals(md.account_id, quote.account_id, "the account still comes from the quote, never the client");
});

Deno.test("X3 at checkout: a pending replaced subscription is change_in_progress; only an empty list is clear", () => {
  assertFalse(changeInProgress([]));
  ok(changeInProgress([{ id: "b1" }]), "an earlier change still finishing");
  ok(changeInProgress(null), "an unreadable answer is never taken as clear");
  ok(changeInProgress({ message: "error" }));
  for (const rows of [[], [{ id: "b1" }], null, { message: "x" }, "[]"]) {
    assertEquals(changeInProgress(rows), manageChangeInProgress(rows), "checkout and paystack-manage agree");
  }
});

Deno.test("a first payment carries no replaces key at all", () => {
  const body = initializeBody(quote, "a@b.test", "https://x.test/cb", null);
  ok(!("replaces" in (body.metadata as Record<string, string>)));
});
