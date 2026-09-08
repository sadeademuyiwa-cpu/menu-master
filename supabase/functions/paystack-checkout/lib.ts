// ============================================================================
// Pure checkout logic, extracted so it can be unit-tested without a server, a
// network or a real secret. index.ts imports from here; nothing is duplicated.
// ============================================================================

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
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    email,
    amount: String(q.price_kobo),
    currency: q.currency,
    callback_url: callbackUrl,
    // fn_billing_apply reads BOTH of these. account_id is how a webhook is
    // attributed to a customer at all; plan_id is the fallback when Paystack
    // sends no plan code of its own.
    metadata: { account_id: q.account_id, plan_id: q.plan_id },
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
