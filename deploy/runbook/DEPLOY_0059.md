# DEPLOYMENT RUNBOOK — 0059 (website pictures: upload from Admin → Website)

> ## ⛔ NOT AUTHORISED UNTIL YOU RUN IT. Nothing here has touched production.

Expected starting state: **0058 applied**, 118 policies in `public`.

## What changes

| Adds | Policies in `public` | Customer rows touched |
|---|---|---|
| Storage bucket `site` — **public** (anyone may open a file by its address: these are the website's own pictures), PNG/JPEG/WebP only (no SVG: it can carry script), 2 MB each; four policies on `storage.objects` (`mm_site_insert/update/delete/select`), each limited to bucket `site` and `fn_is_platform_admin()` | 118 → 118 | none |

After this, Admin → Website shows **Upload a picture** beside the logo, the
main picture and each screenshot. Uploading fills in the address; nothing
changes on the website until **Save landing page**. Before 0059 the button
says uploads are not set up and the admin can still paste a link.

## Order of operations

| # | Artefact | Where | Writes? |
|---|---|---|---|
| 1 | `PRE_DEPLOY_0059.sql` | SQL Editor | no |
| 2 | `migrations/proposed/0059_site_images.sql` | **psql only** | yes |
| 3 | `POST_VERIFY_0059.sql` | SQL Editor | no |
| — | `migrations/rollbacks/0059_rollback.sql`, only if 3 fails | psql | yes |

Expect **PRE 5/5**, `NOTICE: 0059 OK: …`, **POST 4/4**.

If the project refuses the `insert into storage.buckets` (the whole
migration then rolls back), create the bucket in Supabase → Storage instead
— name `site`, **Public bucket** on, file size limit 2 MB, allowed MIME
types `image/png, image/jpeg, image/webp` — and run the migration again: it
updates an existing bucket to the same settings and adds the policies.

## Rehearsed

Locally, against the shim's minimal `storage` tables (tests/0000_local_supabase_shim.sql)
carrying the same four policies: `tests/045_site_images.sql` — an admin can
upload to `site` and nowhere else; a customer cannot upload, replace,
delete or list; a logged-out caller cannot upload. The local gateway's
Storage stand-in writes each upload's row as the calling user, so
`web/e2e/journey-site.mjs` exercises the same policies through the browser:
upload, save, the logo shown on the landing page, and a customer's session
refused with 403.

## Rollback

`0059_rollback.sql` removes the four policies; nobody can upload any more.
The bucket and its files stay (the landing page may still show them, and
Supabase does not allow deleting storage rows from SQL). To remove them,
take the pictures off the landing page, then empty and delete the bucket in
Supabase → Storage.
