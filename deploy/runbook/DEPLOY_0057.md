# DEPLOYMENT RUNBOOK — 0057 (website settings: pixels, landing page, privacy policy, company details, Google sign-in switch)

> ## ⛔ NOT AUTHORISED UNTIL YOU RUN IT. Nothing here has touched production.

Expected starting state: **0056 applied**, 117 policies, 92 `fn_*` functions,
at least one platform admin (`GRANT_PLATFORM_ADMIN.sql`).

## What changes

| Adds | Policies | Customer rows touched |
|---|---|---|
| `site_settings` (five rows: `analytics`, `landing`, `privacy`, `company`, `signin`), readable by anyone — columns `key`, `value`, `updated_at` only, never `updated_by`; `fn_admin_set_site_setting` (refuses a non-admin with `42501`); `ix_fk_site_settings_updated_by` (every foreign key stays covered) | 117 → **118** | none |

`fn_*` count 92 → 93. This is the first table since the five reference
tables that a logged-out visitor may read, on purpose: it is the public
website. Test 009 pins that column grant exactly. **Never store a secret in
it** — every value ends up in public page source.

## The app before and after

The web app reads `site_settings` and falls back when it is missing, so the
code can be deployed before or after this migration:

| | before 0057 | after 0057 |
|---|---|---|
| Pixels | none load | whatever Admin → Website says, after cookie consent |
| `/privacy` | the bundled draft | the saved policy (the draft until saved) |
| Landing page | drawn example, no testimonials | admin's pictures, testimonials, WhatsApp |
| Admin → Website | "not available on this database yet (0057)" | the three editors |

## Order of operations

| # | Artefact | Where | Writes? |
|---|---|---|---|
| 1 | `PRE_DEPLOY_0057.sql` | SQL Editor | no |
| 2 | `migrations/proposed/0057_site_settings.sql` | **psql only** | yes |
| 3 | `POST_VERIFY_0057.sql` | SQL Editor | no |
| — | `migrations/rollbacks/0057_rollback.sql`, only if 3 fails | psql | yes |

```
psql "<session-pooler connection string>" --single-transaction -v ON_ERROR_STOP=1 \
     -f migrations/proposed/0057_site_settings.sql
```

Expect **PRE 6/6**, `NOTICE: 0057 OK: …`, **POST 8/8**. Same transaction
guard as 0049–0056; it refuses the SQL Editor.

After POST passes, `git mv` the file from `proposed/` to `migrations/`.

## Rehearsed

On a local copy built with `scripts/setup_db.ps1 -WithProposed` (through
0058): all 42 SQL suites pass (906 checks); `0058_rollback.sql` then
`0057_rollback.sql` return to 0056 and both re-apply cleanly. Browser:
`web/e2e/journey-site.mjs` (37 checks).

## Rollback

`0057_rollback.sql` drops the function and the table. Whatever the admin
saved is lost — copy the privacy policy text out of Admin → Website first.
The website then falls back to the bundled defaults (left column above).
