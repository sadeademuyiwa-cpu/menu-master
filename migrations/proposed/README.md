# migrations/proposed

Only migrations that are **authored but not yet applied to production** live
here. A file moves to `migrations/` when its `POST_VERIFY` passes on production.

What remains:

- `0019a_disable_foreign_signup_hook.sql`, `0019b_remove_foreign_signup_hook.sql`
  — two alternatives that were **never applied**. `0019c` was chosen and is in
  `migrations/`. Kept so the decision can be read; see
  `README_0019c_CLASSIFICATION.md`.
