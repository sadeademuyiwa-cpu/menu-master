import { LEGAL } from '@/lib/legal'
import { legalEntityWords, type CompanyDetails } from '@/lib/site/settings'

/**
 * The privacy policy shown until the admin saves their own (0057), and the
 * text the admin's editor starts from.
 *
 * Written against the Nigeria Data Protection Act 2023 for a food-business
 * owner to read on a phone. It is the owner's DRAFT to review, not legal
 * advice. Every service named here is one the product actually uses; the
 * advertising and analytics tools run only after a visitor accepts cookies.
 */
export const PRIVACY_DRAFT_DATE = '2026-10-02'

/**
 * Built from the company details the admin has entered (Admin -> Website).
 * A detail not entered yet is left out or put in neutral words, so the draft
 * never shows a placeholder. Fill the company details in first, then use
 * "Start again from the draft" to pick them up.
 */
export function privacyDraft(company: CompanyDetails): string {
  const L = LEGAL
  const runBy = legalEntityWords(company) + (company.address ? `, ${company.address}` : '')
  const contact = company.supportEmail ?? 'the contact details on our website'
  return `## Who we are
${L.productName} (${L.website}) is run by ${runBy}. We decide how the personal data described here is used, and we are responsible for it under the Nigeria Data Protection Act 2023 (NDPA). Write to us at ${contact} about anything in this policy.

## What we collect
- Your account: your email address and a password (stored only in scrambled form by our sign-in provider). If you sign in with Google, we receive your name and email address from Google.
- Your business: its name, type and the details you choose to add.
- What you record: purchases, prices, recipes, sales, and the names and phone numbers of your customers if you enter them.
- Billing: your plan, payment status and the payment reference. Card details go straight to Paystack; we never see or store them.
- How you use the service: pages opened, device and browser type, IP address, and, if you accept cookies, the advert or link that brought you to us.

## Why we use it
- To run your account and give you the service you signed up for (performing our contract with you).
- To take payment and keep billing records (contract, and our legal duty to keep accounts).
- To keep the service secure and fix problems (our legitimate interest in a safe, working product).
- To send you emails about your account, your trial and your payments. We send marketing only if you agree, and every marketing email lets you stop.
- To measure which adverts bring people to us and improve the product, only if you accept cookies (consent). You can say no and still use everything.

## Your customers' details
When you record your own customers' names or phone numbers, you decide why and how they are used, and we process them only to provide the service to you. Please tell your customers how you use their details.

## Who we share it with
We share personal data only with the companies that help us run the service, and only what each needs:
- Supabase: hosts our database and sign-in.
- Vercel: hosts the website.
- Paystack: takes payments.
- Resend: sends our emails.
- Sentry: tells us when something breaks, so we can fix it. Error reports carry no cookies, IP address or email address.
- Google: sign-in with Google, if you choose it.
- Meta (Facebook and Instagram), Google Ads, Google Analytics and PostHog: advert measurement and product analytics, only if you accept cookies.

Some of these companies store data outside Nigeria. Where they do, we rely on the safeguards the NDPA allows, such as their contractual data-protection commitments. We do not sell your personal data.

## How long we keep it
We keep your account and records for as long as your account is open, so you can always read what you entered. If you ask us to delete your account, we delete your records within 30 days, except billing records we must keep for tax and accounting, which we keep for six years. Cookie and analytics data is kept for up to 13 months.

## Your rights
Under the NDPA you may ask us to:
- give you a copy of your personal data;
- correct anything that is wrong;
- delete your data, or stop using it for a purpose;
- move your data to another service;
- stop using it for marketing or advert measurement, and withdraw your consent at any time.

Write to us at ${contact}. We reply within 30 days. If you are not satisfied, you may complain to the Nigeria Data Protection Commission (ndpc.gov.ng).

## Cookies
We use cookies that keep you signed in and remember your choices; the service cannot work without them. Advert and analytics cookies (Meta Pixel, Google Ads, Google Analytics, PostHog) are set only after you press Accept on the cookie notice. To change your mind, clear this site's cookies in your browser and choose again.

## Keeping it safe
Your data is sent over encrypted connections, each business's records are separated from every other business's in the database, and only the people you invite can see your account.

## Children
${L.productName} is for businesses and is not meant for anyone under 18.

## Changes to this policy
If we change this policy in a way that matters, we will tell you by email or in the app before the change takes effect. The date at the top shows when it last changed.`
}
