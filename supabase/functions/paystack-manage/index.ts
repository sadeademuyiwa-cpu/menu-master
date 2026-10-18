// ============================================================================
// MENU MASTER NG -- paystack-manage: the owner's Cancel plan and Update card
//
// Owner decision D6 (18 Oct 2026). Called by web/src/app/api/billing with the
// signed-in user's own token. Deployed WITH JWT verification (no
// --no-verify-jwt), like paystack-checkout.
//
//   POST {"action":"cancel"}
//     -> 200 {"ok":true,"action":"cancel","ends_on":"YYYY-MM-DD"|null}
//        Renewal is switched off at Paystack. The plan stays on until ends_on
//        (the end of the period already paid, as a Lagos date); after that the
//        account is read-only. There is no undo: they choose a plan again.
//        An overdue (past_due) account may cancel too (X1): it has no paid
//        days left, so ends_on is null and recording stops straight away.
//   POST {"action":"card_link"}
//     -> 200 {"ok":true,"action":"card_link","link":"https://...paystack..."}
//
//   Errors are {"error":"<code>"}: unauthorised 401, owner_only 403,
//   nothing_to_cancel 409, no_subscription 409, change_in_progress 409 (a
//   plan change is still finishing: the subscription on file is the one
//   being replaced; X3), not_configured 500, paystack_error 502,
//   bad_request 400.
//
// WHAT THIS NEVER DOES
//   It never writes the subscription row. Paystack answers a disable with
//   subscription.not_renew now and subscription.disable at the period end;
//   paystack-webhook applies those, as for any other event. What this does
//   write is the request itself, to subscription_changes, through the
//   service-only fn_billing_record_manage_request (which checks the caller is
//   the owner again). The update-card link is never stored or logged.
//
// SECRETS: read from the Edge Function secret store at runtime.
//   PAYSTACK_SECRET_KEY
//   SUPABASE_URL                 provided by the platform
//   SUPABASE_SERVICE_ROLE_KEY    provided by the platform
// ============================================================================

import {
  type Action,
  cancelEndsOn,
  cardLink,
  changeInProgress,
  ERRORS,
  type ErrorCode,
  errorBody,
  isSubscriptionCode,
  manageRefusal,
  parseAction,
  paystackCaller,
  pickAccountRole,
  readSubState,
  stopRenewal,
} from "./lib.ts";

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const fail = (code: ErrorCode) => json(errorBody(code), ERRORS[code]);

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return fail("bad_request");

  const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
  const base = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret || !base || !service) {
    console.error("paystack-manage: not configured");
    return fail("not_configured");
  }
  const serviceHeaders = { apikey: service, Authorization: `Bearer ${service}` };

  // WHO IS ASKING. The platform has verified the JWT's signature; we still ask
  // Supabase whose it is rather than trust a claim in it.
  const who = await fetch(`${base}/auth/v1/user`, {
    headers: { Authorization: req.headers.get("Authorization") ?? "", apikey: service },
  }).catch(() => null);
  if (!who?.ok) return fail("unauthorised");
  const user = await who.json().catch(() => null);
  if (!user?.id) return fail("unauthorised");

  const action: Action | null = parseAction(await req.json().catch(() => ({})));
  if (!action) return fail("bad_request");

  // WHICH ACCOUNT, and is the caller its owner. Read with the service role
  // from memberships, never from the request, by the same rule as
  // paystack-checkout. No account, or a login on two accounts, is refused.
  const memRes = await fetch(
    `${base}/rest/v1/memberships?user_id=eq.${user.id}&select=account_id,role`,
    { headers: serviceHeaders },
  ).catch(() => null);
  const picked = pickAccountRole(memRes?.ok ? await memRes.json() : []);
  if ("error" in picked || !picked.isOwner) return fail("owner_only");
  const accountId = picked.accountId;

  const subRes = await fetch(
    `${base}/rest/v1/subscriptions?account_id=eq.${accountId}` +
      `&select=status,current_period_end,cancel_at_period_end,provider_subscription_code`,
    { headers: serviceHeaders },
  ).catch(() => null);
  if (!subRes?.ok) {
    console.error(`paystack-manage: subscription read failed with ${subRes?.status ?? "no response"}`);
    return fail("paystack_error");
  }
  const sub = readSubState(await subRes.json().catch(() => null));
  const now = new Date();
  const refusal = manageRefusal(action, sub, now);
  if (refusal) return fail(refusal);
  const code = sub!.provider_subscription_code!;

  // X3: IS A PLAN CHANGE STILL FINISHING? Between the new plan's payment and
  // its subscription.create, the code on file is the OLD subscription, which
  // is waiting in billing_superseded to be switched off. Cancelling it, or
  // putting a card on it, then would act on the plan being left. service_role
  // may read billing_superseded; a failed read refuses rather than guesses.
  if (isSubscriptionCode(code)) {
    const supRes = await fetch(
      `${base}/rest/v1/billing_superseded?subscription_code=eq.${encodeURIComponent(code)}` +
        `&disabled_at=is.null&select=id`,
      { headers: serviceHeaders },
    ).catch(() => null);
    if (!supRes?.ok) {
      console.error(`paystack-manage: replaced-subscription read failed with ${supRes?.status ?? "no response"}`);
      return fail("paystack_error");
    }
    const pending = changeInProgress(await supRes.json().catch(() => null));
    const again = manageRefusal(action, sub, now, pending);
    if (again) return fail(again);
  }

  const paystack = paystackCaller(secret);

  // The record of the request. A failure to record never undoes what Paystack
  // already did; it is logged so the history gap can be found.
  const record = async (outcome: string) => {
    try {
      const res = await fetch(`${base}/rest/v1/rpc/fn_billing_record_manage_request`, {
        method: "POST",
        headers: { ...serviceHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          p_account_id: accountId, p_user_id: user.id, p_action: action,
          p_outcome: outcome, p_subscription_code: code,
        }),
      });
      if (!res.ok) console.error(`paystack-manage: request not recorded (${res.status})`);
    } catch (e) {
      console.error("paystack-manage: request not recorded", String(e));
    }
  };

  if (action === "cancel") {
    const r = await stopRenewal(code, paystack);
    if (r.outcome === "failed") {
      console.error(`paystack-manage: cancel failed: ${r.detail}`);
      await record("failed");
      return fail("paystack_error");
    }
    await record(r.outcome);
    return json({ ok: true, action: "cancel", ends_on: cancelEndsOn(sub!, now) }, 200);
  }

  const r = await cardLink(code, paystack);
  if (r.outcome === "failed") {
    console.error(`paystack-manage: card link failed: ${r.detail}`);
    await record("failed");
    return fail("paystack_error");
  }
  await record("link_issued");
  return json({ ok: true, action: "card_link", link: r.link }, 200);
});
