# Email that lands in the inbox: SPF, DKIM and DMARC for menumasterng.com

Emails from menumasterng.com were landing in spam (2 October 2026). Every
email the product sends goes through **Resend** from that domain:

- sign-up confirmations and password resets (Supabase Auth, through
  Resend's SMTP);
- the trial reminder emails (`trial-reminder-mailer`, through Resend's API);
- the admin alert digest (`platform-alert-mailer`).

So one set of DNS records fixes all three. You need about 45 minutes, plus
up to a day for DNS to settle, plus 2 to 4 weeks of watching before the last
step.

Owner decision (18 October 2026): DMARC reports go to
**dmarc@menumasterng.com**, an alias forwarded to your Gmail. Start at
`p=none`; move to `p=quarantine` after 2 to 4 clean weeks.

**Safety rules for every DNS change below**

- Only **add** records, or edit the one named. Never delete an existing
  record you do not recognise, and never change the **MX records of the root
  domain** (`menumasterng.com` itself) if a mailbox already uses them.
- A name may have **only one SPF record** (a TXT starting `v=spf1`). Resend's
  SPF lives on `send.menumasterng.com`, not on the root, so it never clashes
  with one already on the root.
- Copy Resend's values **exactly** from Resend's screen, not from this page.
  They differ per domain and per region.

---

## Step 1. Find where the DNS is managed

In PowerShell:

```powershell
Resolve-DnsName -Type NS menumasterng.com -Server 8.8.8.8
```

- Name servers ending in `vercel-dns.com`: records are added in **Vercel →
  (team) → Domains → menumasterng.com → DNS Records → Add**.
- Anything else: at that company's DNS panel (usually the registrar where
  the domain was bought).

Most panels want the **host** without the domain: `send`, not
`send.menumasterng.com`. If a panel adds the domain itself and you type it
too, you get `send.menumasterng.com.menumasterng.com`, which never works.

## Step 2. The domain in Resend (SPF and DKIM)

resend.com → **Domains**.

- `menumasterng.com` is probably already there: Resend only sends from a
  verified domain, and sign-up emails do arrive. Open it and check every
  record shows **Verified** (green). If they do, go to step 3.
- If it is not there: **Add Domain** → `menumasterng.com` → pick the region
  nearest your users (Europe, Ireland) → Resend shows the records.

The records Resend shows look like this (values are examples):

| Type | Host | Value | What it does |
|---|---|---|---|
| TXT | `resend._domainkey` | `p=MIGfMA0GCSq…` (long) | **DKIM**: signs each email so Gmail can tell it really came from you |
| MX | `send` | `feedback-smtp.<region>.amazonses.com`, priority `10` | bounce handling for the sending address |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | **SPF**: says Resend's servers may send for `send.menumasterng.com` |

Add each one in the DNS panel from step 1, then in Resend press **Verify
DNS records**. Verification can take from minutes to a few hours.

Check from PowerShell (`-Server 8.8.8.8` asks Google, not your own cache):

```powershell
Resolve-DnsName -Type TXT resend._domainkey.menumasterng.com -Server 8.8.8.8
Resolve-DnsName -Type TXT send.menumasterng.com             -Server 8.8.8.8
Resolve-DnsName -Type MX  send.menumasterng.com             -Server 8.8.8.8
```

Each must answer with the value Resend shows.

## Step 3. The dmarc@ alias, forwarded to Gmail

Do this before the DMARC record, so the first reports have somewhere to go.

```powershell
Resolve-DnsName -Type MX menumasterng.com -Server 8.8.8.8
```

- **MX records come back** (for example Zoho, Google Workspace, Namecheap
  Private Email, ImprovMX, Cloudflare): the domain already receives mail
  there. In that provider, create the alias `dmarc@menumasterng.com` (or a
  forwarding rule) to your Gmail address. Do not touch the MX records.
- **No MX records** (the domain only sends): add free forwarding. With
  ImprovMX (improvmx.com, free plan), for example:
  1. Sign up with your Gmail address and add the domain `menumasterng.com`.
  2. Add the two MX records it shows **on the root** (host `@` or blank),
     typically `mx1.improvmx.com` priority 10 and `mx2.improvmx.com`
     priority 20. These do not affect Resend's records on `send`.
  3. Create the alias `dmarc` → your Gmail address.
  4. While you are there, also forward `hello` (the sender address) and the
     address in `SUPPORT_EMAIL`, so owners who reply to an email reach you.

Test: from any other mailbox, send a short email to
`dmarc@menumasterng.com`. It must arrive in your Gmail within a few minutes.

In Gmail, make a filter so the reports do not fill your inbox: Search
`to:dmarc@menumasterng.com` → **Create filter** → **Skip the Inbox** and
**Apply the label** "DMARC reports".

## Step 4. The DMARC record (start at p=none)

In the DNS panel, look for an existing TXT record with host `_dmarc`
(the launch checklist once suggested `v=DMARC1; p=none;`). **Edit** it if it
exists; add it if not. There must be only one.

| Type | Host | Value |
|---|---|---|
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@menumasterng.com` |

- `p=none` asks receivers to deliver as usual and only report. Nothing
  changes for your emails yet.
- `rua=` is where the daily reports go. Because the address is on the same
  domain, no extra permission record is needed.

Check:

```powershell
Resolve-DnsName -Type TXT _dmarc.menumasterng.com -Server 8.8.8.8
```

## Step 5. Every sender uses the domain

All three senders must send **from an address @menumasterng.com**, or the
records above do not cover them:

| Where | Setting | Must be |
|---|---|---|
| Supabase → Project Settings → Authentication → SMTP | sender email | `hello@menumasterng.com` (name "Menu Master NG") |
| Supabase → Edge Functions → Secrets | `TRIAL_EMAIL_FROM` | `Menu Master NG <hello@menumasterng.com>` |
| Supabase → Edge Functions → Secrets | `ALERT_EMAIL_FROM` (if the alert mailer is set up) | an address @menumasterng.com |

Also check that the sign-up and password-reset templates
(`deploy/email/confirm-signup.html`, `reset-password.html`, launch checklist
§4) are pasted into Supabase → Authentication → Emails. Their links point at
menumasterng.com; links to a different domain than the sender's count
against an email.

## Step 6. Test with Gmail

1. Go to `https://menumasterng.com/forgot-password` and ask for a reset link
   for a **Gmail** address that has a Menu Master login.
2. In Gmail, open the email. If it is in Spam, note that, then open it there.
3. Press **⋮ (More) → Show original**. The table at the top must say:

   | Line | Must say |
   |---|---|
   | SPF | **PASS** |
   | DKIM | **'PASS'** with domain **menumasterng.com** |
   | DMARC | **'PASS'** |

4. If any line says FAIL or NEUTRAL, go back to the record it names (DKIM:
   step 2's TXT; SPF: step 2's `send` records; DMARC: step 4). DNS changes
   can take a few hours to reach Google.

All three PASS but still in Spam: give it a few days of normal sending, and
ask the first few recipients to press **Not spam**. A brand-new sending
domain earns its reputation slowly. The trial emails travel the same way,
so the same records cover them; check one trial email the same way when the
first ones go out (`SCHEDULE_TRIAL_MAILER.md` step 7).

An optional second opinion: mail-tester.com gives a one-off address; sign up
for Menu Master with that address and open its report, which scores SPF,
DKIM, DMARC and the content.

## Step 7. After 2 to 4 clean weeks: p=quarantine

Each day, Google, Microsoft, Yahoo and others send a small report (a zipped
XML file) to `dmarc@`. Open a few over the weeks; a free viewer such as
dmarcian's "DMARC XML to Human" makes them readable. The reports list
sending servers and counts only, never email contents.

"Clean" means: every source in the reports is Resend's sending service
(Amazon SES addresses) with **DKIM pass** and **SPF pass**, and nothing you
do not recognise fails. If something you use fails (for example a mailbox
that sends "as" hello@menumasterng.com from somewhere else), fix that sender
first.

Then edit the same `_dmarc` record:

| Type | Host | Value |
|---|---|---|
| TXT | `_dmarc` | `v=DMARC1; p=quarantine; rua=mailto:dmarc@menumasterng.com` |

`p=quarantine` tells receivers to put mail that fails these checks in spam,
which stops anyone faking emails from menumasterng.com. Your own emails are
unaffected because they pass. To go more gently, use `p=quarantine; pct=25`
for a week first. Repeat the Gmail test (step 6) the day after.

## If something goes wrong

- **Real emails start landing in spam after step 7:** set the `_dmarc`
  record back to `p=none`. It takes effect as DNS refreshes (usually within
  an hour).
- **Resend says a record is not found:** check the host was not doubled
  (step 1), and give DNS a few hours.
- **Never delete** the DKIM or SPF records while anything is sending: every
  email would fail its checks at once, including sign-up confirmations.

## Write it down

In `docs/LAUNCH_CHECKLIST.md` §4, tick each line with the date, and note the
date you moved to `p=quarantine`.
