// ============================================================================
// Pure webhook logic, extracted so it can be unit-tested without a server, a
// network or a real secret. index.ts imports from here; nothing is duplicated.
// ============================================================================

/** A parsed JSON body whose shape is checked field by field. */
// deno-lint-ignore no-explicit-any
type Loose = Record<string, any>;

export const MAX_BODY_BYTES = 256 * 1024; // step 5: reject before hashing

const enc = new TextEncoder();

/** Constant-time comparison. A byte-by-byte compare with early exit leaks the
 *  signature through timing, which is step 3's whole point. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hmacSha512Hex(key: string, body: Uint8Array<ArrayBuffer>): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(key),
    { name: "HMAC", hash: "SHA-512" }, false, ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", cryptoKey, body));
}

export async function sha256Hex(body: Uint8Array<ArrayBuffer>): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", body));
}

/** Strip the bearer credential before the payload ever leaves this process.
 *  The database strips it again on insert (0027); this is the first of the two
 *  layers, not the only one. */
export function redact(payload: unknown): unknown {
  const p = payload as Loose;
  const auth = p?.data?.authorization;
  if (auth && typeof auth === "object") {
    delete auth.authorization_code;
    delete auth.signature;
    delete auth.bin;
    delete auth.exp_month;
    delete auth.exp_year;
  }
  return p;
}


// ============================================================================
// 0067: SWITCHING OFF A REPLACED SUBSCRIPTION
//
// Paystack has no plan-switch call. When an owner changes plan, a new
// subscription is opened and the old one must be switched off, or they are
// charged for both. fn_billing_apply records the old code in
// billing_superseded; after every verified delivery the webhook claims a few
// of those (fn_billing_claim_switch_offs never hands out a code that is
// CURRENT on any account) and switches each off:
//
//   GET  /subscription/:code       -> data.status, data.email_token
//   POST /subscription/disable     {code, token}
//
// Confirmed against Paystack's public OpenAPI description
// (github.com/PaystackOSS/openapi): Fetch Subscription returns email_token
// and status; Disable takes `code` and `token` (the email token). The result
// is recorded with fn_billing_record_switch_off. Retries are safe: a
// subscription Paystack already shows as off is recorded 'already_off'
// without calling disable again, and a closed row is never reopened.
//
// Fetch Subscription also returns data.authorization.authorization_code, a
// bearer credential. Nothing here keeps, logs or returns anything from the
// response except status and email_token.
// ============================================================================

export type SwitchOffOutcome = {
  outcome: "disabled" | "already_off" | "failed";
  detail: string | null;
};

/** Talks to api.paystack.co with the secret key. Injected so tests can mock
 *  Paystack's responses without a network. */
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

/** A Paystack subscription code, and nothing that could change the URL path
 *  it is put into. */
export function isSubscriptionCode(code: unknown): code is string {
  return typeof code === "string" && /^SUB_[A-Za-z0-9]{1,64}$/.test(code);
}

/** Paystack statuses for a subscription that will not charge again. */
export const OFF_STATUSES = ["non-renewing", "cancelled", "complete", "completed"];

/** What Fetch Subscription told us: already off, or the email token needed to
 *  switch it off. Anything else is a failure, never a guess. */
export function readFetchedSubscription(
  httpStatus: number,
  body: unknown,
): { kind: "off"; status: string } | { kind: "on"; token: string } | { kind: "error"; detail: string } {
  const b = body as Loose | null;
  if (httpStatus === 404) return { kind: "error", detail: "paystack: subscription not found" };
  if (httpStatus < 200 || httpStatus >= 300 || !b || b.status !== true || typeof b.data !== "object" || !b.data) {
    const why = typeof b?.message === "string" ? b.message : "(no message)";
    return { kind: "error", detail: `paystack fetch HTTP ${httpStatus}: ${why}`.slice(0, 300) };
  }
  const status = typeof b.data.status === "string" ? b.data.status.toLowerCase() : "";
  if (OFF_STATUSES.includes(status)) return { kind: "off", status };
  const token = b.data.email_token;
  if (typeof token !== "string" || token.length === 0) {
    return { kind: "error", detail: "paystack fetch returned no email_token" };
  }
  return { kind: "on", token };
}

/** Whether Disable Subscription succeeded. */
export function readDisableResult(httpStatus: number, body: unknown): { ok: true } | { ok: false; detail: string } {
  const b = body as Loose | null;
  if (httpStatus >= 200 && httpStatus < 300 && b?.status === true) return { ok: true };
  const why = typeof b?.message === "string" ? b.message : "(no message)";
  return { ok: false, detail: `paystack disable HTTP ${httpStatus}: ${why}`.slice(0, 300) };
}

/** Switch one replaced subscription off at Paystack. Never throws. */
export async function switchOffOne(code: string, paystack: PaystackCall): Promise<SwitchOffOutcome> {
  if (!isSubscriptionCode(code)) {
    return { outcome: "failed", detail: "not a Paystack subscription code" };
  }
  try {
    const got = await paystack(`/subscription/${encodeURIComponent(code)}`, { method: "GET" });
    const fetched = readFetchedSubscription(got.status, await got.json().catch(() => null));
    if (fetched.kind === "error") return { outcome: "failed", detail: fetched.detail };
    if (fetched.kind === "off") {
      return { outcome: "already_off", detail: `paystack shows it ${fetched.status}` };
    }
    const res = await paystack("/subscription/disable", {
      method: "POST",
      body: JSON.stringify({ code, token: fetched.token }),
    });
    const done = readDisableResult(res.status, await res.json().catch(() => null));
    return done.ok ? { outcome: "disabled", detail: null } : { outcome: "failed", detail: done.detail };
  } catch (e) {
    return { outcome: "failed", detail: `network: ${String(e)}`.slice(0, 300) };
  }
}

export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>;

/** Claim up to `limit` replaced subscriptions, switch each off, record each
 *  outcome. Returns what happened, for the log. Never throws: a failure here
 *  must never change what Paystack is told about the event itself. */
export async function switchOffReplaced(
  rpc: Rpc,
  paystack: PaystackCall,
  limit = 3,
): Promise<{ code: string; outcome: string; recorded: boolean }[]> {
  const done: { code: string; outcome: string; recorded: boolean }[] = [];
  let claimed: unknown;
  try {
    claimed = await rpc("fn_billing_claim_switch_offs", { p_limit: limit });
  } catch (e) {
    console.error("paystack-webhook: could not claim switch-offs", String(e));
    return done;
  }
  for (const row of Array.isArray(claimed) ? claimed : []) {
    const code = (row as Record<string, unknown>)?.subscription_code;
    if (typeof code !== "string") continue;
    const r = await switchOffOne(code, paystack);
    let recorded = false;
    try {
      await rpc("fn_billing_record_switch_off", {
        p_subscription_code: code, p_outcome: r.outcome, p_detail: r.detail,
      });
      recorded = true;
    } catch (e) {
      console.error(`paystack-webhook: could not record switch-off of ${code}`, String(e));
    }
    done.push({ code, outcome: r.outcome, recorded });
  }
  return done;
}
