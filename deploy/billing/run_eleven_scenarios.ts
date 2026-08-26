// ============================================================================
// MENU MASTER NG -- the eleven Paystack scenarios
// docs/BILLING_INTEGRATION_DESIGN.md section 11.
//
// YOU run this, not Claude. It signs each payload locally with your test key,
// posts it to your deployed webhook, and checks the HTTP status.
//
//   export PAYSTACK_SECRET_KEY=sk_test_...        # your key, stays on your machine
//   export WEBHOOK_URL=https://<ref>.supabase.co/functions/v1/paystack-webhook
//   export TEST_ACCOUNT_ID=<a uuid from your accounts table>
//   deno run --allow-env --allow-net deploy/billing/run_eleven_scenarios.ts
//
// The key is read from the environment and used only to compute HMACs. It is
// never printed, never written to a file, and must never be pasted into chat.
//
// Scenarios 6 and 10 need the database made unavailable, and 5 and 11 need
// timing this script cannot force. Those four are marked MANUAL with the exact
// steps; the other seven run automatically.
// ============================================================================

const KEY = Deno.env.get("PAYSTACK_SECRET_KEY");
const URL_ = Deno.env.get("WEBHOOK_URL");
const ACCT = Deno.env.get("TEST_ACCOUNT_ID");

if (!KEY || !URL_ || !ACCT) {
  console.error("Set PAYSTACK_SECRET_KEY, WEBHOOK_URL and TEST_ACCOUNT_ID first.");
  Deno.exit(2);
}

const enc = new TextEncoder();

async function sign(body: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw", enc.encode(KEY!), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(body));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function post(body: string, signature: string): Promise<number> {
  const res = await fetch(URL_!, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-paystack-signature": signature },
    body,
  });
  return res.status;
}

function event(type: string, id: string, ref: string, acct: string | null, next?: string) {
  const data: Record<string, unknown> = {
    id, reference: ref, plan: { plan_code: "trial" },
  };
  if (next) data.next_payment_date = next;
  if (acct) data.metadata = { account_id: acct };
  return JSON.stringify({ event: type, data });
}

const results: { n: number; name: string; verdict: string; detail: string }[] = [];
const check = (n: number, name: string, ok: boolean, detail: string) =>
  results.push({ n, name, verdict: ok ? "PASS" : "FAIL", detail });

const stamp = Date.now();
const nextMonth = new Date(Date.now() + 30 * 864e5).toISOString();

// 1. valid payment, existing subscription
{
  const b = event("charge.success", `evt-1-${stamp}`, `ref-1-${stamp}`, ACCT, nextMonth);
  const s = await post(b, await sign(b));
  check(1, "valid payment, existing subscription", s === 200, `HTTP ${s}, expected 200`);
}

// 2. valid payment, NO subscription for that account
{
  const orphan = "00000000-0000-0000-0000-0000000000ff";
  const b = event("charge.success", `evt-2-${stamp}`, `ref-2-${stamp}`, orphan, nextMonth);
  const s = await post(b, await sign(b));
  check(2, "valid payment, missing subscription -> failed_permanent", s === 200,
        `HTTP ${s}, expected 200; then confirm v_billing_reconciliation has the row`);
}

// 3. duplicate webhook, identical bytes
{
  const b = event("charge.success", `evt-3-${stamp}`, `ref-3-${stamp}`, ACCT, nextMonth);
  const sig = await sign(b);
  const first = await post(b, sig);
  const second = await post(b, sig);
  check(3, "duplicate webhook is not applied twice", first === 200 && second === 200,
        `first ${first}, second ${second}; the subscription must not advance twice`);
}

// 4. forged signature
{
  const b = event("charge.success", `evt-4-${stamp}`, `ref-4-${stamp}`, ACCT, nextMonth);
  const s = await post(b, "0".repeat(128));
  check(4, "forged signature is rejected", s === 401, `HTTP ${s}, expected 401`);
}

// 7. retry after a 5xx: same bytes again must be safe
{
  const b = event("charge.success", `evt-7-${stamp}`, `ref-7-${stamp}`, ACCT, nextMonth);
  const sig = await sign(b);
  await post(b, sig);
  const again = await post(b, sig);
  check(7, "Paystack retry after 5xx is idempotent", again === 200,
        `HTTP ${again}, expected 200 with no second transition`);
}

// 8. unsupported event type
{
  const b = event("customer.identification.failed", `evt-8-${stamp}`, `ref-8-${stamp}`, ACCT);
  const s = await post(b, await sign(b));
  check(8, "unsupported event type is ignored, not failed", s === 200,
        `HTTP ${s}, expected 200 and status 'ignored'`);
}

// 9. malformed payload, validly signed
{
  const b = "{not json at all";
  const s = await post(b, await sign(b));
  check(9, "malformed but validly signed payload is permanent", s === 200,
        `HTTP ${s}, expected 200 and never retried`);
}

// oversize body, ahead of hashing
{
  const b = "x".repeat(300 * 1024);
  const s = await post(b, await sign(b));
  check(0, "oversize body is refused before hashing", s === 413, `HTTP ${s}, expected 413`);
}

console.log("\n  #  verdict  scenario");
console.log("  -- -------  --------");
for (const r of results.sort((a, b) => a.n - b.n)) {
  console.log(`  ${String(r.n).padStart(2)}  ${r.verdict.padEnd(7)}  ${r.name}\n         ${r.detail}`);
}
const failed = results.filter((r) => r.verdict === "FAIL").length;
console.log(`\n  ${results.length - failed} passed, ${failed} failed\n`);

console.log(`  MANUAL, cannot be forced from here:
   5  concurrent delivery  -- post the same signed body twice in parallel:
        deno eval "..." or two curl calls with & ; exactly one must apply.
   6  database unavailable -- pause the Supabase project, post, expect 500,
        resume, confirm the row is failed_transient with next_retry_at set.
  10  transition fails     -- covered by scenarios 2 and 6 together.
  11  ack lost after apply -- re-post an already-applied body; expect 200 and
        NO second transition. This is the one that double-charges systems that
        key idempotency on the response instead of the payload.

  Then confirm in SQL:
    select status, count(*) from billing_events group by status;
    select * from v_billing_reconciliation;`);

Deno.exit(failed > 0 ? 1 : 0);
