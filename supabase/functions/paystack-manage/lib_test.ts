// ============================================================================
// Unit tests for paystack-manage's pure logic. No server, no network, no real
// secret: Paystack is a fake that answers the way the public API describes.
//   deno test supabase/functions/paystack-manage/lib_test.ts
// ============================================================================
import {
  cancelEndsOn, cardLink, changeInProgress, endsOn, ERRORS, errorBody, manageRefusal, parseAction,
  paystackCaller, type PaystackCall, pickAccountRole, readSubState, safeManageLink, stopRenewal,
  type SubState,
} from "./lib.ts";
import { pickAccountRole as checkoutPick } from "../paystack-checkout/lib.ts";

function assert(cond: unknown, msg = "assertion failed"): void {
  if (!cond) throw new Error(msg);
}
function assertFalse(cond: unknown, msg = "expected false"): void {
  if (cond) throw new Error(msg);
}
function assertEquals(a: unknown, b: unknown, msg = ""): void {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg}\n  got      ${x}\n  expected ${y}`);
}

type Seen = { path: string; method: string; body: unknown };
function fakePaystack(answers: Record<string, { status: number; body: unknown }>) {
  const seen: Seen[] = [];
  const call: PaystackCall = (path, init = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    seen.push({ path, method, body: init.body ? JSON.parse(String(init.body)) : null });
    const a = answers[`${method} ${path}`];
    return Promise.resolve(a
      ? new Response(JSON.stringify(a.body), { status: a.status })
      : new Response(JSON.stringify({ status: false, message: "unexpected" }), { status: 500 }));
  };
  return { call, seen };
}

const NOW = new Date("2026-10-18T12:00:00Z");
const sub = (over: Partial<SubState> = {}): SubState => ({
  status: "active", current_period_end: "2026-11-18T09:30:00Z",
  cancel_at_period_end: false, provider_subscription_code: "SUB_cur", ...over,
});
const fetched = (status: string, token: string | null = "tok_email") => ({
  status: true, message: "Subscription retrieved",
  data: { subscription_code: "SUB_cur", status, email_token: token,
          authorization: { authorization_code: "AUTH_must_not_leak" } },
});

// ---------------------------------------------------------------- the contract
Deno.test("the error codes and statuses are exactly the K3 contract plus X3's change_in_progress", () => {
  assertEquals(ERRORS, {
    unauthorised: 401, owner_only: 403, nothing_to_cancel: 409, no_subscription: 409,
    change_in_progress: 409, not_configured: 500, paystack_error: 502, bad_request: 400,
  });
  assertEquals(errorBody("owner_only"), { error: "owner_only" });
  assertEquals(errorBody("change_in_progress"), { error: "change_in_progress" });
});

Deno.test("only cancel and card_link are accepted", () => {
  assertEquals(parseAction({ action: "cancel" }), "cancel");
  assertEquals(parseAction({ action: "card_link" }), "card_link");
  assertEquals(parseAction({ action: "refund" }), null);
  assertEquals(parseAction({ action: "CANCEL" }), null);
  assertEquals(parseAction({}), null);
  assertEquals(parseAction(null), null);
});

// ---------------------------------------------------------------- who
Deno.test("only the owner: staff of any role are refused", () => {
  assertEquals(pickAccountRole([{ account_id: "a1", role: "owner" }]), { accountId: "a1", isOwner: true });
  for (const role of ["manager", "sales", "kitchen", "accountant"]) {
    assertEquals(pickAccountRole([{ account_id: "a1", role }]), { accountId: "a1", isOwner: false }, role);
  }
  assertEquals(pickAccountRole([]), { error: "no_account" });
  assertEquals(pickAccountRole([{ account_id: "a1", role: "owner" }, { account_id: "a2", role: "owner" }]),
    { error: "ambiguous_account" });
});

Deno.test("the account is chosen exactly as paystack-checkout chooses it", () => {
  const fixtures: unknown[] = [
    [], null, [{}], [{ account_id: "a1", role: "owner" }],
    [{ account_id: "a1", role: "sales" }],
    [{ account_id: "a1", role: "kitchen" }, { account_id: "a1", role: "owner" }],
    [{ account_id: "a1", role: "owner" }, { account_id: "a2", role: "manager" }],
    [{ account_id: "a2", role: "owner" }, { account_id: "a2", role: "owner" }],
  ];
  for (const f of fixtures) assertEquals(pickAccountRole(f), checkoutPick(f), JSON.stringify(f));
});

// ---------------------------------------------------------------- what
Deno.test("cancel: a paying plan can be cancelled, past_due included", () => {
  assertEquals(manageRefusal("cancel", sub(), NOW), null);
  assertEquals(manageRefusal("cancel", sub({ status: "past_due" }), NOW), null);
});

Deno.test("cancel: a trial or a plan already stopped has nothing to cancel", () => {
  assertEquals(manageRefusal("cancel", sub({ status: "trialing", provider_subscription_code: null }), NOW),
    "nothing_to_cancel");
  assertEquals(manageRefusal("cancel", sub({ status: "cancelled", cancel_at_period_end: true }), NOW),
    "nothing_to_cancel");
  assertEquals(manageRefusal("cancel", sub({ status: "cancelled", current_period_end: "2026-09-01T00:00:00Z" }), NOW),
    "nothing_to_cancel");
  assertEquals(manageRefusal("cancel", sub({ cancel_at_period_end: true }), NOW), "nothing_to_cancel");
});

Deno.test("cancel: a paying plan with no Paystack code on file is no_subscription", () => {
  assertEquals(manageRefusal("cancel", sub({ provider_subscription_code: null }), NOW), "no_subscription");
  assertEquals(manageRefusal("cancel", sub({ provider_subscription_code: "SUB_../x" }), NOW), "no_subscription");
  assertEquals(manageRefusal("cancel", null, NOW), "no_subscription");
});

Deno.test("card_link: needs a live Paystack subscription on file", () => {
  assertEquals(manageRefusal("card_link", sub(), NOW), null);
  assertEquals(manageRefusal("card_link", sub({ status: "past_due" }), NOW), null, "the overdue case it exists for");
  assertEquals(manageRefusal("card_link", sub({ status: "cancelled", cancel_at_period_end: true }), NOW), null,
    "still inside the paid period");
  assertEquals(manageRefusal("card_link", sub({ status: "cancelled", current_period_end: "2026-10-01T00:00:00Z" }), NOW),
    "no_subscription");
  assertEquals(manageRefusal("card_link", sub({ status: "trialing" }), NOW), "no_subscription");
  assertEquals(manageRefusal("card_link", sub({ provider_subscription_code: null }), NOW), "no_subscription");
});

Deno.test("the subscriptions row is read from PostgREST's shape", () => {
  assertEquals(readSubState([{ status: "active", current_period_end: "2026-11-18T09:30:00+00:00",
                               cancel_at_period_end: false, provider_subscription_code: "SUB_cur" }]),
    { status: "active", current_period_end: "2026-11-18T09:30:00+00:00",
      cancel_at_period_end: false, provider_subscription_code: "SUB_cur" });
  assertEquals(readSubState([]), null);
});

Deno.test("ends_on is the paid period end as a Lagos date", () => {
  assertEquals(endsOn("2026-11-18T09:30:00Z"), "2026-11-18");
  assertEquals(endsOn("2026-11-18T23:30:00Z"), "2026-11-19", "23:30 UTC is 00:30 the next day in Lagos");
  assertEquals(endsOn("2026-11-18T22:59:59Z"), "2026-11-18");
  assertEquals(endsOn(null), null);
  assertEquals(endsOn("not a date"), null);
});

Deno.test("X3: while a plan change is finishing, cancel and card_link are change_in_progress", () => {
  assertEquals(manageRefusal("cancel", sub(), NOW, true), "change_in_progress");
  assertEquals(manageRefusal("cancel", sub({ status: "past_due" }), NOW, true), "change_in_progress");
  assertEquals(manageRefusal("card_link", sub(), NOW, true), "change_in_progress");
  assertEquals(manageRefusal("card_link", sub({ status: "past_due" }), NOW, true), "change_in_progress");
  // nothing pending: as before
  assertEquals(manageRefusal("cancel", sub(), NOW, false), null);
  assertEquals(manageRefusal("card_link", sub(), NOW, false), null);
});

Deno.test("X3: the earlier, plainer refusals still come first", () => {
  assertEquals(manageRefusal("cancel", sub({ status: "trialing", provider_subscription_code: null }), NOW, true),
    "nothing_to_cancel");
  assertEquals(manageRefusal("cancel", sub({ cancel_at_period_end: true }), NOW, true), "nothing_to_cancel");
  assertEquals(manageRefusal("cancel", sub({ provider_subscription_code: null }), NOW, true), "no_subscription");
  assertEquals(manageRefusal("card_link", sub({ status: "trialing" }), NOW, true), "no_subscription");
  assertEquals(manageRefusal("cancel", null, NOW, true), "no_subscription");
});

Deno.test("X3: billing_superseded rows naming the code on file mean pending; only an empty list is clear", () => {
  assertEquals(changeInProgress([]), false);
  assertEquals(changeInProgress([{ id: "b1" }]), true);
  assertEquals(changeInProgress(null), true, "an unreadable answer is never taken as clear");
  assertEquals(changeInProgress({ message: "error" }), true);
});

Deno.test("X1: a cancel reply's ends_on is the Lagos period end for an active plan, null when overdue", () => {
  assertEquals(cancelEndsOn(sub(), NOW), "2026-11-18");
  assertEquals(cancelEndsOn(sub({ current_period_end: "2026-11-18T23:30:00Z" }), NOW), "2026-11-19");
  assertEquals(cancelEndsOn(sub({ status: "past_due", current_period_end: "2026-10-10T09:00:00Z" }), NOW), null,
    "overdue: the paid period is over, recording stops straight away");
  assertEquals(cancelEndsOn(sub({ status: "past_due", current_period_end: "2026-11-18T09:00:00Z" }), NOW), null,
    "overdue is null even with a period end still ahead");
  assertEquals(cancelEndsOn(sub({ current_period_end: "2026-10-01T00:00:00Z" }), NOW), null, "a period already past");
  assertEquals(cancelEndsOn(sub({ current_period_end: null }), NOW), null);
  assertEquals(cancelEndsOn(sub({ current_period_end: "nonsense" }), NOW), null);
});

// ---------------------------------------------------------------- Paystack, mocked
Deno.test("cancel: fetches the email token, then disables with code + token", async () => {
  const p = fakePaystack({
    "GET /subscription/SUB_cur": { status: 200, body: fetched("active") },
    "POST /subscription/disable": { status: 200, body: { status: true, message: "Subscription disabled successfully" } },
  });
  assertEquals(await stopRenewal("SUB_cur", p.call), { outcome: "sent" });
  assertEquals(p.seen.map((s) => `${s.method} ${s.path}`), ["GET /subscription/SUB_cur", "POST /subscription/disable"]);
  assertEquals(p.seen[1].body, { code: "SUB_cur", token: "tok_email" });
});

Deno.test("cancel: already non-renewing at Paystack is reported, not disabled twice", async () => {
  const p = fakePaystack({ "GET /subscription/SUB_cur": { status: 200, body: fetched("non-renewing") } });
  assertEquals(await stopRenewal("SUB_cur", p.call), { outcome: "already_off" });
  assertEquals(p.seen.length, 1);
});

Deno.test("cancel: Paystack refusing is a failure with a reason, and never leaks the card code", async () => {
  const bad = [
    fakePaystack({ "GET /subscription/SUB_cur": { status: 401, body: { status: false, message: "Invalid key" } } }),
    fakePaystack({ "GET /subscription/SUB_cur": { status: 200, body: fetched("active", null) } }),
    fakePaystack({
      "GET /subscription/SUB_cur": { status: 200, body: fetched("active") },
      "POST /subscription/disable": { status: 400, body: { status: false, message: "Invalid token" } },
    }),
  ];
  for (const p of bad) {
    const r = await stopRenewal("SUB_cur", p.call);
    assertEquals(r.outcome, "failed");
    assertFalse(JSON.stringify(r).includes("AUTH_must_not_leak"));
  }
  const boom: PaystackCall = () => Promise.reject(new Error("timeout"));
  assertEquals((await stopRenewal("SUB_cur", boom)).outcome, "failed");
});

Deno.test("a malformed code never reaches Paystack", async () => {
  const p = fakePaystack({});
  assertEquals((await stopRenewal("SUB_x/../../transaction", p.call)).outcome, "failed");
  assertEquals((await cardLink("SUB_x?y=1", p.call)).outcome, "failed");
  assertEquals(p.seen.length, 0);
});

Deno.test("card_link: returns Paystack's https link", async () => {
  const link = "https://paystack.com/manage/subscriptions/qlgwhpyq1ts9nsw?subscription_token=uqzbbgg";
  const p = fakePaystack({
    "GET /subscription/SUB_cur/manage/link": { status: 200, body: { status: true, message: "Link generated", data: { link } } },
  });
  assertEquals(await cardLink("SUB_cur", p.call), { outcome: "link_issued", link });
});

Deno.test("card_link: a missing or foreign link is refused, not handed to the browser", async () => {
  for (const data of [{}, { link: "" }, { link: "http://paystack.com/x" }, { link: "https://evil.test/x" },
                      { link: "https://paystack.com.evil.test/x" }, { link: "javascript:alert(1)" }]) {
    const p = fakePaystack({ "GET /subscription/SUB_cur/manage/link": { status: 200, body: { status: true, data } } });
    assertEquals((await cardLink("SUB_cur", p.call)).outcome, "failed", JSON.stringify(data));
  }
  const p = fakePaystack({ "GET /subscription/SUB_cur/manage/link": { status: 404, body: { status: false, message: "Subscription not found" } } });
  assertEquals((await cardLink("SUB_cur", p.call)).outcome, "failed");
});

Deno.test("safeManageLink accepts Paystack's own https hosts only", () => {
  assert(safeManageLink("https://paystack.com/manage/subscriptions/x?subscription_token=y"));
  assert(safeManageLink("https://checkout.paystack.com/abc"));
  assert(safeManageLink("https://paystack.co/manage/x"));
  assertEquals(safeManageLink("https://user:pw@paystack.com/x"), null);
  assertEquals(safeManageLink("https://notpaystack.com/x"), null);
  assertEquals(safeManageLink(42), null);
});

Deno.test("paystackCaller sends the secret key as a bearer token to api.paystack.co", async () => {
  let url = "";
  let auth = "";
  const fakeFetch = ((u: string | URL | Request, init?: RequestInit) => {
    url = String(u);
    auth = new Headers(init?.headers).get("Authorization") ?? "";
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  await paystackCaller("sk_test_fixture", fakeFetch)("/subscription/SUB_x/manage/link", { method: "GET" });
  assertEquals(url, "https://api.paystack.co/subscription/SUB_x/manage/link");
  assertEquals(auth, "Bearer sk_test_fixture");
});
