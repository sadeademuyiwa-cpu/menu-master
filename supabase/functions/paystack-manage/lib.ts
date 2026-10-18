// ============================================================================
// Pure logic for paystack-manage, extracted so it can be unit-tested without
// a server, a network or a real secret. index.ts imports from here.
//
// The owner's decision D6 (18 Oct 2026): there is a Cancel plan button. It
// stops renewal at Paystack; the plan stays on until the end of the period
// already paid; after that the account is read-only. Changing plan,
// cancelling and updating the card on a paying account are OWNER ONLY.
//
// Paystack endpoints used, confirmed against Paystack's public OpenAPI
// description (github.com/PaystackOSS/openapi, paths subscription_{code},
// subscription_disable, subscription_{code}_manage_link):
//   GET  /subscription/:code               data.status, data.email_token
//   POST /subscription/disable             { code, token }   token = email_token
//   GET  /subscription/:code/manage/link   a link for updating the card
// ============================================================================

/** A parsed JSON body whose shape is checked field by field. */
// deno-lint-ignore no-explicit-any
type Loose = Record<string, any>;

export type Action = "cancel" | "card_link";

/** The error codes of the paystack-manage contract (K3), with their status. */
export const ERRORS = {
  unauthorised: 401,
  owner_only: 403,
  nothing_to_cancel: 409,
  no_subscription: 409,
  not_configured: 500,
  paystack_error: 502,
  bad_request: 400,
} as const;
export type ErrorCode = keyof typeof ERRORS;

export function errorBody(code: ErrorCode): { error: ErrorCode } {
  return { error: code };
}

/** The ONLY thing a client chooses: which of the two actions. */
export function parseAction(body: unknown): Action | null {
  const a = (body as Record<string, unknown>)?.action;
  return a === "cancel" || a === "card_link" ? a : null;
}

/** Which account, and whether the caller owns it. The same rule as
 *  paystack-checkout's pickAccountRole: one account (any number of business
 *  memberships under it); two accounts refuses rather than guess. Kept
 *  identical on purpose -- lib_test checks the two agree. */
export function pickAccountRole(
  rows: unknown,
): { accountId: string; isOwner: boolean } | { error: "no_account" | "ambiguous_account" } {
  const list = Array.isArray(rows) ? rows : [];
  const ids = [...new Set(
    list.map((r) => (r as Record<string, unknown>)?.account_id)
      .filter((v): v is string => typeof v === "string" && v.length > 0),
  )];
  if (ids.length === 0) return { error: "no_account" };
  if (ids.length > 1) return { error: "ambiguous_account" };
  const isOwner = list.some((r) => {
    const m = r as Record<string, unknown>;
    return m?.account_id === ids[0] && m?.role === "owner";
  });
  return { accountId: ids[0], isOwner };
}

/** The subscription facts this function decides on. */
export type SubState = {
  status: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  provider_subscription_code: string | null;
};

export function readSubState(rows: unknown): SubState | null {
  const r = (Array.isArray(rows) ? rows[0] : null) as Loose | null;
  if (!r || typeof r.status !== "string") return null;
  return {
    status: r.status,
    current_period_end: typeof r.current_period_end === "string" ? r.current_period_end : null,
    cancel_at_period_end: r.cancel_at_period_end === true,
    provider_subscription_code:
      typeof r.provider_subscription_code === "string" && r.provider_subscription_code
        ? r.provider_subscription_code : null,
  };
}

/** A Paystack subscription code, and nothing that could change a URL path. */
export function isSubscriptionCode(code: unknown): code is string {
  return typeof code === "string" && /^SUB_[A-Za-z0-9]{1,64}$/.test(code);
}

/** Whether the request can go to Paystack at all.
 *   cancel:    a trial, or a plan already stopped, has nothing to cancel.
 *              A paying plan with no Paystack code on file cannot be reached.
 *   card_link: needs a live Paystack subscription on file. */
export function manageRefusal(
  action: Action,
  sub: SubState | null,
  now: Date = new Date(),
): ErrorCode | null {
  if (!sub) return "no_subscription";
  if (action === "cancel") {
    if (sub.status === "trialing") return "nothing_to_cancel";
    if (sub.status === "cancelled" || sub.cancel_at_period_end) return "nothing_to_cancel";
    if (!isSubscriptionCode(sub.provider_subscription_code)) return "no_subscription";
    return null;
  }
  if (sub.status === "trialing") return "no_subscription";
  if (!isSubscriptionCode(sub.provider_subscription_code)) return "no_subscription";
  if (sub.status === "cancelled") {
    const end = sub.current_period_end ? Date.parse(sub.current_period_end) : NaN;
    if (!Number.isFinite(end) || end <= now.getTime()) return "no_subscription";
  }
  return null;
}

/** The last day of the paid period, as a date in Lagos (YYYY-MM-DD), or null
 *  when there is none. Lagos is UTC+1 all year. */
export function endsOn(periodEnd: string | null): string | null {
  if (!periodEnd) return null;
  const t = Date.parse(periodEnd);
  if (!Number.isFinite(t)) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date(t));
  } catch {
    return new Date(t + 3600_000).toISOString().slice(0, 10);
  }
}

export type PaystackCall = (path: string, init?: RequestInit) => Promise<Response>;

export function paystackCaller(secret: string, fetchImpl: typeof fetch = fetch): PaystackCall {
  return (path, init = {}) =>
    fetchImpl(`https://api.paystack.co${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
        ...(init.headers ?? {}),
      },
    });
}

/** Paystack statuses for a subscription that will not charge again. */
export const OFF_STATUSES = ["non-renewing", "cancelled", "complete", "completed"];

/** Stop renewal at Paystack. Fetches the email token, then disables. A
 *  subscription Paystack already shows as off is reported as such, without a
 *  second disable. Never throws. Fetch Subscription also returns the card's
 *  authorization_code: nothing from it is kept but status and email_token. */
export async function stopRenewal(
  code: string,
  paystack: PaystackCall,
): Promise<{ outcome: "sent" | "already_off" } | { outcome: "failed"; detail: string }> {
  if (!isSubscriptionCode(code)) return { outcome: "failed", detail: "not a Paystack subscription code" };
  try {
    const got = await paystack(`/subscription/${encodeURIComponent(code)}`, { method: "GET" });
    const b = await got.json().catch(() => null) as Loose | null;
    if (!got.ok || b?.status !== true || !b?.data || typeof b.data !== "object") {
      const why = typeof b?.message === "string" ? b.message : "(no message)";
      return { outcome: "failed", detail: `fetch HTTP ${got.status}: ${why}`.slice(0, 300) };
    }
    const status = typeof b.data.status === "string" ? b.data.status.toLowerCase() : "";
    if (OFF_STATUSES.includes(status)) return { outcome: "already_off" };
    const token = b.data.email_token;
    if (typeof token !== "string" || !token) return { outcome: "failed", detail: "fetch returned no email_token" };

    const res = await paystack("/subscription/disable", {
      method: "POST", body: JSON.stringify({ code, token }),
    });
    const d = await res.json().catch(() => null) as Loose | null;
    if (res.ok && d?.status === true) return { outcome: "sent" };
    const why = typeof d?.message === "string" ? d.message : "(no message)";
    return { outcome: "failed", detail: `disable HTTP ${res.status}: ${why}`.slice(0, 300) };
  } catch (e) {
    return { outcome: "failed", detail: `network: ${String(e)}`.slice(0, 300) };
  }
}

/** The update-card link must be an https page on Paystack's own domain.
 *  Anything else is refused rather than handed to the owner's browser. */
export function safeManageLink(link: unknown): string | null {
  if (typeof link !== "string") return null;
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password) return null;
  const h = u.hostname.toLowerCase();
  const ours = h === "paystack.com" || h.endsWith(".paystack.com") ||
    h === "paystack.co" || h.endsWith(".paystack.co");
  return ours ? u.toString() : null;
}

/** Ask Paystack for the link where the owner updates their card. */
export async function cardLink(
  code: string,
  paystack: PaystackCall,
): Promise<{ outcome: "link_issued"; link: string } | { outcome: "failed"; detail: string }> {
  if (!isSubscriptionCode(code)) return { outcome: "failed", detail: "not a Paystack subscription code" };
  try {
    const res = await paystack(`/subscription/${encodeURIComponent(code)}/manage/link`, { method: "GET" });
    const b = await res.json().catch(() => null) as Loose | null;
    if (!res.ok || b?.status !== true) {
      const why = typeof b?.message === "string" ? b.message : "(no message)";
      return { outcome: "failed", detail: `manage link HTTP ${res.status}: ${why}`.slice(0, 300) };
    }
    const link = safeManageLink(b?.data?.link);
    if (!link) return { outcome: "failed", detail: "manage link missing or not a Paystack https page" };
    return { outcome: "link_issued", link };
  } catch (e) {
    return { outcome: "failed", detail: `network: ${String(e)}`.slice(0, 300) };
  }
}
