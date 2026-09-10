// ============================================================================
// Unit tests for the pure mailer logic. No server, no network, no secret.
//   deno test supabase/functions/platform-alert-mailer/lib_test.ts
// ============================================================================
import { digest, kindWords, resendBody, tokenMatches, toNotify, type Alert } from "./lib.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}
function assertEquals(a: unknown, b: unknown, msg = "") {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${msg}\n  got      ${x}\n  expected ${y}`);
}

const row = (over: Partial<Alert>): Alert => ({
  id: crypto.randomUUID(), kind: "billing_stuck", severity: "warn", subject: "evt",
  summary: "A billing event has been received for too long (0 attempt(s)).",
  detail: { event_id: "evt", attempts: 0 }, first_seen: "2026-09-10T10:00:00Z",
  last_seen: "2026-09-10T11:00:00Z", resolved_at: null, notified_at: null, ...over,
});

Deno.test("only open, un-notified rows are sent, critical first then oldest", () => {
  const rows = [
    row({ id: "a", severity: "warn", first_seen: "2026-09-10T10:00:00Z" }),
    row({ id: "b", severity: "critical", first_seen: "2026-09-10T12:00:00Z" }),
    row({ id: "c", severity: "critical", first_seen: "2026-09-10T09:00:00Z" }),
    row({ id: "d", notified_at: "2026-09-10T08:00:00Z" }),
    row({ id: "e", resolved_at: "2026-09-10T08:00:00Z" }),
  ];
  assertEquals(toNotify(rows).map((r) => r.id), ["c", "b", "a"]);
});

Deno.test("the token must match exactly and be long enough to mean anything", () => {
  assert(tokenMatches("0123456789abcdef0123", "0123456789abcdef0123"), "exact match");
  assert(!tokenMatches("0123456789abcdef0124", "0123456789abcdef0123"), "one char off");
  assert(!tokenMatches("0123456789abcdef012", "0123456789abcdef0123"), "length off");
  assert(!tokenMatches(null, "0123456789abcdef0123"), "absent");
  assert(!tokenMatches("short", "short"), "a short secret is refused even when it matches");
  assert(!tokenMatches("x", undefined), "unconfigured");
});

Deno.test("the digest names each alert in words, with its facts, and nothing else", () => {
  const rows = [
    row({ kind: "billing_failed_permanent", severity: "critical", summary: "A billing event will never apply: unmapped_plan_code (charge.success).",
      detail: { event_id: "e1", error_code: "unmapped_plan_code", nested: { marker: "NESTED_MARKER_NOT_SENT" } } }),
    row({ kind: "founder_slots_low", summary: "9 founding slot(s) left.", detail: { free: 9 } }),
  ];
  const m = digest(rows, "https://menumasterng.com/admin/alerts", new Date("2026-09-10T12:00:00Z"));
  assertEquals(m.subject, "[Menu Master] 1 critical, 2 open alerts");
  assert(m.text.includes("CRITICAL  Billing event failed permanently"), "critical line");
  assert(m.text.includes("error_code=unmapped_plan_code"), "flat facts are included");
  assert(!m.text.includes("NESTED_MARKER_NOT_SENT"), "nested detail is not flattened into the email");
  assert(m.text.includes("WARN  Founding slots running low"), "warn line");
  assert(m.text.includes("free=9"), "fact");
  assert(m.text.includes("https://menumasterng.com/admin/alerts"), "link to resolve");
});

Deno.test("a single non-critical alert reads naturally", () => {
  const m = digest([row({})], "u");
  assertEquals(m.subject, "[Menu Master] 1 open alert");
});

Deno.test("unknown kinds still read as words", () => {
  assertEquals(kindWords("something_new"), "something new");
});

Deno.test("the Resend body carries exactly from, to, subject, text", () => {
  const b = resendBody("alerts@menumasterng.com", "owner@example.com", { subject: "s", text: "t" });
  assertEquals(Object.keys(b).sort(), ["from", "subject", "text", "to"]);
  assertEquals(b.to, ["owner@example.com"]);
});
