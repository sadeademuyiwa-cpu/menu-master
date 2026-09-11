import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { currentContext, contextRedirect } from '@/lib/data/context'
import { isPlatformAdmin } from '@/lib/data/admin'
import { PageHeader, SectionHeading, ActionTile } from '@/components/ui'
import type { IconName } from '@/components/icons'
import Loading from '../skeleton'

export const dynamic = 'force-dynamic'

type LinkItem = { href: string; label: string; icon: IconName; meta?: string }
type Group = { title: string; links: LinkItem[] }

const GROUPS: Group[] = [
  {
    title: 'Selling',
    links: [
      { href: '/customers', label: 'Customers', icon: 'customers' },
      { href: '/formats', label: 'Selling sizes', icon: 'formats' },
      { href: '/pricing', label: 'Prices', icon: 'pricing' },
    ],
  },
  {
    title: 'Buying',
    links: [
      { href: '/ingredients', label: 'Ingredients', icon: 'ingredients' },
      { href: '/suppliers', label: 'Suppliers', icon: 'supplier' },
    ],
  },
  {
    title: 'Business',
    links: [
      { href: '/settings', label: 'Costs & targets', icon: 'settings' },
      { href: '/settings/people', label: 'People', icon: 'people' },
      { href: '/reports', label: 'Reports', icon: 'reports' },
      { href: '/account', label: 'Account & plan', icon: 'account' },
    ],
  },
]

async function MorePageBody() {
  const ctx = await currentContext()
  const { accountId } = ctx
  if (!accountId) redirect(contextRedirect(ctx, '/more'))

  const groups: Group[] = (await isPlatformAdmin())
    ? [...GROUPS, { title: 'Platform', links: [{ href: '/admin', label: 'Administration', icon: 'admin' }] }]
    : GROUPS

  return (
    <div className="space-y-5">
      <PageHeader title="More" sub="Customers, ingredients, reports, settings and account tools." />
      {groups.map((g) => (
        <section key={g.title} className="space-y-2.5">
          <SectionHeading>{g.title}</SectionHeading>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {g.links.map((l) => (
              <ActionTile key={l.href} href={l.href} icon={l.icon} label={l.label} meta={l.meta} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

export default function MorePage() {
  return <Suspense fallback={<Loading />}><MorePageBody /></Suspense>
}
