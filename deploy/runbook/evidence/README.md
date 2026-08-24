# handle_new_user — exact production definitions

Both files are byte-exact, recovered via base64 (the SQL Editor's CSV export
mangles line endings, so text copies of these are not trustworthy).

| File | md5 | bytes | State |
|---|---|---|---|
| `handle_new_user_PRE_0019c.txt`  | `6eccc287be2c1bb645b28fbe8ccbe644` | 285 | the broken foreign hook |
| `handle_new_user_POST_0019c.txt` | `e506880513e139ce688e88f643503198` | 848 | the neutralised no-op, live |

## Why the post-0019c md5 differed from the reference build

The reference build produced `874ac8926c77b3ce65c894426cc6363c`. Production
reports `e506880513e139ce688e88f643503198`. The difference is entirely line
endings, and only inside the body: the SQL Editor converted LF to CRLF while
0019c was pasted. The header lines that `pg_get_functiondef` generates itself,
and the final newline after `$function$`, remain LF.

Semantically the two are identical. This is exactly why the post-0019c gate
reports the fingerprint but does not gate on it, and gates instead on
whitespace-immune properties: no data statement, no `vendors` reference,
returns NEW, SECURITY INVOKER, search_path pinned.

Note `pg_get_functiondef` prints no SECURITY line for the live function,
because SECURITY INVOKER is the default and only SECURITY DEFINER is emitted.
Its absence is the confirmation that the elevation was dropped.

## The rollback is unaffected

`C3_0019C_ROLLBACK.sql` restores the PRE definition and checks against
`6eccc287be2c1bb645b28fbe8ccbe644`, which has not changed.
