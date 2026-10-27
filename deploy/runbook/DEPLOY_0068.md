# DEPLOYMENT RUNBOOK — 0068 (a WhatsApp number from each new owner, consent on record, admin check-ins)

> ## ⛔ NOT AUTHORISED UNTIL YOU RUN IT. Nothing here has touched production.

Expected starting state: **0066 applied**, 118 policies in `public`, **102**
`fn_*` functions. **0067 is not needed** and may come before or after: with
0067 already in, expect 107 `fn_*` before and 111 after; 0067's own checks
allow for 0068 having gone in first.

## What changes

| | |
|---|---|
| `fn_normalise_ng_phone(text)` | a Nigerian mobile number in one form, `234XXXXXXXXXX`, or null. Accepts `0803…`, `803…`, `+234…`, `+234 (0) 803…`, `00234…` |
| `profiles` | `phone` (unused since 0001) gets a format check; new `phone_added_at`, `phone_confirmed_at`, `marketing_ok_at`, `contact_wording`, `phone_wrong_at`. People still **read** their own row; nobody **writes** it directly any more, only through `fn_set_my_contact` |
| `contact_consents` | new, append-only: every change of "you may contact me" and "tips and offers", **the number it was about**, the words shown, where. RLS on, no client access (NDPA s.26(1): we can prove consent) |
| `admin_checkins` | new: the admin's contact attempts (kind, channel, outcome, note, who). Outcomes: reached, no reply, wrong number, replied STOP to offers, asked not to be contacted. RLS on, no client access |
| `fn_set_my_contact` | the signed-in person sets or clears their own number and offers choice |
| `fn_admin_checkins_due`, `fn_admin_record_checkin` | platform admin only: who to contact now and why; "Mark done" |
| Policies in `public` | 118 → **118** |
| `fn_*` | 102 → **106** (107 → 111 with 0067) |
| Customer rows | none changed; `profiles` is empty on production (PRE row 4 shows it) |

## What the owner sees

- **Onboarding** asks for a **WhatsApp number (optional)**, says what it is for
  ("to help you get set up, or if something goes wrong with your account. Not
  for adverts"), and, once a number is typed, an unticked box for tips and
  offers. A mistyped number is caught before the business is created.
- **More → Account** has a **Your WhatsApp number** card: change it, tick or
  untick offers, or **Remove my number** in one press.
- **Admin → Signups** opens on **Check-ins due**: a failed payment, a trial
  ending in the next 2 days, a hello in the first 2 days, a day-3 check. Each
  row has a **WhatsApp** button with the message already written, **Call**,
  and **Mark done** (how, what happened, a note):
  - "Talked to them" on WhatsApp or a call marks the number confirmed (an
    email reply does not);
  - "No reply yet" brings the check-in back the next day;
  - "Wrong number" removes the number and More → Account asks the owner
    for the right one, so nothing more goes to a stranger;
  - "Replied STOP to offers" stops offers only;
  - "Asked not to be contacted" removes the number and keeps them off the
    list until they give a number again.
  A **WhatsApp numbers** list shows every owner's number and offers choice,
  and records a contact (a STOP reply) at any time. A figure shows how many
  new owners gave a number.
- A new number needs offers ticked again: consent belongs to the number it
  was given for. Only the person who set the business up is asked; staff are not.
- The payment-failed message offers help while self-serve billing is off, and
  points to Plans & billing once it is on.
- **Overview** lists "N owners to check in with"; the Signups menu item shows
  the count.
- **/privacy** (the built-in draft, which is what production shows today)
  now names the WhatsApp number, why, WhatsApp (Meta) as a recipient, how
  long it is kept and how to remove it, dated **26 Oct 2026**. If you ever
  saved your own policy in Admin → Website → Privacy policy, add those lines
  to it yourself, or press "Start again from the draft".

## Order of operations

| # | Artefact | Where | Writes? |
|---|---|---|---|
| 1 | `PRE_DEPLOY_0068.sql` | SQL Editor | no |
| 2 | `migrations/proposed/0068_signup_contact.sql` | **psql only** | yes |
| 3 | `POST_VERIFY_0068.sql` | SQL Editor | no |
| 4 | the app release (push, then fast-forward the production branch) | git / Vercel | — |
| — | `migrations/rollbacks/0068_rollback.sql`, only if 3 fails | psql | yes |

```
psql "<session-pooler connection string>" --single-transaction -v ON_ERROR_STOP=1 \
     -f migrations/proposed/0068_signup_contact.sql
```

Expect **PRE 5/5**, `NOTICE: 0068 OK: …`, **POST 7/7**. Same transaction
guard as 0049–0067. After POST passes, `git mv` the file from `proposed/` to
`migrations/`.

**Migration before the app.** The app tolerates 0068 being missing (onboarding
logs the refused call and carries on, the admin shows no check-ins), but the
numbers people type in between would be lost.

## Rollback

`0068_rollback.sql` **deletes every number given, the consent record and the
check-ins** (export them first; the query is in the file's header), puts
`profiles` back to its 0011 grants, and leaves 102 `fn_*` (107 with 0067).
The app keeps working without it.

## Rehearsal results (26 Oct 2026, copy of a 0066 database with seeded owners)

| Item | Result |
|---|---|
| `PRE_DEPLOY_0068.sql` on 0066 | 5/5 PASS |
| apply on 0066 | `0068 OK` (102 → 106 fn_*) |
| apply again | refused by its preflight |
| apply without `--single-transaction` | refused by the guard |
| `POST_VERIFY_0068.sql` | 7/7 PASS |
| `tests/054_signup_contact.sql` | **38/38** (after the review fixes) |
| rollback, then PRE again, then apply again | all OK |
| 0067 then 0068 / 0068 then 0067 | both OK (102 → 107 → 111, 102 → 106 → 111) |
| 0068 → 0067 → **0067 rollback** → 0067 → 0068 rollback | all OK (0067's rollback now allows for 0068) |
| all SQL suites on a fresh build with 0067 and 0068 | 52 suites, **1230 pass, 0 fail** |
| `e2e/journey-contact.mjs` | **20/20**, twice on the same database |
| `journey-site`, `journey-account`, `journey` | 53/53, 98/98, 128/128 |
