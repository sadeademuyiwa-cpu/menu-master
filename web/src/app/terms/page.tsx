import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalPage, H2 } from '@/components/legal-page'
import { LEGAL } from '@/lib/legal'

export const metadata: Metadata = { title: 'Terms of service — Menu Master NG' }

/**
 * Plain-language terms. Written to be read by a food-business owner on a
 * phone, not by a lawyer -- but every commitment here is one the product
 * actually keeps, and several are the product's own rules stated outward:
 * your data is yours, nothing is invented on your behalf, cancelling never
 * hides what you entered.
 *
 * This is the owner's draft to review, not legal advice.
 */
export default function TermsPage() {
  const L = LEGAL
  return (
    <LegalPage title="Terms of service">
      <p>
        These terms are the agreement between you and {L.legalEntity} (“we”,
        “us”), the business that operates {L.productName} at {L.website}. By
        creating an account you accept them. If you are using {L.productName}
        for a business, you confirm you may accept these terms for it.
      </p>

      <H2>1. What {L.productName} is</H2>
      <p>
        {L.productName} is software that helps a food business work out what
        its products cost to make, what to charge, and what it earns. It
        calculates only from the figures you enter. It does not use industry
        averages, benchmarks, or assumed market prices, and it will show a cost
        as incomplete rather than guess a number you did not give it.
      </p>

      <H2>2. Your account</H2>
      <p>
        You need an email address to create an account, and you are responsible
        for keeping your password private and for everything done under your
        login. Tell us at {L.supportEmail} straight away if you think someone
        else has used it. One person may hold an owner role on an account;
        other people you add are limited to the role you give them.
      </p>

      <H2>3. Your data is yours</H2>
      <p>
        Everything you enter — ingredients, prices, recipes, sales, customers —
        belongs to you. We use it only to provide the service to you, to keep
        it safe, and to meet legal duties. We do not sell it, share it with
        other businesses, or use it to build averages that other customers
        see. Each business's data is separated from every other business's at
        the database level.
      </p>
      <p>
        You can read and export what you entered at any time, including after
        a subscription ends. Changing or cancelling a plan never deletes or
        hides your own history.
      </p>

      <H2>4. Plans, trial and payment</H2>
      <p>
        New accounts start on a free trial of the full product. After it, use
        of the parts of the product that record new work requires a paid plan,
        billed monthly in Nigerian naira. Prices shown include any applicable
        tax. Payments are collected by Paystack; we never see or store your
        card details. Plans, prices, what each includes, and the terms of the
        founding-member price are set out on the plan page inside the app and
        in our <Link href="/refunds" className="underline">refunds and
        cancellation</Link> terms, which form part of these terms.
      </p>

      <H2>5. Acceptable use</H2>
      <p>
        You agree not to use {L.productName} to break the law, to attempt to
        reach another business's data, to probe or overload the service, or to
        resell it. We may suspend an account that does any of these, and will
        tell you why.
      </p>

      <H2>6. Availability and changes</H2>
      <p>
        We work to keep the service available and to give notice of planned
        downtime, but we cannot promise it will never be interrupted. We may
        change or improve features. If a change removes something you rely on,
        we will say so in advance where we reasonably can.
      </p>

      <H2>7. What we are responsible for</H2>
      <p>
        {L.productName} does arithmetic on the figures you give it. The
        figures, the prices you decide to charge, and the business decisions
        you take are yours. To the extent the law allows, we are not liable
        for loss of profit or indirect loss arising from your use of the
        service, and our total liability to you in any twelve-month period is
        limited to the amount you paid us in that period. Nothing in these
        terms limits liability that cannot be limited by law.
      </p>

      <H2>8. Ending the agreement</H2>
      <p>
        You can cancel at any time from your account page. We may end the
        agreement if you break these terms. Either way, you keep the right to
        read and export what you entered, as set out in section 3.
      </p>

      <H2>9. Law and contact</H2>
      <p>
        These terms are governed by the laws of {L.governingLaw}. Questions
        about them go to {L.supportEmail}. If we change these terms we will
        update the date at the top of this page, and for a change that affects
        what you pay or what you get we will tell you before it takes effect.
      </p>
    </LegalPage>
  )
}
