# Production auth.users — handling decision (2026-08-24)

**Five `auth.users` rows exist in production.** Created 2026-08-10 to
2026-08-14, all confirmed, all with a successful sign-in, one returning the
following day. Domains: gmail.com ×4, yahoo.ca ×1.

**Owner's determination: it is not known whether these are test accounts or
real prospects.**

## Standing instruction

**Treat all five as potentially real users.**

Do **not** delete, modify, merge, reset, ban, soft-delete, re-confirm, alter
metadata on, or otherwise change any of them. Do not alter them to make a check
pass, to simplify a migration, or to tidy state. This applies to every future
stage of this project until the owner says otherwise in writing.

## What is known about them

- They hold **no** row in `profiles` or `memberships`, and there are 0
  `accounts`, so none of them has a Menu Master tenant.
- They are therefore **stranded**: authenticated, but with nothing to use.
- They are **recoverable** — their auth identities are intact and nothing
  references them, so once signup is repaired each can create a tenant by
  calling `fn_create_account_and_business` on next login.
- Nothing about them blocks PART_5, which was validated with all five present
  on both PostgreSQL 16.13 and 17.6.

## Consequences to respect

- The Part 5 preflight baselines `auth.users` at **exactly 5**. If it ever
  reports a different number, that is a signal to investigate, **never** a
  reason to adjust the users to match the baseline.
- Any future remediation touching these rows requires explicit, separate
  authorisation.
- If they turn out to be real prospects, they signed up and got nothing. That
  is a customer-communication question for the owner, not a technical one, and
  it is recorded here so it is not forgotten.
