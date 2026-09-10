# migrations/proposed

Only migrations that are **authored, rehearsed and not yet applied to
production** live here. A file moves to `migrations/` when its `POST_VERIFY`
passes on production, and not before.

`scripts/setup_db.sh <db> --with-proposed` builds a database that includes
these, so a migration's acceptance suite can run in CI before it ships
(`tests/MANIFEST`: `requires=NNNN`).

Never-applied alternatives live in `migrations/superseded/`.
