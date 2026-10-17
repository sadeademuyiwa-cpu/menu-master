import { Suspense } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentContext, contextRedirect } from '@/lib/data/context'
import { isPlatformAdmin } from '@/lib/data/admin'
import { loadSiteSettings } from '@/lib/data/site'
import { PageHeader, ActionTile } from '@/components/ui'
import { Button } from '@/components/button'
import { signOut } from '@/lib/auth-actions'
import { localToday } from '@/lib/dates'
import { canSeeSellingPrices } from '@/lib/pricing'
import type { IconName } from '@/components/icons'
import Loading from '../skeleton'

export const dynamic = 'force-dynamic'

type LinkItem = { href: string; label: string; icon: IconName; meta?: string }

/**
 * Everything that is not a daily tap: six tiles for an owner, five for staff.
 * Customers, Price per head, Ingredients, Suppliers, Sizes and Prices used to
 * sit here too; each now lives under the tab it belongs to (lib/nav.ts), which
 * lights up and is where its back link goes.
 */
const TILES: LinkItem[] = [
  { href: '/settings', label: 'Settings', icon: 'settings', meta: 'Paid work, monthly bills, your target' },
  { href: '/settings/people', label: 'People', icon: 'people' },
  { href: '/reports', label: 'Reports', icon: 'reports' },
  { href: '/subscribe', label: 'Plans & billing', icon: 'card', meta: 'Your trial and your plan' },
  { href: '/account', label: 'Account', icon: 'account' },
]

/** The guided setup, reopened: owners and managers only (it is theirs to change). */
const SETUP_GUIDE: LinkItem = { href: '/start', label: 'Setup guide', icon: 'check', meta: 'See or change your answers' }

/**
 * The "Moved" note shows for a few weeks after the tools moved, then goes by
 * itself. Owners who knew where Customers was find it in one tap meanwhile.
 * Only an account opened before MOVED_ON ever saw those tools on More;
 * telling a newer one they "moved" would send her looking for a layout she
 * never had.
 */
const MOVED_ON = '2026-10-17'
const MOVED_UNTIL = '2026-12-15'

/**
 * Where each tool went, one row per tab, so every name is its own 44px link
 * and no line of the note is stretched to fit a link inside a sentence.
 * `prices`: a page about selling prices, which kitchen never sees
 * (lib/pricing.ts). A kitchen member is not sent to a page that only tells
 * her so -- the same rule that hides Prices on the Dishes tab.
 */
const MOVED: { tab: string; tools: { href: string; label: string; prices?: true }[] }[] = [
  { tab: 'Sales', tools: [{ href: '/customers', label: 'Customers' }, { href: '/quote', label: 'Price per head', prices: true }] },
  { tab: 'Purchases', tools: [{ href: '/ingredients', label: 'Ingredients' }, { href: '/suppliers', label: 'Suppliers' }] },
  { tab: 'Dishes', tools: [{ href: '/formats', label: 'Sizes' }, { href: '/pricing', label: 'Prices', prices: true }] },
]

async function MorePageBody() {
  const ctx = await currentContext()
  const { accountId } = ctx
  if (!accountId) redirect(contextRedirect(ctx, '/more'))

  const [admin, site, opened] = await Promise.all([
    isPlatformAdmin(),
    loadSiteSettings(),
    ctx.supabase.from('accounts').select('created_at').eq('id', accountId)
      .maybeSingle<{ created_at: string }>().then((r) => r.data?.created_at ?? null),
  ])
  const canSetUp = ctx.role === 'owner' || ctx.role === 'manager'
  const tiles: LinkItem[] = [
    ...TILES,
    ...(canSetUp ? [SETUP_GUIDE] : []),
    ...(admin ? [{ href: '/admin', label: 'Administration', icon: 'admin' } as LinkItem] : []),
  ]
  // The support number the admin set for the website (Admin → Website).
  const help = site.landing.whatsapp
    ? `https://wa.me/${site.landing.whatsapp}?text=${encodeURIComponent('Hello, I need help with Menu Master')}`
    : null
  // An account whose opening date cannot be read is not told anything moved.
  const showMoved = opened !== null && localToday(new Date(opened)) < MOVED_ON && localToday() <= MOVED_UNTIL
  const seesPrices = canSeeSellingPrices(ctx.role)
  const moved = MOVED
    .map((g) => ({ ...g, tools: g.tools.filter((t) => !t.prices || seesPrices) }))
    .filter((g) => g.tools.length > 0)

  return (
    <div className="space-y-5">
      <PageHeader title="More" />

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((l) => (
          <ActionTile key={l.href} href={l.href} icon={l.icon} label={l.label} meta={l.meta} />
        ))}
      </div>

      {showMoved && (
        <section aria-labelledby="more-moved" className="text-sm" style={{ color: 'var(--mm-muted)' }}>
          <p id="more-moved" className="font-semibold" style={{ color: 'var(--mm-fg)' }}>Moved to other tabs</p>
          <ul>
            {moved.map((g) => (
              <li key={g.tab} className="flex flex-wrap items-center gap-x-2">
                <span>Under {g.tab}:</span>
                {g.tools.map((t, i) => (
                  <span key={t.href} className="inline-flex items-center gap-x-2">
                    {i > 0 && <span>and</span>}
                    <Moved href={t.href}>{t.label}</Moved>
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </section>
      )}

      {help && (
        <a href={help} target="_blank" rel="noopener noreferrer" className="mm-btn mm-btn-secondary w-full sm:w-auto">
          Ask us on WhatsApp
        </a>
      )}
      <form action={signOut}>
        <Button variant="secondary" className="w-full sm:w-auto" busyLabel="Signing out…">Sign out</Button>
      </form>
    </div>
  )
}

/** A name in the "Moved" note, a full 44px tall on its own row. */
function Moved({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} className="mm-inline-tap font-medium" style={{ color: 'var(--mm-accent)' }}>{children}</Link>
}

export default function MorePage() {
  return <Suspense fallback={<Loading />}><MorePageBody /></Suspense>
}
