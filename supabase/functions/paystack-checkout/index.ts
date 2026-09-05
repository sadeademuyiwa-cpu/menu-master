// ============================================================================
// MENU MASTER NG -- checkout initialization
//
// Implements docs/D20_CHECKOUT.md sections 1, 5 and 7.
//
// WHY THIS IS AN EDGE FUNCTION AND NOT A VERCEL ROUTE
//   It needs the Paystack secret key. Keeping it here means that key exists in
//   exactly ONE place -- the Supabase Edge Function secret store, alongside the
//   webhook that already uses it -- rather than being copied into Vercel, where
//   preview deployments and build logs are a second exposure surface.
//
//   Vercel holds no billing secret at all. web/src/app/api/checkout forwards
//   the signed-in user's own token here and nothing else.
//
// WHAT THIS DOES NOT DO
//   It does not grant entitlement, touch a subscription, or confirm a founder
//   slot. It reserves a slot and asks Paystack for a hosted page. Entitlement
//   is granted only by paystack-webhook, from a signature-verified event.
//
// SECRETS: read from the Edge Function secret store at runtime. Never logged,
// never returned.
//   PAYSTACK_SECRET_KEY
//   SUPABASE_URL                 provided by the platform
//   SUPABASE_SERVICE_ROLE_KEY    provided by the platform
//   SITE_URL                     where Paystack sends the browser back
// ============================================================================

import { initializeBody, missingPlanCode, parseTier, safeError, type Quote } from "./lib.ts";

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

async function serviceRpc(fn: string, args: Record<string, unknown>) {
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`rpc ${fn} failed with ${res.status}`);
  return await res.json();
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json(safeError("method_not_allowed"), 405);

  const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
  const siteUrl = Deno.env.get("SITE_URL");
  if (!secret || !siteUrl) {
    console.error("paystack-checkout: not configured");
    return json(safeError("misconfigured"), 500);
  }

  // WHO IS ASKING. The platform has already verified this JWT's signature
  // (deployed WITHOUT --no-verify-jwt, unlike the webhook), so the token is
  // authentic; we still ask Supabase who it belongs to rather than decoding
  // it ourselves, because a client-supplied claim is not an identity.
  const auth = req.headers.get("Authorization") ?? "";
  const who = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")! },
  });
  if (!who.ok) return json(safeError("unauthenticated"), 401);
  const user = await who.json();
  if (!user?.id) return json(safeError("unauthenticated"), 401);

  const tier = parseTier(await req.json().catch(() => ({})));
  if (!tier) return json(safeError("choose_costing_or_trading"), 400);

  // WHICH ACCOUNT. Read with the service role from memberships -- never from
  // the request body. A user who posts someone else's account_id is posting a
  // field nothing reads.
  const memRes = await fetch(
    `${Deno.env.get("SUPABASE_URL")}/rest/v1/memberships` +
      `?user_id=eq.${user.id}&select=account_id&limit=1`,
    {
      headers: {
        apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
      },
    },
  );
  const mem = memRes.ok ? await memRes.json() : [];
  const accountId = mem?.[0]?.account_id;
  if (!accountId) return json(safeError("no_account"), 403);

  // THE QUOTE. The database decides plan, price, price tier, founding
  // eligibility and slot availability. This function decides nothing.
  let quote: Quote;
  try {
    quote = await serviceRpc("fn_checkout_quote", {
      p_account_id: accountId,
      p_tier: tier,
    }) as Quote;
  } catch (e) {
    // fn_checkout_quote raises rather than inventing a price when none exists
    console.error("paystack-checkout: quote refused", String(e));
    return json(safeError("no_price_available"), 409);
  }

  if (missingPlanCode(quote)) {
    // A one-off charge is not what was sold. Refuse before Paystack.
    console.error(`paystack-checkout: plan ${quote.plan_id} has no provider_plan_code`);
    return json(safeError("plan_not_mapped"), 409);
  }

  const init = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify(
      initializeBody(quote, user.email, `${siteUrl}/checkout/callback`),
    ),
  });

  if (!init.ok) {
    // never echo Paystack's body
    console.error(`paystack-checkout: initialize returned ${init.status}`);
    return json(safeError("provider_unavailable"), 502);
  }
  const body = await init.json();
  if (!body?.status || !body?.data?.authorization_url) {
    console.error("paystack-checkout: initialize returned no authorization_url");
    return json(safeError("provider_unavailable"), 502);
  }

  // Only what the browser needs to continue. No secret, no access code beyond
  // the hosted URL itself, no internal ids beyond the plan they chose.
  return json({
    authorization_url: body.data.authorization_url,
    plan_id: quote.plan_id,
    plan_name: quote.plan_name,
    price_kobo: quote.price_kobo,
    price_tier: quote.price_tier,
    founder_seq: quote.founder_seq,
  }, 200);
});
