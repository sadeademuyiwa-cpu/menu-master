import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentContext } from '@/lib/data/context'
import { PageHeader, Card, SectionHeading } from '@/components/ui'

export const dynamic = 'force-dynamic'

/**
 * Everything that is not a daily action. Five items fit a 360px bar at a
 * legible size; ten did not, and the labels ran into each other. These live
 * here rather than being dropped, and each is also linked from the screen it
 * belongs to.
 */
const GROUPS = [
  {
    title: 'Selling',
    sub: 'How your food reaches a customer.',
    links: [
      { href: '/customers', label: 'Customers', hint: 'Who you cook for, and what they are worth to you.' },
      { href: '/formats', label: 'The sizes you sell in', hint: 'Bowls, tubs, packs, trays.' },
      { href: '/pricing', label: 'Your prices', hint: 'What you charge, and what it earns you.' },
    ],
  },
  {
    title: 'Buying',
    sub: 'Where your costs come from.',
    links: [
      { href: '/ingredients', label: 'Ingredients', hint: 'What you cook with, and what it costs.' },
      { href: '/suppliers', label: 'Suppliers and markets', hint: 'Who you buy from.' },
    ],
  },
  {
    title: 'Your business',
    sub: 'Settings and records.',
    links: [
      { href: '/settings', label: 'Costs and targets', hint: 'Paid work, monthly bills, target margin.' },
      { href: '/reports', label: 'Reports', hint: 'How the business is doing over time.' },
      { href: '/account', label: 'Account and plan', hint: 'Your login and subscription.' },
    ],
  },
]

export default async function MorePage() {
  const { accountId } = await currentContext()
  if (!accountId) redirect('/onboarding')

  return (
    <div className="space-y-6">
      <PageHeader title="More" sub="Everything else, grouped by what it is for." />
      {GROUPS.map((g) => (
        <section key={g.title} className="space-y-3">
          <SectionHeading sub={g.sub}>{g.title}</SectionHeading>
          <ul className="space-y-2">
            {g.links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="block">
                  <Card>
                    <div className="font-medium">{l.label}</div>
                    <div className="mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>{l.hint}</div>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
