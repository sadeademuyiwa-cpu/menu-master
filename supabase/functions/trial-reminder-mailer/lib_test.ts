// ============================================================================
// Unit tests for the pure trial reminder logic. No server, no network, no secret.
//   deno test supabase/functions/trial-reminder-mailer/lib_test.ts
// ============================================================================
import {
  type Due, idempotencyKey, lagosDate, priceLine, reminderEmail, resendBody, sendable, toSend,
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
