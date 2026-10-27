# DEPLOYMENT RUNBOOK — 0069 (which screen people are on, where they get stuck, help from inside the app, short ratings)

> ## ⛔ NOT AUTHORISED UNTIL YOU RUN IT. Nothing here has touched production.

Expected starting state: **0068 applied** (and so 0066), 118 policies in
`public`, **106** `fn_*` functions. **0067 is not needed** and may come before
or after: with 0067 already in, expect 111 `fn_*` before and 123 after; 0067's
own checks allow for 0069 having gone in first.

## What changes

| | |
|---|---|
| `usage_views` | new: one row per screen a signed-in person opens — the route **pattern** (`/recipes/:id`, never an id or the query), the help-video screen key, phone/tablet/desktop, when, active seconds, and the state (active, idle, hidden, left). Kept **90 days** |
| `usage_events` | new: a refusal shown on screen (by its refusal words, never the sentence), Help opened, a help video watched, a crash (its code). Kept **90 days** |
| `help_requests` | new: "Write to us" and "Chat with us on WhatsApp" from the Help sheet, with the screen it came from; open → replied → resolved, who handled it, a note. Kept while the account is open |
| `feedback` | new: the short questions' answers — 1 to 5 after the first costed dish and the first sale, 0 to 10 "would you recommend us" after a month of real use; a dismissal is kept with no score |
| `profiles.usage_opt_out_at` | new: set when the person turns recording off in More → Account (NDPA s.36). Turning it off also **deletes** their visits and events |
| `fn_usage_beat`, `fn_usage_event`, `fn_ask_for_help`, `fn_feedback_due`, `fn_give_feedback`, `fn_set_my_usage_tracking` | the app's calls: each writes only the caller's own rows, in a checked form; beats and events quietly do nothing for an admin, for someone who turned it off, or for anything malformed. Limits: 500 new visits and 200 events an hour, 10 help requests a day per person |
| `fn_admin_live`, `fn_admin_activation`, `fn_admin_journey`, `fn_admin_help`, `fn_admin_set_help_status` | platform admin only (`fn_require_platform_admin`) |
| `fn_usage_purge` | removes visits and events older than 90 days; no client role may call it. Scheduled nightly at 02:17 UTC as `mm-usage-purge` **where pg_cron is on** |
| Six partial indexes | on `purchases`, `cost_snapshots`, `recipe_prices`, `orders`, `sales_entries`, `billing_events`, each `(account_id, when)`, so each account's first purchase, costed dish, price, sale and payment is one index entry for Journeys. Built inside the migration (a brief write lock on each table; small on production) |
| Policies in `public` | 118 → **118** (every new table: RLS on, no policy, no client grant) |
| `fn_*` | 106 → **118** (111 → 123 with 0067) |
| Customer rows | none changed |

## What people see

- **Told first.** The first screen after the release says, once to each
  person: "So we can help when you get stuck, Menu Master sees which screens
  you use and for how long, unless you turn this off in Account. Never what
  you type." with **OK**. Nothing of theirs is recorded until that has been
  on their screen (the policy promises notice before a change takes effect).
  It is kept per person on that phone, so a second person on a shared tablet
  is told too; a new phone shows it once again.
- **Help** at the top of every screen, signed in (it used to show only where
  a video was chosen). It says which screen they are on and offers: the
  screen's video, when there is one; **Write to us** (one box; sent with the
  screen; a reference such as **H12** comes back); and **Chat with us on
  WhatsApp** when the website has a WhatsApp number (Admin → Website →
  Landing page). The sign-in pages keep the old video button.
- **One short question, now and then**, as a small sheet: never on the first
  day, never while typing, at most once a fortnight. "How easy was it to cost
  your first dish?" (five buttons, Very hard … Very easy) after the first
  costed dish; the same after the first sale; "How likely are you to
  recommend Menu Master…?" (0 to 10) after a month with 10 days of use, every
  90 days. A low score asks "What made it hard?"; the score is kept even if
  they write nothing. The database keeps an answer only to the question that
  is due, so nobody can add answers they were not asked for. The first-dish and first-sale questions go to the
  owner; the recommend question to owners and managers, a month after they
  joined. "Not now" counts as asked.
- **More → Account → Help us help you**: "Let Menu Master see which screens
  you use", on unless they turn it off. Off deletes what was recorded.
- **/privacy** (the built-in draft) now says what is recorded inside the app,
  why (legitimate interest: spotting where people get stuck), for how long
  (90 days), the help requests and ratings, and how to stop it. If you ever
  saved your own policy in Admin → Website → Privacy policy, add those lines
  yourself, or press "Start again from the draft".

## What the admin sees

- **Customers → Live now**: who has the app open this minute (split into
  using it, and open but not in use) and who was in it in the last 30
  minutes, on which screen and for how long, phone or computer; which
  screens are in use; how many people opened the app today. Refreshes itself
  every 30 seconds. A screen left untouched for 30 minutes drops out.
- **Customers → Journeys**: where owners get to — business, purchase, a
  costed dish, a price, a sale, paid — as a funnel with the drop at each
  step; then **Needs a look** (asked for help or rated low first, then
  stopped at a step too long, then gone quiet), **On trial** and
  **Everyone**. A low rating asks for a word for 30 days, or until you record
  a check-in that reached them (not "no reply" or "wrong number"); a later
  good answer does not hide it. A help request waiting always counts, on any
  plan. Renewal off but still paid up shows "Not renewing", not "Left". An
  owner who turned recording off shows "Not recorded", not "gone quiet".
  What someone did on the onboarding screen, before the business existed,
  joins their journey once it does. Each owner opens to their story: each use of the app as one
  line with the screens in order, refusals, errors, help asked, ratings, and
  your check-ins, by day.
- **Customers → Help & feedback**: requests waiting first, each with
  **WhatsApp** or **Email** and the reply started for you, and **Mark done**
  (replied / sorted / still waiting, with a note); every answer to the short
  questions; the screens that refused people most this week.
- **Overview**: "In the app now", and rows for help waiting, low ratings
  this week and owners who look stuck. The sidebar counts people in the app
  and help waiting.

## Order of operations

| # | Artefact | Where | Writes? |
|---|---|---|---|
| 1 | `PRE_DEPLOY_0069.sql` | SQL Editor | no |
| 2 | `migrations/proposed/0069_usage_and_help.sql` | **psql only** | yes |
| 3 | `POST_VERIFY_0069.sql` | SQL Editor | no |
| 4 | the app release (push, then fast-forward the production branch) | git / Vercel | — |
| — | `migrations/rollbacks/0069_rollback.sql`, only if 3 fails | psql | yes |

```
psql "<session-pooler connection string>" --single-transaction -v ON_ERROR_STOP=1 \
     -f migrations/proposed/0069_usage_and_help.sql
```

Expect **PRE 5/5**, `NOTICE: 0069 OK: …`, **POST 7/7**. Same transaction
guard as 0049–0068. After POST passes, `git mv` the file from `proposed/` to
`migrations/`.

POST row 6 cannot read `cron.job` where pg_cron is off, so it only says
which. With pg_cron on, confirm the job:
`select jobname, schedule, command from cron.job where jobname = 'mm-usage-purge';`
— one row, `17 2 * * *`. With it off, schedule `select public.fn_usage_purge();`
nightly yourself, or the 90 days are a promise the database does not keep.

**Migration before the app.** The app tolerates 0069 being missing — every
beat, event and rating call ignores its error, and the admin pages say they
need 0069 — but "Write to us" would tell people their message did not send.

## Rollback

`0069_rollback.sql` unschedules the purge, drops the six indexes, and
**deletes every recorded visit and event, every help request, every rating,
and who turned recording off** (export them first; the queries are in the
file's header). It leaves 106 `fn_*` (111 with 0067). Roll 0069 back before
0068: 0068's rollback refuses while 0069 is in.

**If 0069 is applied again after a rollback, restore the objections in the
same transaction** (`psql --single-transaction -f 0069… -f restore_objections.sql`,
spelled out in the rollback's header): the app stays live, and an objection
under NDPA s.36 must not be recorded over, even for a minute.

## Rehearsal results (27 Oct 2026)

| Item | Result |
|---|---|
| `PRE_DEPLOY_0069.sql` on 0066 without 0068 | 3/5, refuses (rows 1–2) as it should |
| `PRE_DEPLOY_0069.sql` on 0068 | 5/5 PASS |
| apply on 0068 | `0069 OK` (106 → 118 fn_*) |
| apply again | refused by its preflight |
| apply without `--single-transaction` | refused by the guard |
| `POST_VERIFY_0069.sql` | 7/7 PASS |
| then 0067 on top | PRE 12/12, `0067 OK`, POST 13/13; 0069 POST still 7/7 |
| 0067 rollback with 0069 in; 0068 rollback with 0069 in | OK; refused ("Roll 0069 back first") |
| 0069 rollback, 0068 rollback | both OK (118 → 106 → 102 fn_*) |
| 0067 → 0068 → 0069 | all OK (102 → 107 → 111 → 123), POST 0069 7/7, POST 0067 13/13 |
| `tests/055_usage_and_help.sql` | **51/51** (after two rounds of review fixes) |
| all SQL suites on a fresh build with 0067, 0068 and 0069 | 53 suites, **1281 pass, 0 fail** |
| the first-step reads (EXPLAIN) | an index-only scan of each new index |
| `e2e/journey-usage.mjs` | **37/37** (told first; screens, setup steps, Help, a refusal, a low rating kept, Live now, Journeys, a journey, Help & feedback, Mark done, the switch, the privacy page) |
| the other journeys | main 128/128, contact 20/20, setup-nav 25/25 on the final build; sales 49/49, account 98/98, site 53/53, edit 50/50 on the build before the last layout and wording changes |
| a beat sent as the page unloads | delivered (a probe saw the visit marked hidden), though DevTools reports keepalive requests as aborted |
