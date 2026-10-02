// ============================================================================
// MENU MASTER NG -- trial reminder mailer
//
// Emails owners whose free trial ends in 3 days, ends tomorrow, or has just
// ended (0058), each at most once per account. Called hourly on a schedule
// (deploy/runbook/DEPLOY_0058.md); safe to call any number of times -- a run
// with nothing owed sends nothing.
//
// WHO MAY CALL IT
//   Deployed with --no-verify-jwt because the caller is a scheduler, not a
//   user. It refuses any request without the shared MAILER_TOKEN header, the
//   same token the platform alert mailer uses.
//
// SECRETS: read from the Edge Function secret store at runtime. Never logged,
// never returned.
//   RESEND_API_KEY    MAILER_TOKEN
//   TRIAL_EMAIL_FROM  e.g. "Menu Master NG <hello@menumasterng.com>", on a
//                     domain verified in Resend
//   SITE_URL          https://menumasterng.com (the link to the plans)
//   SUPPORT_EMAIL     optional: where replies go
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   provided by the platform
//   RESEND_API_URL    LOCAL REHEARSAL ONLY (web/e2e/rehearse-trial-mailer.mjs):
//                     a stand-in for Resend on this machine. Never set it in
//                     production; unset, the real Resend is used.
// ============================================================================

import { safeError, tokenMatches } from "../platform-alert-mailer/lib.ts";
import { type Due, idempotencyKey, priceLine, reminderEmail, resendBody, toSend } from "./lib.ts";

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const RESEND = Deno.env.get("RESEND_API_URL") ?? "https://api.resend.com/emails";

const service = () => ({
  apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
});

const rpc = (base: string, fn: string, args: unknown) =>
  fetch(`${base}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: { ...service(), "Content-Type": "application/json" }, body: JSON.stringify(args),
  });

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json(safeError("method_not_allowed"), 405);
  if (!tokenMatches(req.headers.get("x-mailer-token"), Deno.env.get("MAILER_TOKEN"))) {
    return json(safeError("unauthorised"), 401);
  }
  const key = Deno.env.get("RESEND_API_KEY"), from = Deno.env.get("TRIAL_EMAIL_FROM"),
    site = Deno.env.get("SITE_URL"), replyTo = Deno.env.get("SUPPORT_EMAIL") ?? undefined;
  if (!key || !from || !site) {
    console.error("trial-reminder-mailer: not configured");
    return json(safeError("misconfigured"), 500);
  }
  const base = Deno.env.get("SUPABASE_URL")!;

  const dueRes = await rpc(base, "fn_trial_reminders_due", {});
  if (!dueRes.ok) {
    console.error(`trial-reminder-mailer: due list failed with ${dueRes.status}`);
    return json(safeError("read_failed"), 502);
  }
  const rows = toSend((await dueRes.json()) as Due[]);
  if (rows.length === 0) return json({ sent: 0 }, 200);

  // The price line, by the same rule /subscribe sells by. Without it the
  // email still goes, just without a price.
  let price: string | null = null;
  try {
    const [plans, slots] = await Promise.all([
      fetch(`${base}/rest/v1/plans?select=price_tier,price_kobo&is_active=eq.true`, { headers: service() }),
      fetch(`${base}/rest/v1/founder_slots?select=seq&account_id=is.null`, {
        headers: { ...service(), Prefer: "count=exact", Range: "0-0" },
      }),
    ]);
    const left = Number((slots.headers.get("content-range") ?? "*/0").split("/")[1]) || 0;
    if (plans.ok) price = priceLine(await plans.json(), left);
  } catch {
    price = null;
  }

  let sent = 0, failed = 0;
  for (const d of rows) {
    const mail = reminderEmail(d, site, price);
    const res = await fetch(RESEND, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        "Idempotency-Key": idempotencyKey(d),
      },
      body: JSON.stringify(resendBody(from, d.owner_email!, mail, replyTo)),
    });
    if (!res.ok) {
      // Not recorded, so the next run tries again. The provider's reason is
      // logged (never the key, never the address).
      const why = await res.text().catch(() => "");
      console.error(`trial-reminder-mailer: resend HTTP ${res.status} for ${d.kind}: ${why.slice(0, 200)}`);
      failed++;
      continue;
    }
    const rec = await rpc(base, "fn_record_trial_reminder", {
      p_account_id: d.account_id, p_kind: d.kind, p_sent_to: d.owner_email,
    });
    if (!rec.ok) console.error(`trial-reminder-mailer: record failed with ${rec.status} for ${d.kind}`);
    sent++;
    // Resend's default limit is two requests a second.
    await new Promise((r) => setTimeout(r, 600));
  }

  return json({ due: rows.length, sent, failed }, 200);
});
