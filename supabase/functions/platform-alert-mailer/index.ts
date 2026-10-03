// ============================================================================
// MENU MASTER NG -- platform alert mailer
//
// Sends one digest email for the open platform_alerts nobody has been told
// about, then stamps notified_at on them. Called on a schedule (see
// deploy/runbook/DEPLOY_0053_0055.md); safe to call any number of times --
// a run with nothing new sends nothing.
//
// WHY AN EDGE FUNCTION
//   It needs the mail provider's API key. That key lives in exactly one place
//   -- the Edge Function secret store, beside the Paystack key -- never in
//   Vercel, never in the repository.
//
// WHO MAY CALL IT
//   Deployed with --no-verify-jwt because the caller is a scheduler, not a
//   user. It refuses any request without the shared MAILER_TOKEN header.
//
// SECRETS: read from the Edge Function secret store at runtime. Never logged,
// never returned.
//   RESEND_API_KEY   ALERT_EMAIL_TO   ALERT_EMAIL_FROM   MAILER_TOKEN
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   provided by the platform
//   SITE_URL         where the admin page lives (link in the email)
// ============================================================================

import { digest, resendBody, safeError, tokenMatches, toNotify, type Alert } from "./lib.ts";

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const service = () => ({
  apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
});

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json(safeError("method_not_allowed"), 405);
  if (!tokenMatches(req.headers.get("x-mailer-token"), Deno.env.get("MAILER_TOKEN"))) {
    return json(safeError("unauthorised"), 401);
  }
  const key = Deno.env.get("RESEND_API_KEY"), to = Deno.env.get("ALERT_EMAIL_TO"),
    from = Deno.env.get("ALERT_EMAIL_FROM"), site = Deno.env.get("SITE_URL") ?? "";
  if (!key || !to || !from) {
    console.error("platform-alert-mailer: not configured");
    return json(safeError("misconfigured"), 500);
  }
  const base = Deno.env.get("SUPABASE_URL")!;

  // The scan first, so the digest reflects the present; it is idempotent.
  const scan = await fetch(`${base}/rest/v1/rpc/fn_admin_scan`, {
    method: "POST", headers: { ...service(), "Content-Type": "application/json" }, body: "{}",
  });
  if (!scan.ok) {
    console.error(`platform-alert-mailer: scan failed with ${scan.status}`);
    return json(safeError("scan_failed"), 502);
  }

  // Open, un-notified rows. platform_alerts has no client policy; the service
  // role reads it directly.
  const res = await fetch(
    `${base}/rest/v1/platform_alerts?resolved_at=is.null&notified_at=is.null&select=*`,
    { headers: service() },
  );
  if (!res.ok) {
    console.error(`platform-alert-mailer: read failed with ${res.status}`);
    return json(safeError("read_failed"), 502);
  }
  const rows = toNotify((await res.json()) as Alert[]);
  if (rows.length === 0) return json({ sent: 0 }, 200);

  const mail = digest(rows, `${site}/admin/alerts`);
  const send = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(resendBody(from, to, mail)),
  });
  if (!send.ok) {
    // The provider's message says why (domain not verified, bad key). Logged,
    // never returned, and it never contains the key.
    const why = await send.text().catch(() => "");
    console.error(`platform-alert-mailer: resend HTTP ${send.status}: ${why.slice(0, 200)}`);
    return json(safeError("provider_unavailable"), 502);
  }

  // Stamp only what was sent. A failure here means a duplicate email next
  // run, which is the right way round: better told twice than never.
  const ids = rows.map((r) => r.id).join(",");
  const stamp = await fetch(
    `${base}/rest/v1/platform_alerts?id=in.(${ids})`,
    {
      method: "PATCH",
      headers: { ...service(), "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ notified_at: new Date().toISOString() }),
    },
  );
  if (!stamp.ok) console.error(`platform-alert-mailer: stamp failed with ${stamp.status}`);

  return json({ sent: rows.length, critical: rows.filter((r) => r.severity === "critical").length }, 200);
});
