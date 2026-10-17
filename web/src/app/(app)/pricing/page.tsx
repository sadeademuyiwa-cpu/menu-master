import { Suspense } from 'react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentContext, contextRedirect } from '@/lib/data/context'
import { PageHeader, Empty, BackLink } from '@/components/ui'
import { UsePrice } from '@/components/use-price'
import { setPrice } from '@/lib/actions/set-price'
import { money, percent } from '@/lib/format'
import { parentTab } from '@/lib/nav'
import { canSeeCosts, canSetPrices, canSeeSellingPrices } from '@/lib/pricing'
import { stateDot } from '../recipes/_list/dish-figures'
import {
  priceRows, inFilter, offersPrice, sharedTarget, num,
  type PriceCheckRow, type PriceFilter, type PriceRow,
} from './price-rows'
import Loading from './skeleton'
import '../recipes/_list/lists.css'

export const dynamic = 'force-dynamic'

const FILTERS: { key: PriceFilter; label: string }[] = [
  { key: '', label: 'All' },
  { key: 'low', label: 'Below your target' },
  { key: 'none', label: 'No price' },
]

/**
 * Every size a business sells, with what it costs, what it sells for and what
 * one keeps. Under Dishes now (lib/nav.ts), so its back link goes there.
 *
 * Who sees what is decided here, on the server:
 *   owner, manager, accountant   cost, price and keep, a dot, and "Use ₦X"
 *                                where a better price is suggested
 *                                (v_price_check, which returns nothing to
 *                                anyone else)
 *   sales                        what each one sells for (fn_menu_prices,
 *                                0064), nothing derived from a cost
 *   kitchen                      neither
 */
async function PricingPageBody({ f: rawFilter }: { f: string }) {
  const ctx = await currentContext()
  if (!ctx.accountId) redirect(contextRedirect(ctx, '/pricing'))
  const tab = parentTab('/pricing')
  const back = tab && <BackLink href={tab.href}>{tab.label}</BackLink>

  if (canSeeCosts(ctx.role)) {
    const { data } = await ctx.supabase.from('v_price_check')
      .select('recipe_id,name,variant_id,format_name,channel_id,channel_name,is_complete,cost_per_portion,selling_price,profit,margin_pct,recommended_price,target_margin,commission_pct')
      .order('name').returns<PriceCheckRow[]>()
    return (
      <CostPrices
        back={back}
        rows={priceRows(data ?? [])}
        filter={rawFilter === 'low' || rawFilter === 'none' ? rawFilter : ''}
        setsPrices={canSetPrices(ctx.role)}
      />
    )
  }

  if (canSeeSellingPrices(ctx.role) && ctx.businessId) {
    const [{ data: recipes }, { data: variants }, prices] = await Promise.all([
      ctx.supabase.from('recipes').select('id,name').eq('kind', 'dish').is('deleted_at', null).order('name')
        .returns<{ id: string; name: string }[]>(),
      ctx.supabase.from('recipe_variants')
        .select('id,format:serving_formats!fk_recipe_variants_format(name)').eq('is_active', true)
        .returns<{ id: string; format: { name: string } | null }[]>(),
      // Before 0064, or on any error, there are simply no prices to show.
      // business_id must be in the select for the filter on it to work.
      ctx.supabase.rpc('fn_menu_prices').select('business_id,recipe_id,variant_id,selling_price')
        .eq('business_id', ctx.businessId)
        .then(({ data }) => (Array.isArray(data)
          ? data as { recipe_id: string; variant_id: string | null; selling_price: string | number | null }[]
          : [])),
    ])
    const sizeName = new Map((variants ?? []).map((v) => [v.id, v.format?.name ?? null]))
    const rank = new Map((recipes ?? []).map((r, i) => [r.id, i]))
    const nameOf = new Map((recipes ?? []).map((r) => [r.id, r.name]))
    const seen = new Set<string>()
    const items = prices
      .filter((p) => {
        const k = `${p.recipe_id}:${p.variant_id ?? ''}`
        if (seen.has(k) || !nameOf.has(p.recipe_id)) return false
        seen.add(k)
        return true
      })
      .map((p) => {
        const size = p.variant_id ? sizeName.get(p.variant_id) ?? null : null
        return { key: `${p.recipe_id}:${p.variant_id ?? ''}`, recipeId: p.recipe_id,
          label: size ? `${nameOf.get(p.recipe_id)}, ${size}` : nameOf.get(p.recipe_id) ?? '',
          price: num(p.selling_price), order: rank.get(p.recipe_id) ?? 0, size: size ?? '' }
      })
      .sort((a, b) => a.order - b.order || a.size.localeCompare(b.size))
    return (
      <div className="space-y-5">
        {back}
        <PageHeader title="Prices" sub="What each dish sells for. Prices are set by the owner, a manager or the accountant." />
        {items.length === 0 ? (
          <Empty>No dish has a price yet.</Empty>
        ) : (
          <ul className="mm-rows" data-cols="2">
            {items.map((i) => (
              <li key={i.key}>
                <Link href={`/recipes/${i.recipeId}`} className="mm-row" data-size="short">
                  <span className="mm-row-main mm-row-name">{i.label}</span>
                  {i.price !== null
                    ? <span className="mm-row-end">{money(i.price)}</span>
                    : <span className="mm-absent shrink-0 text-sm">No price yet</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {back}
      <PageHeader title="Prices" />
      <Empty>Prices are kept by the owner, a manager or the accountant.</Empty>
    </div>
  )
}

function CostPrices({ back, rows, filter, setsPrices }: {
  back: React.ReactNode
  rows: PriceRow[]
  filter: PriceFilter
  setsPrices: boolean
}) {
  const shown = rows.filter((r) => inFilter(r, filter))
  const target = sharedTarget(rows)
  // Commission is stored but does not enter these figures yet (audit item 27).
  // Saying so once is required wherever one is set: an unlabelled number that
  // changes nothing would mislead.
  const commissions = [...new Map(rows
    .filter((r) => (num(r.commission_pct) ?? 0) > 0)
    .map((r) => [r.channel_id ?? '', { name: r.channel_name ?? 'A channel', pct: num(r.commission_pct) }])).values()]

  return (
    <div className="space-y-5">
      {back}
      <div className="space-y-1">
        <PageHeader
          title="Prices"
          sub="A size with any missing cost gets no keep and no suggested price. That is deliberate: Menu Master does not guess."
        />
        {target !== null && (
          <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>
            Your target is to keep {percent(target)} of each price.{' '}
            <Link href="/settings" className="mm-inline-tap">Change</Link>
          </p>
        )}
      </div>

      {rows.length > 0 && (
        <nav className="mm-chips" aria-label="Show sizes">
          {FILTERS.map((c) => (
            <Link key={c.key || 'all'} href={c.key ? `/pricing?f=${c.key}` : '/pricing'} className="mm-chip"
              aria-current={filter === c.key ? 'page' : undefined}>
              {c.label} <span className="mm-chip-count">{rows.filter((r) => inFilter(r, c.key)).length}</span>
            </Link>
          ))}
        </nav>
      )}

      {rows.length === 0 ? (
        <Empty>Nothing to price yet. Add a dish and what goes into it, and its cost and price show here.</Empty>
      ) : shown.length === 0 ? (
        <Empty>
          {filter === 'low' ? 'Nothing is below your target.' : 'Every size has a price.'}{' '}
          <Link href="/pricing" className="mm-inline-tap">Show all</Link>
        </Empty>
      ) : (
        <div className="mm-table-card">
          <table className="mm-price-table">
            <thead>
              <tr>
                <th scope="col">Size</th>
                <th scope="col" className="mm-cell-num hidden sm:table-cell">Cost</th>
                <th scope="col" className="mm-cell-num">Price</th>
                <th scope="col" className="mm-cell-num hidden sm:table-cell">Keep</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const dot = stateDot(r.state)
                const offer = setsPrices ? offersPrice(r) : null
                const keep = num(r.profit)
                return (
                  <tr key={r.key}>
                    <td>
                      <Link href={`/recipes/${r.recipe_id}`} className="mm-cell-name">
                        <span className="mm-dot" data-tone={dot.tone} role="img" aria-label={dot.label} title={dot.label} />
                        <span className="min-w-0">{r.label}</span>
                      </Link>
                      {offer !== null && (
                        <UsePrice
                          recipeId={r.recipe_id}
                          variantId={r.variant_id}
                          price={offer}
                          dishName={r.format_name ? `${r.name} (${r.format_name})` : r.name}
                          action={setPrice}
                          returnTo="/pricing"
                          note={target !== null ? `That keeps your ${percent(target)} target.` : undefined}
                          // Secondary, not quiet: this is the page's main action, and the
                          // quiet pill is 40px, under the 44px a thumb needs.
                          variant="secondary"
                          className="mb-2"
                        />
                      )}
                    </td>
                    <td className="mm-cell-num hidden sm:table-cell">
                      <span className="mm-cell-line">
                        {r.is_complete ? money(r.cost_per_portion) : <span className="mm-absent">not known yet</span>}
                      </span>
                    </td>
                    <td className="mm-cell-num font-semibold">
                      <span className="mm-cell-line">
                        {num(r.selling_price) !== null ? money(r.selling_price) : <span className="mm-absent font-normal">No price yet</span>}
                      </span>
                    </td>
                    <td className="mm-cell-num hidden sm:table-cell">
                      <span className="mm-cell-line">
                        {keep !== null ? money(keep)
                          : <span className="mm-absent">{r.is_complete ? 'no price yet' : 'not known yet'}</span>}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {commissions.map((c) => (
        <p key={c.name} className="text-xs" style={{ color: 'var(--mm-muted)' }}>
          {c.name} takes {percent(c.pct)} commission. These figures do not count it yet.
        </p>
      ))}
    </div>
  )
}

// The body streams behind an in-page boundary -- never a route-level
// loading.tsx, which stalls server-action redirects (see components/skeleton.tsx).
export default async function PricingPage(props: { searchParams: Promise<{ f?: string }> }) {
  const { f = '' } = await props.searchParams
  return <Suspense fallback={<Loading />}><PricingPageBody f={f} /></Suspense>
}
