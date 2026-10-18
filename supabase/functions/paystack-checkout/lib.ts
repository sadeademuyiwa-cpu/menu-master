// ============================================================================
// Pure checkout logic, extracted so it can be unit-tested without a server, a
// network or a real secret. index.ts imports from here; nothing is duplicated.
// ============================================================================

/** A parsed JSON body whose shape is checked field by field. */
// deno-lint-ignore no-explicit-any
type Loose = Record<string, any>;

export type Quote = {
  account_id: string;
  plan_id: string;
  plan_name: string;
  tier: string;
  price_tier: string;
  price_kobo: number;
  currency: string;
  provider_plan_code: string | null;
  founder_seq: number | null;
  slots_remaining: number;
};

/** The ONLY thing a client is allowed to choose. Everything else -- amount,
 *  price tier, founding eligibility, plan code -- is resolved server-side, so
 *  a hostile client posting {amount: 100, tier: 'founding'} gets the same
 *  quote as an honest one because neither field is read. */
export function parseTier(body: unknown): "costing" | "trading" | null {
  const t = (body as Record<string, unknown>)?.tier;
  return t === "costing" || t === "trading" ? t : null;
}

/** Paystack wants the amount in kobo, as a string, and the plan code when the
 *  charge should create a recurring subscription rather than a one-off. */
export function initializeBody(
  q: Quote,
  email: string,
  callbackUrl: string,
  replaces: string | null = null,
): Record<string, unknown> {
  // fn_billing_apply reads BOTH of these. account_id is how a webhook is
  // attributed to a customer at all; plan_id is the fallback when Paystack
  // sends no plan code of its own.
  const metadata: Record<string, string> = { account_id: q.account_id, plan_id: q.plan_id };
  // 0067: the subscription this payment replaces (a plan change). The webhook
  // switches it off once the new one is the one on file. Only ever the code
  // we hold for this account, never anything from the request.
  if (replaces) metadata.replaces = replaces;
  const body: Record<string, unknown> = {
    email,
    amount: String(q.price_kobo),
    currency: q.currency,
    callback_url: callbackUrl,
    metadata,
  };
  if (q.provider_plan_code) body.plan = q.provider_plan_code;
  return body;
}

/** A quote with no Paystack plan code cannot become a subscription -- it would
 *  charge once and never renew, which is not what was sold. Refuse before
 *  reaching Paystack rather than taking a payment we cannot honour. */
export function missingPlanCode(q: Quote): boolean {
  return !q.provider_plan_code;
}

/** Never let a provider error body reach the browser: it can echo request
 *  detail, and on some failures the key's own context. */
export function safeError(code: string): { error: string } {
  return { error: code };
}

/** Which account is this user checking out for?
 *
 *  A user can sit on more than one account -- staff added to a second
 *  business. Picking one arbitrarily means billing the wrong business, so this
 *  refuses instead of guessing, exactly as fn_checkout_quote refuses when no
 *  price exists. One membership is the ordinary case; two is a question only
 *  the customer can answer.
 */
export function pickAccount(
  rows: unknown,
): { accountId: string } | { error: "no_account" | "ambiguous_account" } {
  const list = Array.isArray(rows) ? rows : [];
  const ids = [...new Set(
    list.map((r) => (r as Record<string, unknown>)?.account_id)
      .filter((v): v is string => typeof v === "string" && v.length > 0),
  )];
  if (ids.length === 0) return { error: "no_account" };
  if (ids.length > 1) return { error: "ambiguous_account" };
  return { accountId: ids[0] };
}

/** Paystack requires an email to open a transaction. A session without one
 *  would fail at the provider and surface as "provider unavailable", which
 *  points the reader at the wrong system entirely. */
export function billableEmail(user: unknown): string | null {
  const e = (user as Record<string, unknown>)?.email;
  return typeof e === "string" && e.includes("@") ? e : null;
}

/** Where Paystack should send the browser back to.
 *
 *  SITE_URL is the production site, so a payment started on a Vercel preview
 *  came back to production -- which 404s, because the callback route is not on
 *  the production-tracked branch yet. That is what the first real test payment
 *  hit.
 *
 *  The caller may therefore propose its own origin, and the server decides
 *  whether to honour it. A proposed origin is accepted only if it is SITE_URL
 *  itself or a Vercel preview of this project; anything else is ignored in
 *  favour of SITE_URL. An attacker who reaches this can therefore redirect a
 *  payer to a preview of our own app and nowhere else -- and the callback
 *  grants nothing wherever it lands, so there is nothing to gain by it.
 */
export function resolveCallbackUrl(
  proposedOrigin: unknown,
  siteUrl: string,
): string {
  const fallback = `${siteUrl.replace(/\/+$/, "")}/checkout/callback`;
  if (typeof proposedOrigin !== "string" || !proposedOrigin) return fallback;

  let u: URL;
  try {
    u = new URL(proposedOrigin);
  } catch {
    return fallback;
  }
  // https only: an http callback would strip the session on the way back.
  if (u.protocol !== "https:") return fallback;
  // no credentials, no path, no query smuggled in through the origin
  if (u.username || u.password || u.search || u.hash) return fallback;
  if (u.pathname !== "/" && u.pathname !== "") return fallback;

  let site: URL;
  try {
    site = new URL(siteUrl);
  } catch {
    return fallback;
  }

  const allowed = u.host === site.host ||
    // Vercel preview hosts for this project. The suffix test is anchored on a
    // dot so an attacker cannot register `evil-vercel.app`.
    u.host.endsWith(".vercel.app");

  return allowed ? `${u.origin}/checkout/callback` : fallback;
}

// ============================================================================
// 0067: SELF-SERVE PLAN CHANGES (owner decision D5, 18 Oct 2026)
//
// An account that already pays may move to the other plan by itself. The old
// Paystack subscription is switched off by the webhook once the new one is on
// file, so nobody pays for two. Before any quote or founder hold, checkout
// refuses only:
//   already_on_plan  409  the same tier, while active or past_due. An overdue
//                         account is offered "Update your card" instead of a
//                         second subscription.
//   owner_only       403  the account already pays (active, past_due, or
//                         cancelled but inside its paid period) and the caller
//                         is not its owner. A trial's first payment is
//                         unchanged: any member may still make it.
//   switch_needs_support 409  the account pays but we hold no Paystack
//                         subscription code for it, so the old subscription
//                         could not be switched off. Message us instead.
//                         Also every plan change of a live paid plan while
//                         the kill switch is off (BILLING_SELF_SERVE=off):
//                         the safe state for a rollback of 0067.
// ============================================================================

/** The caller's account, as pickAccount chooses it, and whether the caller
 *  owns it. One login can hold several memberships (one per business) under
 *  one account; it is the owner if any of them is the owner's. */
export function pickAccountRole(
  rows: unknown,
): { accountId: string; isOwner: boolean } | { error: "no_account" | "ambiguous_account" } {
  const picked = pickAccount(rows);
  if ("error" in picked) return picked;
  const list = Array.isArray(rows) ? rows : [];
  const isOwner = list.some((r) => {
    const m = r as Record<string, unknown>;
    return m?.account_id === picked.accountId && m?.role === "owner";
  });
  return { accountId: picked.accountId, isOwner };
}

/** The facts about an account's subscription that checkout decides on. */
export type SubState = {
  status: string;
  tier: string | null;
  current_period_end: string | null;
  provider_subscription_code: string | null;
};

/** The subscriptions row as PostgREST returns it with plans(tier) embedded.
 *  No row (or an unreadable one) is null. */
export function readSubState(rows: unknown): SubState | null {
  const r = (Array.isArray(rows) ? rows[0] : null) as Loose | null;
  if (!r || typeof r.status !== "string") return null;
  const plan = Array.isArray(r.plans) ? r.plans[0] : r.plans;
  return {
    status: r.status,
    tier: typeof plan?.tier === "string" ? plan.tier : null,
    current_period_end: typeof r.current_period_end === "string" ? r.current_period_end : null,
    provider_subscription_code:
      typeof r.provider_subscription_code === "string" && r.provider_subscription_code
        ? r.provider_subscription_code : null,
  };
}

/** Already paying: active, past_due, or cancelled but still inside the period
 *  they paid for (the plan stays on until then). */
export function isPaying(sub: SubState | null, now: Date = new Date()): boolean {
  if (!sub) return false;
  if (sub.status === "active" || sub.status === "past_due") return true;
  if (sub.status === "cancelled" && sub.current_period_end) {
    const end = Date.parse(sub.current_period_end);
    return Number.isFinite(end) && end > now.getTime();
  }
  return false;
}

export type Refusal = {
  error: "already_on_plan" | "owner_only" | "switch_needs_support";
  status: 403 | 409;
};

/** Whether checkout must refuse this request, decided before any quote. */
export function checkoutRefusal(
  sub: SubState | null,
  tier: "costing" | "trading",
  isOwner: boolean,
  now: Date = new Date(),
  selfServe = true,
): Refusal | null {
  if (!sub) return null;
  const live = sub.status === "active" || sub.status === "past_due";
  if (live && sub.tier === tier) return { error: "already_on_plan", status: 409 };
  if (isPaying(sub, now) && !isOwner) return { error: "owner_only", status: 403 };
  if (live && (!selfServe || !sub.provider_subscription_code)) {
    return { error: "switch_needs_support", status: 409 };
  }
  return null;
}

/** The kill switch. Self-serve plan changes are on unless the secret
 *  BILLING_SELF_SERVE is exactly "off". */
export function selfServeOn(value: string | undefined): boolean {
  return (value ?? "").trim().toLowerCase() !== "off";
}

/** The Paystack subscription this payment replaces, for metadata.replaces.
 *  Any account past its trial with a code on file: the webhook then switches
 *  it off (or finds it already off) and ignores its later events. */
export function replacesCode(sub: SubState | null): string | null {
  if (!sub || sub.status === "trialing") return null;
  return sub.provider_subscription_code;
}
