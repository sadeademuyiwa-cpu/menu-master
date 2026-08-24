# 0019c — classification

**0019c is an explicit repair for orphaned foreign infrastructure. It is NOT
part of the Menu Master schema design.**

## What that means

`public.handle_new_user()` and the trigger `on_auth_user_created` on
`auth.users` were **not created by any Menu Master migration**. They appear in
no file in `migrations/0001`–`0018`, and `on_auth_user_created` appears in zero
chain files. They were left behind by a previous, unrelated application that
used this same Supabase project and owned a `vendors` table. That application's
schema is gone; the hook it installed on `auth.users` is not, because dropping
a schema does not drop a trigger in `auth`.

0019c exists solely to stop that orphan from breaking signup. It is remediation
of someone else's leftover, not a design decision of ours.

## Menu Master's actual signup architecture is unchanged by this

Menu Master **does not use an `auth.users` trigger and does not need one**.
After authentication succeeds, the client calls
`fn_create_account_and_business`, which pins the owner membership to
`auth.uid()` and clones the starter catalogue with names and units only. That
design predates this repair and is unaffected by it.

If this project were deployed to a clean Supabase project tomorrow, **0019c
would be unnecessary** — there would be no foreign hook to neutralise. It must
therefore never be treated as part of the baseline schema, never folded into
the `0001`–`0018` chain, and never included in `deploy/PART_*`.

## Why it neutralises the function instead of removing the trigger

`C2_TRIGGER_AUTHORITY.sql` on production returned:

```
auth.users owner ........... supabase_auth_admin   current role owns it: NO
handle_new_user owner ...... postgres              current role owns it: YES
```

`DROP TRIGGER` and `ALTER TABLE ... DISABLE TRIGGER` both require ownership of
the **table**, which this role does not have. Both were verified to fail with
`must be owner of relation users` on a replica reproducing that exact split.

Replacing a function body requires ownership of the **function** only — an
ordinary privilege already held. No escalation, no workaround, and `auth.users`
is not touched at all.

## Superseded proposals, kept on record

- `0019a_disable_foreign_signup_hook.sql` — `ALTER TABLE auth.users DISABLE
  TRIGGER`. **Impossible**: requires table ownership.
- `0019b_remove_foreign_signup_hook.sql` — `DROP TRIGGER` + `DROP FUNCTION`.
  **Impossible** for the same reason.

Both remain unmodified as the record of a route that production privileges
ruled out.

## The proper long-term fix is not ours to make

The trigger itself still exists and still fires; it simply calls a function that
does nothing. Removing it outright requires `supabase_auth_admin`, which means
Supabase support or a platform-level action. That is worth doing eventually for
cleanliness, but it is not required for correctness and is not blocking.
