# Launch checklist — from this branch to running ads

Everything below is in the order it should be done. Each step says where it
happens and how to know it worked. Steps marked **after deploy** need the new
code live first.

Production facts this assumes (checked 2 October 2026): the database is at
migration **0056**; Supabase project `mgbrrrjxbufstsjrdoug`; site
`https://menumasterng.com`. Vercel's **production branch is
`claude/menu-master-ng-migrations-3faerm`** — every production deployment so
far came from it (latest: 182ba18, "Redesign customer frontend…"). Pushes to
any other branch, including `chatgpt/frontend-redesign-20260911-224439`,
only make previews.

This work lives on its own branch, `launch/2026-10-02`, branched from
`chatgpt/frontend-redesign-20260911-224439` at 9ac532e. That means it also
carries **9ac532e "Handle historical Paystack plans safely"**, which is not
live yet. Going live means merging `launch/2026-10-02` into the production
branch (a fast-forward from 182ba18); undoing means Vercel → Deployments →
the previous production deployment → **Promote to Production** (instant
rollback), then reverting the merge.

Preview of this branch (built and checked 2 October 2026; Vercel login
needed): `https://menu-master-git-launch-2026-10-02-menu-master.vercel.app`

> **Status on 18 October 2026.** A ticked box below is one the repository
> itself proves, and it names the commit or record. An unticked box is
> **unconfirmed**, not necessarily undone: dashboards, DNS and settings
> leave no trace in the repository. Proven so far:
>
> - The launch branch reached the production branch: this clone's push
>   record for `origin/claude/menu-master-ng-migrations-3faerm` shows
>   `f8d5022` pushed on 4 October 2026 and `2b1974a` on 17 October 2026.
> - The database is at **0064**: 0057-0059 applied on 3 October
>   (`f8d5022`), 0060-0062 on 12 October (`cc4367e`), 0063-0064 on
>   17 October (`2b1974a`).
>
> Whether the trial reminder emails go out is **unknown**: see §6.

---

## 1. Before going live

- [ ] **Vercel → Settings → Environment Variables (Production):**
      `NEXT_PUBLIC_SITE_URL` = `https://menumasterng.com`. Leave
      `NEXT_PUBLIC_SENTRY_DSN` unset for now.
- [ ] Optional: click through the **preview** (link above) first. It uses
      the same Supabase project as production if the preview environment has
      the same variables, so test with a throwaway account.

## 2. Merge into the production branch (deploys the app)

The app works on a 0056 database: with 0057–0059 not yet applied, it shows
no pixels, the bundled privacy policy, the landing page without pictures, and
Admin → Website says the settings are not available yet.

- [x] On GitHub: open a pull request from `launch/2026-10-02` into
      `claude/menu-master-ng-migrations-3faerm`, read it, merge it. Wait
      for the Vercel **production** deployment to finish.
      *Done as fast-forward pushes rather than a pull request: `f8d5022`
      on 4 October 2026, latest `2b1974a` on 17 October 2026 (this clone's
      push record). `STATUS.md` (17 October) records `6e64741` live.*
- [ ] Open `https://menumasterng.com` signed out: the landing page shows.
      Signed in: it goes to the dashboard.

## 3. Supabase → Authentication → URL Configuration

- [ ] Site URL: `https://menumasterng.com`
- [ ] Redirect URLs: `https://menumasterng.com/**` and `https://www.menumasterng.com/**`

## 4. Email that lands in the inbox (Resend)

The full steps, with checks: `deploy/runbook/EMAIL_DELIVERABILITY.md`.
Do them before the trial mailer is scheduled (§6).

- [ ] Resend → Domains → add `menumasterng.com`; copy the SPF, DKIM and MX
      records it shows into your DNS **exactly**; wait for "Verified".
- [ ] The alias `dmarc@menumasterng.com`, forwarded to your Gmail
      (EMAIL_DELIVERABILITY step 3).
- [ ] DNS: TXT record, host `_dmarc`, value
      `v=DMARC1; p=none; rua=mailto:dmarc@menumasterng.com`
- [ ] Gmail "Show original" on a password-reset email: SPF, DKIM and DMARC
      all **PASS** (EMAIL_DELIVERABILITY step 6).
- [ ] After 2 to 4 clean weeks of reports: change the `_dmarc` value to
      `v=DMARC1; p=quarantine; rua=mailto:dmarc@menumasterng.com`
      (EMAIL_DELIVERABILITY step 7).
- [ ] Supabase → Project Settings → Authentication → SMTP: host
      `smtp.resend.com`, port `465`, username `resend`, password = a Resend
      API key, sender `hello@menumasterng.com`, sender name `Menu Master NG`.
- [ ] Supabase → Authentication → Rate Limits: raise the email limit above
      the default 30 an hour before ads run.
- [ ] **After deploy:** Supabase → Authentication → Emails — paste
      `deploy/email/confirm-signup.html` into "Confirm signup" and
      `deploy/email/reset-password.html` into "Reset password" (subjects are
      at the top of each file). The links then point at your own domain.
- [ ] Check: sign up with a Gmail address; the email arrives in the inbox,
      its link opens `/onboarding` signed in. "Forgot password?" on `/login`
      sends a link that opens "Choose a new password".

## 5. Database: 0057 → 0058 → 0059

Each has a runbook in `deploy/runbook/` with a read-only check before, the
migration (psql over the Session Pooler, `--single-transaction`), a read-only
check after, and a rollback.

- [x] `DEPLOY_0057.md` — website settings (pixels, landing content, privacy
      policy). PRE 6/6 → migration → POST 8/8.
      *Applied with psql on 3 October 2026 (`f8d5022`).*
- [x] `DEPLOY_0058.md` — trial reminder emails. PRE 5/5 → migration → POST 6/6.
      *Applied 3 October 2026; POST 6/6 (`f8d5022`).*
- [x] `DEPLOY_0059.md` — picture uploads (Storage bucket `site`). PRE 5/5 →
      migration → POST 4/4.
      *Applied 3 October 2026; POST 4/4 (`f8d5022`).*
- [x] After each POST passes, `git mv` the file from `migrations/proposed/`
      to `migrations/`. *`f8d5022`, 3 October 2026.*
- [x] Later migrations, the same way: 0060-0062 on 12 October 2026
      (`cc4367e`), 0063-0064 on 17 October 2026 (`2b1974a`).

## 6. Trial reminder emails (edge function)

0058 is applied, but nothing in the repository records that the mailer was
deployed or scheduled, so whether any trial email has ever gone out is
unknown. Check first; set up only what is missing.

- [ ] **Check (read only):** `deploy/runbook/CHECK_TRIAL_MAILER.sql` in the
      SQL Editor plus the dashboard walk in `CHECK_TRIAL_MAILER.md`. Write
      the answers in the "Mailer status" table in `DEPLOY_0058.md`.
- [ ] If anything is missing, after §4: `deploy/runbook/SCHEDULE_TRIAL_MAILER.md`
      — pg_cron and pg_net on;
      `supabase functions deploy trial-reminder-mailer --no-verify-jwt`;
      secrets `RESEND_API_KEY`, `MAILER_TOKEN` (shared with the alert
      mailer, 16+ random characters), `TRIAL_EMAIL_FROM` =
      `Menu Master NG <hello@menumasterng.com>`, `SITE_URL` =
      `https://menumasterng.com`, optional `SUPPORT_EMAIL`; the same token in
      Vault as `mm_mailer_token`.
- [ ] Schedule hourly at `20 * * * *` with `SCHEDULE_TRIAL_MAILER.sql`
      (the token is read from Vault; not the dashboard Cron form, which
      stores it in plain text).
- [ ] Watch one run at minute 20 (`SCHEDULE_TRIAL_MAILER.md` step 7).
- [x] `POST_VERIFY_0058.sql` row 5 says how many the first run sends.
      *3 October 2026: 6 owed (`f8d5022`). Today's figure:
      `CHECK_TRIAL_MAILER.sql` row 5.*
- [ ] Redeploy after the 18 October 2026 change (no guessed price when the
      founding count cannot be read; "The free trial never charges you.").

## 7. Admin → Website (after 5)

- [ ] **Company details:** legal name, RC number, address, support email —
      whatever you have; the rest can wait (the pages use neutral words for
      anything missing, never a placeholder). Save. Check `/terms`.
- [ ] **Privacy policy:** press "Start again from the draft" so it picks up
      the company details, read it, set the date, Save. Check `/privacy`.
- [ ] **Landing page:** upload the logo and a phone screenshot as the main
      picture; add screenshots and real testimonials (with permission); set
      the WhatsApp number. Save, then "See the landing page".
- [ ] **Tracking pixels:** Meta Pixel ID; Google Ads ID (AW-…) with the
      sign-up and purchase conversion labels; optionally Google Analytics
      (G-…) and PostHog. Save. A new visitor now sees the cookie notice;
      nothing loads until they press Accept.

## 8. Google sign-in (Admin → Website → Sign in with Google)

The section lists every value to paste, with Copy buttons, and shows whether
Supabase has Google switched on.

- [ ] Google Cloud → APIs & Services → Credentials → OAuth client (Web):
      the JavaScript origins and redirect URI from the admin page
      (`https://mgbrrrjxbufstsjrdoug.supabase.co/auth/v1/callback`).
- [ ] OAuth consent screen: app name Menu Master NG, the domain, privacy and
      terms links from the admin page; scopes email, profile, openid.
- [ ] Supabase → Authentication → Providers → Google: on, paste client ID
      and secret.
- [ ] Back in the admin page: the first badge reads "On in Supabase" (within
      five minutes); tick "Offer Continue with Google", Save sign-in. The
      button appears on log in and sign up only when both are on.

## 9. Error monitoring (optional)

- [ ] Create a Sentry project (Next.js), copy its DSN; Vercel:
      `NEXT_PUBLIC_SENTRY_DSN` = that DSN; redeploy. Reports carry no
      cookies, IP or email addresses.

## 10. Ads

- [ ] Meta Events Manager: the pixel receives PageView, ViewContent
      (landing), CompleteRegistration (sign-up), StartTrial (setup finished),
      InitiateCheckout, Subscribe (paid, confirmed by the database). Optimise
      for CompleteRegistration first; StartTrial once it has volume.
- [ ] Google Ads: conversions "Sign-up" and "Purchase", labels pasted in
      step 7.
- [ ] Ad links: `https://menumasterng.com/?utm_source=facebook&utm_campaign=<name>`
      (or `utm_source=google`). The source is saved with each new account
      whose owner accepts cookies.

## 11. Smoke test in production

- [ ] Signed out: landing page, `/privacy`, `/terms` open; prices show;
      no "[" placeholder anywhere.
- [ ] Sign up → confirmation email in the inbox → onboarding → setup → the
      trial bar shows "Free trial · N days left" on every page.
- [ ] More → Plans & billing → a plan → Paystack opens.
- [ ] Log out; "Forgot password?" works end to end.
- [ ] Meta Pixel Helper (browser extension): nothing before Accept; events
      after.

## 12. Answering billing messages

**Once the trial and billing release is live** (0066, 0067, the
`paystack-webhook`, `paystack-manage` and `paystack-checkout` deploys and the
web release, in the order of `deploy/runbook/DEPLOY_TRIAL_PHASE1.md`) **and
`BILLING_SELF_SERVE` is `on` in Vercel**, owners cancel (More → Account →
Cancel plan), change plan (More → Plans & billing), pay again after a failed
payment (Pay now) and update a failed card themselves. Until then, and
whenever that switch is off, they message you and you do it for them
(`BILLING_SUPPORT.md` section 10). Either way they write to you for refunds,
a copy of their records, or when something did not work.

- [ ] Read `deploy/runbook/BILLING_SUPPORT.md` once: the two switches, what
      to check and what to reply for a cancellation, a plan change, a double
      charge, a failed payment, a login on two accounts, and a copy of the
      records (sent within one working day). Its rule 5: never cancel a
      founder's subscription in Paystack by hand.
- [ ] Run `deploy/runbook/BILLING_SUPPORT_CHECKS.sql` (read only, counts
      only) once a week while plan changes and cancelling are new. Row 4
      (an old plan charged after moving) and row 6 (a possible double
      charge) are refunds to check the same day.
- [ ] Release done: `DEPLOY_TRIAL_PHASE1.md` steps 1-14 ticked, and
      `BILLING_SELF_SERVE` = `on` in Vercel (Production) since: ______
