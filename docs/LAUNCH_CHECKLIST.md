# Launch checklist — from this branch to running ads

Everything below is in the order it should be done. Each step says where it
happens and how to know it worked. Steps marked **after deploy** need the new
code live first.

Production facts this assumes (checked 2 October 2026): the database is at
migration **0056**; Supabase project `mgbrrrjxbufstsjrdoug`; site
`https://menumasterng.com`; Vercel builds branch
`chatgpt/frontend-redesign-20260911-224439` on push, so **a push to that
branch is a production deploy**.

This work lives on its own branch, `launch/2026-10-02`, branched from that
one. Going live means merging it into the production branch; undoing means
reverting that merge (or redeploying the previous deployment in Vercel).

---

## 1. Before going live

- [ ] **Vercel → Settings → Environment Variables (Production):**
      `NEXT_PUBLIC_SITE_URL` = `https://menumasterng.com`. Leave
      `NEXT_PUBLIC_SENTRY_DSN` unset for now.
- [ ] Optional: open the Vercel **preview** of branch `launch/2026-10-02`
      and click through it first. It uses the same Supabase project as
      production if the preview environment has the same variables.

## 2. Merge into the production branch (deploys the app)

The app works on a 0056 database: with 0057–0059 not yet applied, it shows
no pixels, the bundled privacy policy, the landing page without pictures, and
Admin → Website says the settings are not available yet.

- [ ] Merge `launch/2026-10-02` into `chatgpt/frontend-redesign-20260911-224439`
      and push. Wait for the Vercel deployment to finish.
- [ ] Open `https://menumasterng.com` signed out: the landing page shows.
      Signed in: it goes to the dashboard.

## 3. Supabase → Authentication → URL Configuration

- [ ] Site URL: `https://menumasterng.com`
- [ ] Redirect URLs: `https://menumasterng.com/**` and `https://www.menumasterng.com/**`

## 4. Email that lands in the inbox (Resend)

- [ ] Resend → Domains → add `menumasterng.com`; copy the SPF, DKIM and MX
      records it shows into your DNS **exactly**; wait for "Verified".
- [ ] DNS: TXT record, host `_dmarc`, value `v=DMARC1; p=none;`
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

- [ ] `DEPLOY_0057.md` — website settings (pixels, landing content, privacy
      policy). PRE 6/6 → migration → POST 8/8.
- [ ] `DEPLOY_0058.md` — trial reminder emails. PRE 5/5 → migration → POST 6/6.
- [ ] `DEPLOY_0059.md` — picture uploads (Storage bucket `site`). PRE 5/5 →
      migration → POST 4/4.
- [ ] After each POST passes, `git mv` the file from `migrations/proposed/`
      to `migrations/`.

## 6. Trial reminder emails (edge function)

- [ ] `supabase functions deploy trial-reminder-mailer --no-verify-jwt`
- [ ] Secrets (Edge Function secret store only): `RESEND_API_KEY`,
      `MAILER_TOKEN` (shared with the alert mailer, 16+ random characters),
      `TRIAL_EMAIL_FROM` = `Menu Master NG <hello@menumasterng.com>`,
      `SITE_URL` = `https://menumasterng.com`, optional `SUPPORT_EMAIL`.
- [ ] Supabase → Integrations → Cron: hourly at `20 * * * *`,
      `POST https://mgbrrrjxbufstsjrdoug.functions.supabase.co/trial-reminder-mailer`
      with header `x-mailer-token: <MAILER_TOKEN>`.
- [ ] `POST_VERIFY_0058.sql` row 5 says how many the first run sends.

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
