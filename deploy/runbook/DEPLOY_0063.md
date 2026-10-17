# DEPLOYMENT RUNBOOK — 0063 (dish photos: her own food on every dish)

> ## ⛔ NOT AUTHORISED UNTIL YOU RUN IT. Nothing here has touched production.

Expected starting state: **0062 applied**, 118 policies in `public`, 98 `fn_*`
functions, the four `mm_site_*` storage policies from 0059.

*Applied on production 17 October 2026, followed by 0064. Re-running
`POST_VERIFY_0063.sql` once 0064 is in fails row 6 alone, reading 99 `fn_*`:
0064 adds `fn_menu_prices`. That is expected; `POST_VERIFY_0064.sql` checks
the 99.*
Phase 2 of `branding/09-uiux/04-simplify-plan.md`; the owner's decision 2
(16 Oct 2026): dish photos are **public by link, with unguessable names**.

## What changes

| | |
|---|---|
| `recipes.photo_path` | new nullable text column: the storage name of the dish's photo, or NULL. Check `ck_recipes_photo_path`: starts with the dish's own `business_id` and `/`, has something after it, no `..`, at most 200 characters. The app writes `<business_id>/<recipe_id>/<random>.<webp\|jpg>` and a thumbnail beside it with `-320` before the extension |
| Storage bucket `dish` | **public** (a photo opens by its address; the random name is what keeps it from being found), JPEG and WebP only, 512 KB per file |
| `mm_dish_insert / update / delete` | on `storage.objects`, bucket `dish` only, keyed on the object's first folder (a business id): a member of that business's account whose role is **owner, manager or kitchen**, on an **entitled** account. The same three conjuncts as `p_recipes_update` (0015/0028), built from the same helpers, so whoever may change a dish may change its photo, and nobody else |
| `mm_dish_select` | listing the bucket through the API: any member of that business's account. Not gated on entitlement (reads never are, 0028) |
| Policies in `public` | 118 → **118** |
| `fn_*` | 98 → **98** |
| Customer rows | none written; every dish starts with no photo |

Writing `recipes.photo_path` needs no new policy: it rides on the existing
recipes UPDATE policy, which already lets owner, manager and kitchen edit a
dish on an entitled account. Sales and accountant can see photos and cannot
change them.

## What the owner sees

Nothing, until the app version with photos is deployed. Then:

- On a dish, **Add a photo**: she picks the picture she already posted on
  WhatsApp, the phone shrinks it (about 120 KB, and a 15 KB thumbnail) and it
  appears on the sale screen, the dish list, Home and the dish page.
- A dish without a photo keeps its green tile with initials.
- Her manager and kitchen can add or change photos; sales staff and the
  accountant see them but cannot change them.
- If the subscription lapses, the photos stay visible; new ones cannot be added
  until it is renewed, exactly like editing a dish.

## Order of operations

| # | Artefact | Where | Writes? |
|---|---|---|---|
| 1 | `PRE_DEPLOY_0063.sql` | SQL Editor | no |
| 2 | `migrations/proposed/0063_dish_photos.sql` | **psql only** | yes |
| 3 | `POST_VERIFY_0063.sql` | SQL Editor | no |
| — | `migrations/rollbacks/0063_rollback.sql`, only if 3 fails | psql | yes |

```
psql "<session-pooler connection string>" --single-transaction -v ON_ERROR_STOP=1 \
     -f migrations/proposed/0063_dish_photos.sql
```

Expect **PRE 9/9**, `NOTICE: 0063 OK: …`, **POST 7/7**. Same transaction
guard as 0049–0062; it refuses the SQL Editor. After POST passes, `git mv`
the file from `proposed/` to `migrations/`. Then 0064 (`DEPLOY_0064.md`).

**0063 goes on production before the app that reads `photo_path` is
deployed.** An app that selects the column from a database without it fails
to load Home, Dishes and New sale.

If the project refuses the `insert into storage.buckets` (the whole
migration then rolls back), create the bucket in Supabase → Storage instead
— name `dish`, **Public bucket** on, file size limit 512 KB, allowed MIME
types `image/jpeg, image/webp` — and run the migration again: it updates an
existing bucket to the same settings and adds the policies. PRE row 8 then
reads FAIL with `exists: public=true`; that is the one expected exception.

## Storage and privacy

About 135 KB per dish (photo and thumbnail). 1,000 businesses with 30 dishes
each is about 4 GB; check it against the Supabase Pro storage allowance before
promoting photos widely. Anyone holding the exact address can open a photo; the
name carries 128 random bits, so it cannot be guessed, and the bucket cannot
be listed from outside the business. The app is to shrink each photo on the
phone, which re-encodes it and drops its location data, and the picker is to
say "Photograph the food, not people." Check both on the preview before
deploying.
Receipt photos, if they are ever built, go in a separate private bucket.

## Rollback

Roll the app back first, then (if 0064 is applied) `0064_rollback.sql`, then
`0063_rollback.sql`. It removes the four `mm_dish_*` policies, the check and
the column: which photo belongs to which dish is lost; nobody can upload,
replace or list any more. An **empty** bucket is removed with it, so a rollback
straight after the deploy leaves exactly the 0062 state. A bucket that already
holds photos is kept (Supabase does not allow deleting storage rows from SQL):
empty and delete it in Supabase → Storage. The rollback refuses to run while
0064 is still applied.

## Rehearsal results (16 Oct 2026, repository-built databases, 0001→0064)

| Item | Result |
|---|---|
| `PRE_DEPLOY_0063.sql` on a fresh 0062 build (`mm62`) | 9/9 PASS |
| apply on a copy of `mm62` | `0063 OK` |
| `POST_VERIFY_0063.sql` on the 0063 database | 7/7 PASS |
| apply without `--single-transaction` | refused by the guard; nothing left behind |
| `tests/049_dish_photos.sql` | **30/30** |
| rollback 0064 → 0063 on a copy | `0063 rollback OK: back at 0062. Bucket "dish" removed (it was empty).` Schema dump identical to `mm62`; 118 / 4 storage / 98 `fn_*` / 1 bucket |
| rollback with a photo stored | bucket kept with a notice; re-apply 0063 + 0064 afterwards `OK` |
| rollback 0063 while 0064 is applied | refused: "Run 0064_rollback.sql first." |
| full suite run (`scripts/run_suites.ps1 -Template mm64`) | 48 suites, **1013 pass, 0 fail**, 2 skipped by design. 046-048 now run at their own era (0060/0061/0062): each asserts "98 `fn_*`", which 0064 moves to 99 |
