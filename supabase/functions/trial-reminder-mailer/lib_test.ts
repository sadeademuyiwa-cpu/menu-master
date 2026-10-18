// ============================================================================
// Unit tests for the pure trial reminder logic. No server, no network, no secret.
//   deno test supabase/functions/trial-reminder-mailer/lib_test.ts
// ============================================================================
import {
  type Due, FOOTER, idempotencyKey, lagosDate, placesLeft, priceLine, reminderEmail, resendBody, sendable, toSend,
} from "./lib.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}
function assertEquals(a: unknown, b: unknown, msg = "") {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg}\n  got      ${x}\n  expected ${y}`);
}

const due = (over: Partial<Due>): Due => ({
  account_id: "11111111-1111-4111-8111-111111111111", kind: "ends_in_3_days",
  owner_email: "owner@example.ng", business_name: "Ada's Kitchen",
  trial_ends_at: "2026-10-05T10:00:00Z", ...over,
});

Deno.test("each moment has its own subject", () => {
  assertEquals(reminderEmail(due({ kind: "ends_in_3_days" }), "https://m.ng", null).subject,
    "Your Menu Master free trial ends in 3 days");
  assertEquals(reminderEmail(due({ kind: "ends_tomorrow" }), "https://m.ng", null).subject,
    "Your Menu Master free trial ends tomorrow");
  assert(reminderEmail(due({ kind: "ended" }), "https://m.ng", null).subject.includes("your records are safe"),
    "ended says nothing was lost");
});

Deno.test("the email links to the plans and names the date in Lagos time", () => {
  const m = reminderEmail(due({ trial_ends_at: "2026-10-04T23:30:00Z" }), "https://menumasterng.com/", null);
  assert(m.text.includes("https://menumasterng.com/subscribe"), "plans link");
  // 23:30 UTC is 00:30 the next day in Lagos
  assert(m.text.includes("5 October"), `Lagos date, got: ${m.text}`);
  assertEquals(lagosDate("2026-10-04T23:30:00Z").includes("5 October"), true);
});

Deno.test("an ended trial says nothing was deleted", () => {
  const m = reminderEmail(due({ kind: "ended" }), "https://m.ng", null);
  assert(m.text.includes("Nothing has been deleted"), "reassures");
  assert(m.text.includes("Choose a plan"), "says what to do");
});

Deno.test("the business name is escaped in the HTML part", () => {
  const m = reminderEmail(due({ business_name: '<img src=x onerror="alert(1)">' }), "https://m.ng", null);
  assert(!m.html.includes("<img"), "no raw tag");
  assert(m.html.includes("&lt;img"), "escaped");
});

Deno.test("no name falls back to words, not 'null'", () => {
  const m = reminderEmail(due({ business_name: null }), "https://m.ng", null);
  assert(m.text.includes("your business") && !m.text.includes("null"), m.text);
});

Deno.test("the price follows the founding rule /subscribe uses", () => {
  const plans = [
    { price_tier: "trial", price_kobo: 0 },
    { price_tier: "founding", price_kobo: 350000 }, { price_tier: "founding", price_kobo: 750000 },
    { price_tier: "standard", price_kobo: 750000 }, { price_tier: "standard", price_kobo: 1500000 },
  ];
  assert((priceLine(plans, 12) ?? "").includes("₦3,500"), "founding while places last");
  assertEquals(priceLine(plans, 0), "Plans start at ₦7,500 a month.");
  assertEquals(priceLine([], 5), null);
});

Deno.test("only plain addresses are sent to", () => {
  assert(sendable("a@b.ng"), "plain");
  for (const bad of ["", null, "a@b", "a b@c.ng", "a@b.ng, c@d.ng", "x<y@z.ng>", "a@b.ng\nBcc: c@d.ng"]) {
    assert(!sendable(bad as string), `refused: ${JSON.stringify(bad)}`);
  }
  assertEquals(toSend([due({ owner_email: null }), due({ owner_email: "ok@b.ng" }),
    due({ kind: "other" as never })]).length, 1);
});

Deno.test("a run never sends more than the cap", () => {
  assertEquals(toSend(Array.from({ length: 80 }, () => due({})), 50).length, 50);
});

Deno.test("one idempotency key per account and kind", () => {
  assertEquals(idempotencyKey(due({})), "trial-11111111-1111-4111-8111-111111111111-ends_in_3_days");
});

Deno.test("reply-to only when it is a plain address", () => {
  const m = reminderEmail(due({}), "https://m.ng", null);
  assertEquals("reply_to" in resendBody("f@m.ng", "o@b.ng", m, "help@m.ng"), true);
  assertEquals("reply_to" in resendBody("f@m.ng", "o@b.ng", m, "not an email"), false);
});

// ---------------------------------------------------------------------------
// EF2: the founding-place count. Unknown is not zero.
// ---------------------------------------------------------------------------
const PLANS = [
  { price_tier: "trial", price_kobo: 0 },
  { price_tier: "founding", price_kobo: 350000 }, { price_tier: "founding", price_kobo: 750000 },
  { price_tier: "standard", price_kobo: 750000 }, { price_tier: "standard", price_kobo: 1500000 },
];

Deno.test("placesLeft reads the total PostgREST reports", () => {
  assertEquals(placesLeft(true, "0-0/57"), 57);
  assertEquals(placesLeft(true, "*/0"), 0, "none left is a real 0");
  assertEquals(placesLeft(true, " 0-0/100 "), 100, "tolerates spaces");
});

Deno.test("placesLeft is null whenever the count is not known", () => {
  assertEquals(placesLeft(true, null), null, "header missing");
  assertEquals(placesLeft(true, undefined), null, "header missing");
  assertEquals(placesLeft(true, ""), null, "empty header");
  assertEquals(placesLeft(true, "0-0/*"), null, "total not counted");
  assertEquals(placesLeft(true, "*/*"), null, "total not counted");
  assertEquals(placesLeft(true, "0-0/5.5"), null, "not a whole number");
  assertEquals(placesLeft(true, "0-0/-3"), null, "not a count");
  assertEquals(placesLeft(true, "0-0/99999999999999999999"), null, "absurd total");
  assertEquals(placesLeft(true, "garbage"), null);
  assertEquals(placesLeft(false, "0-0/57"), null, "a failed read never counts, even with a header");
});

Deno.test("an unknown founding count leaves the price line out", () => {
  assertEquals(priceLine(PLANS, null), null);
  // plans read fine, the slot count came back 500: no price, never the standard one
  assertEquals(priceLine(PLANS, placesLeft(false, null)), null);
  const m = reminderEmail(due({}), "https://m.ng", priceLine(PLANS, placesLeft(false, null)));
  assert(!m.text.includes("₦") && !m.html.includes("₦"), `no naira in the email: ${m.text}`);
});

Deno.test("a known count still picks founding or standard wording", () => {
  assert((priceLine(PLANS, placesLeft(true, "0-0/57")) ?? "").startsWith("Founding prices start at ₦3,500"),
    "places left: founding");
  assertEquals(priceLine(PLANS, placesLeft(true, "*/0")), "Plans start at ₦7,500 a month.", "none left: standard");
});

Deno.test("the footer says the trial never charges, and that a plan can be cancelled", () => {
  for (const kind of ["ends_in_3_days", "ends_tomorrow", "ended"] as const) {
    const m = reminderEmail(due({ kind }), "https://m.ng", null);
    assert(m.text.endsWith(FOOTER), `${kind}: text ends with the footer`);
    assert(m.html.includes("The free trial never charges you."), `${kind}: html footer`);
    assert(m.text.includes("you can cancel at any time"), `${kind}: cancel sentence kept`);
  }
});
