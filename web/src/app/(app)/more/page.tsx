import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { currentContext, contextRedirect } from '@/lib/data/context'
import { isPlatformAdmin } from '@/lib/data/admin'
import { loadSiteSettings } from '@/lib/data/site'
import { PageHeader, SectionHeading, ActionTile } from '@/components/ui'
import { Button } from '@/components/button'
import { signOut } from '@/lib/auth-actions'
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
      { href: '/subscribe', label: 'Plans & billing', icon: 'card', meta: 'Your trial and your plan' },
      { href: '/settings', label: 'Costs & targets', icon: 'settings' },
      { href: '/settings/people', label: 'People', icon: 'people' },
      { href: '/reports', label: 'Reports', icon: 'reports' },
      { href: '/account', label: 'Account', icon: 'account' },
    ],
  },
]

/** The guided setup, reopened: owners and managers only (it is theirs to change). */
const SETUP_GUIDE: LinkItem = { href: '/start', label: 'Setup guide', icon: 'check', meta: 'See or change your setup answers' }

async function MorePageBody() {
  const ctx = await currentContext()
  const { accountId } = ctx
  if (!accountId) redirect(contextRedirect(ctx, '/more'))

  const [admin, site] = await Promise.all([isPlatformAdmin(), loadSiteSettings()])
  const canSetUp = ctx.role === 'owner' || ctx.role === 'manager'
  const base: Group[] = GROUPS.map((g) =>
    g.title === 'Business' && canSetUp ? { ...g, links: [g.links[0], SETUP_GUIDE, ...g.links.slice(1)] } : g)
  const groups: Group[] = admin
    ? [...base, { title: 'Platform', links: [{ href: '/admin', label: 'Administration', icon: 'admin' }] }]
    : base
  // The support number the admin set for the website (Admin → Website).
  const help = site.landing.whatsapp
    ? `https://wa.me/${site.landing.whatsapp}?text=${encodeURIComponent('Hello, I need help with Menu Master')}`
    : null

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
      {help && (
        <section className="space-y-2.5">
          <SectionHeading>Help</SectionHeading>
          <a href={help} target="_blank" rel="noopener noreferrer" className="mm-btn mm-btn-secondary w-full sm:w-auto">
            Ask us on WhatsApp
          </a>
        </section>
      )}
      <form action={signOut}>
        <Button variant="secondary" className="w-full sm:w-auto" busyLabel="Signing out…">Sign out</Button>
      </form>
    </div>
  )
}

export default function MorePage() {
  return <Suspense fallback={<Loading />}><MorePageBody /></Suspense>
}
