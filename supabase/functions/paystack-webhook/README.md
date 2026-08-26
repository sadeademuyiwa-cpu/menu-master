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
