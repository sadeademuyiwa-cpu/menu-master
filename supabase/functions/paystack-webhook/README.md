# paystack-webhook

Implements `docs/BILLING_INTEGRATION_DESIGN.md` §4.

## Deploy

```
supabase functions deploy paystack-webhook --no-verify-jwt
```

`--no-verify-jwt` is required: Paystack does not send a Supabase JWT. The
endpoint is protected by the HMAC signature, not by the platform's auth.

## Secrets

```
supabase secrets set PAYSTACK_SECRET_KEY=<the sk_test_... value>
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform.
**Never** put the secret key in Vercel, in the repository, or anywhere prefixed
`NEXT_PUBLIC_`.

## Responses, and what Paystack does with them

| Status | When | Paystack |
|---|---|---|
| 200 | applied, ignored, duplicate, lost_race, unparseable | stops |
| 401 | signature mismatch | stops |
| 413 | body over 256 KB | stops |
| 500 | database unreachable, or `failed_transient` | retries |

Only `failed_transient` asks for a retry. `failed_permanent` returns 200 on
purpose: retrying cannot fix it, and it belongs in the reconciliation queue for
a human, not in a redelivery loop.

## Switching off a replaced subscription (0067)

When an owner changes plan, Paystack opens a new subscription; it has no
plan-switch call. 0067 records the old subscription in `billing_superseded`.
After every verified delivery (applied, ignored or a redelivery) the webhook
claims up to three such rows with `fn_billing_claim_switch_offs`, which never
hands out a code that is current on any account, and for each:

1. `GET /subscription/:code` for its `status` and `email_token`;
2. if Paystack already shows it `non-renewing`, `cancelled` or `complete`,
   records `already_off`; otherwise `POST /subscription/disable` with
   `{code, token}`;
3. records the outcome with `fn_billing_record_switch_off`.

This runs after the response through `EdgeRuntime.waitUntil`, so it never
delays or changes what Paystack is told about the event. A failure is
retried on a later delivery with backoff (2, 4 ... 256 minutes, at most 20
tries); an hour on, `fn_admin_scan` raises `subscription_not_switched_off`.
The old subscription's own `not_renew`, `disable` and failed-payment events
are recorded as `ignored` (`superseded`) and change nothing. Apply 0067 before
deploying this version.
