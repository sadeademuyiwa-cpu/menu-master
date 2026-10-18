import Link from 'next/link'
import { PageHeader, Card, SectionHeading } from '@/components/ui'

/** How a Costing plan gets Sales, with the web's billing switch on, and off. */
const SWITCH_SELF = 'The account owner can switch plan on Plans & billing. The new plan starts the day you pay.'
const SWITCH_MESSAGE_US =
  'To change plan, message us. We switch it over for you so you are never charged twice. ' +
  'The new plan starts the day you pay.'

/**
 * What a Costing-only subscriber sees where Sales would be.
 *
 * The database already refuses these writes, and that refusal is the security
 * boundary -- this changes nothing about it. What it changes is that the
 * product no longer offers a Record a Sale form to someone whose plan cannot
 * record a sale. Presenting a button that is guaranteed to fail is not a
 * safety feature; it is a broken promise with a helpful error message.
 *
 * How to get Sales follows the web's billing safety switch (integration
 * decision X4, BILLING_SELF_SERVE exactly "on"): a Costing plan already pays,
 * so switching it is self-serve only while the switch is on. Off -- or not
 * said -- it is the message-us sentence, as on Plans & billing.
 */
export function SalesLocked({ planName, price, selfServe = false }: {
  planName?: string | null
  price?: string | null
  /** The web's billing switch is on (BILLING_SELF_SERVE === 'on'), read on the server. */
  selfServe?: boolean
}) {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Sales"
        sub="Recording sales is part of Costing + Sales."
      />

      <Card>
        <SectionHeading>Your plan does not include Sales</SectionHeading>
        <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>
          {planName ? `You are on ${planName}, which covers` : 'Your plan covers'}{' '}
          recipe costing, ingredient prices, margins and menu pricing. Recording
          what you actually sold — orders, customers and channels — is part of
          Costing + Sales.
        </p>
        <p className="mt-3 text-sm" style={{ color: 'var(--mm-muted)' }}>
          {price ? `Costing + Sales is ${price} a month. ` : ''}
          {selfServe ? SWITCH_SELF : SWITCH_MESSAGE_US} Everything you have already entered
          stays exactly as it is.
        </p>
        <p className="mt-4 text-sm">
          <Link href="/subscribe" className="mm-btn mm-btn-primary">
            See Costing + Sales
          </Link>
        </p>
      </Card>

      <Card>
        <SectionHeading>What you can still do</SectionHeading>
        <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>
          If you have recorded sales before, they are still here and still
          readable — changing plan never hides your own history. You simply
          cannot record new ones until Sales is on your plan.
        </p>
      </Card>
    </div>
  )
}
