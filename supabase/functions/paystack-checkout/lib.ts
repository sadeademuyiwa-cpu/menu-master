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
