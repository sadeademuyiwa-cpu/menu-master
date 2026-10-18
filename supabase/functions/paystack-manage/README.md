# paystack-manage

The owner's **Cancel plan** and **Update your card**, for an account that
already pays (owner decision D6, 18 Oct 2026). Called only by
`web/src/app/api/billing` with the signed-in user's own token.

## Deploy

```
supabase functions deploy paystack-manage
```

Deployed **with** JWT verification (no `--no-verify-jwt`), like
`paystack-checkout`. Apply migration 0067 first: the function records each
request through `fn_billing_record_manage_request`.

## Secrets

`PAYSTACK_SECRET_KEY` (already set for the webhook and checkout).
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform.

## Contract

| Request | 200 response |
|---|---|
| `{"action":"cancel"}` | `{"ok":true,"action":"cancel","ends_on":"YYYY-MM-DD"}` (the paid period end as a Lagos date, or `null`) |
| `{"action":"card_link"}` | `{"ok":true,"action":"card_link","link":"https://paystack.com/..."}` |

| Error | Status | When |
|---|---|---|
| `unauthorised` | 401 | no valid session |
| `owner_only` | 403 | the caller is not the account's owner (or has no account, or is on two) |
| `nothing_to_cancel` | 409 | on trial, or the plan already stops at the period end, or has ended |
| `no_subscription` | 409 | no Paystack subscription code on file (or the plan has ended, for a card link) |
| `bad_request` | 400 | not a POST, or an unknown action |
| `not_configured` | 500 | a secret is missing |
| `paystack_error` | 502 | Paystack refused or could not be reached; also when our subscription row cannot be read |

## What it never does

It never writes the subscription row. Cancelling calls Paystack's
`POST /subscription/disable`; Paystack then sends `subscription.not_renew`
(and `subscription.disable` at the period end), and `paystack-webhook`
applies those. The plan stays on until the end of the period already paid.
The update-card link carries a token and is never stored or logged.
