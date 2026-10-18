# DEPLOYMENT RUNBOOK — 0065 (a help video for each screen)

> ## ⛔ NOT AUTHORISED UNTIL YOU RUN IT. Nothing here has touched production.

Expected starting state: **0064 applied**, 118 policies in `public`, 99 `fn_*`
functions, `site_settings` holding the five rows of 0057.

## What changes

| | |
|---|---|
| `site_settings` | a sixth row, `help`, starting `{}`: screen key → YouTube link, set from **Platform → Help videos** |
| `ck_site_settings_key` | admits `help` as well as the five keys of 0057 |
| Reading / writing | unchanged from 0057: anyone reads `key, value, updated_at` (the links are public videos, and the login screen has one); only `fn_admin_set_site_setting` writes, after `fn_require_platform_admin()` |
| Policies in `public` | 118 → **118** |
| `fn_*` | 99 → **99** |
| Customer rows | none |

## What the owner sees

Platform gains a **Help videos** tab: one box per screen, grouped as the app
is (Getting started, Every day, Dishes and prices, Buying, Selling, Your
business). Paste a YouTube link (Public or Unlisted; `youtu.be/…`,
`youtube.com/watch?v=…` and `youtube.com/shorts/…` all work) and save. That
screen then shows a green **Help** button at the top; pressing it plays the
video in a pop-up from `youtube-nocookie.com`. A screen with an empty box shows
no button.

## Order of operations

| # | Artefact | Where | Writes? |
|---|---|---|---|
| 1 | `PRE_DEPLOY_0065.sql` | SQL Editor | no |
| 2 | `migrations/proposed/0065_help_videos.sql` | **psql only** | yes |
| 3 | `POST_VERIFY_0065.sql` | SQL Editor | no |
| — | `migrations/rollbacks/0065_rollback.sql`, only if 3 fails | psql | yes |

```
psql "<session-pooler connection string>" --single-transaction -v ON_ERROR_STOP=1 \
     -f migrations/proposed/0065_help_videos.sql
```

Expect **PRE 5/5**, `NOTICE: 0065 OK: …`, **POST 5/5**. Same transaction guard
as 0049–0064. After POST passes, `git mv` the file from `proposed/` to
`migrations/`.

The app may go out before or after 0065: without the row, no screen shows a
Help button and the admin tab says 0065 is needed.

## Rollback

`0065_rollback.sql` deletes the `help` row (and the links saved in it) and
narrows the constraint back to the five keys. The app then shows no Help
button; no app rollback is needed.

## Rehearsal results (17 Oct 2026, copy of the repository-built 0064 database)

| Item | Result |
|---|---|
| `PRE_DEPLOY_0065.sql` on 0064 | 5/5 PASS |
| apply on 0064 | `0065 OK` |
| apply again | refused by its preflight |
| apply without `--single-transaction` | refused by the guard |
| `POST_VERIFY_0065.sql` | 5/5 PASS |
| `tests/043_site_settings.sql` before and after 0065 | 15/15 each |
| `tests/051_help_videos.sql` | **12/12** |
| rollback 0065 → 0064, then apply again | both OK |
