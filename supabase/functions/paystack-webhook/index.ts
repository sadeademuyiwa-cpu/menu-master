// ============================================================================
// MENU MASTER NG -- Paystack webhook
//
// Implements docs/BILLING_INTEGRATION_DESIGN.md section 4, steps 1-11.
// Steps 7-11 are one database call each (fn_billing_ingest, fn_billing_apply)
// so a crash between them cannot leave money moved and unrecorded.
//
// SECRETS: read from the Edge Function secret store at runtime. Never logged,
// never returned, never written to the database.
//   PAYSTACK_SECRET_KEY          hmac key for signature verification
//   SUPABASE_URL                 provided by the platform
//   SUPABASE_SERVICE_ROLE_KEY    provided by the platform
// ============================================================================

const MAX_BODY_BYTES = 256 * 1024; // step 5: reject before hashing

const enc = new TextEncoder();

/** Constant-time comparison. A byte-by-byte compare with early exit leaks the
 *  signature through timing, which is step 3's whole point. */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha512Hex(key: string, body: Uint8Array): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw", enc.encode(key),
    { name: "HMAC", hash: "SHA-512" }, false, ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", cryptoKey, body));
}

async function sha256Hex(body: Uint8Array): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", body));
}

/** Strip the bearer credential before the payload ever leaves this process.
 *  The database strips it again on insert (0027); this is the first of the two
 *  layers, not the only one. */
function redact(payload: unknown): unknown {
  const p = payload as Record<string, any>;
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

async function rpc(fn: string, args: Record<string, unknown>) {
  const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    // never echo the body: it may contain the service key's error context
    throw new Error(`rpc ${fn} failed with ${res.status}`);
  }
  return await res.json();
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
  if (!secret) {
    // fail closed, and say nothing useful to the caller
    console.error("paystack-webhook: signing secret is not configured");
    return new Response("misconfigured", { status: 500 });
  }

  // STEP 1: raw bytes. Never req.json() first -- the signature is over these
  // exact bytes and re-serialising JSON changes them.
  const raw = new Uint8Array(await req.arrayBuffer());

  // STEP 5: size cap before hashing
  if (raw.byteLength > MAX_BODY_BYTES) {
    return new Response("payload too large", { status: 413 });
  }

  const bodySha = await sha256Hex(raw);
  const sourceIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  // STEPS 2-4: verify, in constant time
  const provided = req.headers.get("x-paystack-signature") ?? "";
  const expected = await hmacSha512Hex(secret, raw);

  if (!timingSafeEqualHex(provided, expected)) {
    // minimal row only -- timestamp, ip, length, hash. NEVER the body.
    try {
      await rpc("fn_billing_ingest", {
        p_body_sha256: bodySha, p_signature_valid: false,
        p_body_bytes: raw.byteLength, p_source_ip: sourceIp,
      });
    } catch (e) {
      console.error("paystack-webhook: could not record rejected delivery", String(e));
    }
    return new Response("invalid signature", { status: 401 });
  }

  // STEP 6: parse. Unparseable is permanent -- retrying identical bytes cannot
  // make them valid JSON -- so record it and return 200 so Paystack stops.
  let parsed: any;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    try {
      await rpc("fn_billing_ingest", {
        p_body_sha256: bodySha, p_signature_valid: true,
        p_body_bytes: raw.byteLength, p_source_ip: sourceIp,
      });
    } catch (e) {
      console.error("paystack-webhook: could not record unparseable delivery", String(e));
      return new Response("retry", { status: 500 });
    }
    return new Response("unparseable", { status: 200 });
  }

  const payload = redact(parsed);
  const d = (payload as any)?.data ?? {};

  try {
    // STEPS 7-8
    const ingest = await rpc("fn_billing_ingest", {
      p_body_sha256: bodySha,
      p_signature_valid: true,
      p_event_type: (payload as any)?.event ?? null,
      p_provider_event_id: d.id ? String(d.id) : null,
      p_reference: d.reference ?? null,
      p_payload: payload,
      p_body_bytes: raw.byteLength,
      p_source_ip: sourceIp,
    });

    if (ingest.action === "duplicate" || ingest.action === "lost_race") {
      // already recorded, or another worker holds it. Either way Paystack is
      // done: a redelivery must not be treated as a new payment.
      return new Response(ingest.action, { status: 200 });
    }

    // STEPS 9-11
    const applied = await rpc("fn_billing_apply", { p_event_id: ingest.event_id });

    // failed_transient is the ONLY case where Paystack should try again
    if (applied.status === "failed_transient") {
      return new Response("retry", { status: 500 });
    }
    return new Response(applied.status, { status: 200 });
  } catch (e) {
    // the database is unreachable: ask Paystack to redeliver
    console.error("paystack-webhook: transient failure", String(e));
    return new Response("retry", { status: 500 });
  }
});
