import Link from 'next/link'
import { Notice } from '@/components/ui'
import { UsePrice } from '@/components/use-price'
import { setPrice } from '@/lib/actions/set-price'
import { money, percent } from '@/lib/format'
import { priceState } from '../../pricing/price-rows'
import { charged } from './charged'
import { n, type Blocker, type PriceCheck } from './types'

// ---------------------------------------------------------------------------
// The money on a dish page. Every figure here is read from v_price_check or
// the dish's own cost snapshot -- none is divided out on the page -- and the
// page renders these only for the roles that may see costs (canSeeCosts),
// having left the figures out of its queries for everyone else.
// ---------------------------------------------------------------------------

/**
 * A dish's (or one size's) state, in the words Home and the Dishes list use.
 * The state is v_product_attention's own rule (priceState in pricing/price-rows
 * is that CASE): a margin under the target is "Below your target" here too, so
 * a dish Home sends her to fix is not called fine when she gets here. Null
 * while the cost is incomplete or there is no price yet: the page says those
 * itself, and never with a margin.
 */
export type DishVerdict = {
  state: 'losing_money' | 'below_target' | 'healthy'
  label: string
  tone: 'bad' | 'warn' | 'good'
  sentence: string
}

export function dishVerdict(
  row: Pick<PriceCheck, 'is_complete' | 'selling_price' | 'profit' | 'margin_pct' | 'target_margin'> | null | undefined,
): DishVerdict | null {
  if (!row) return null
  const state = priceState(row)
  const target = n(row.target_margin)
  switch (state) {
    case 'losing_money':
      return { state, label: 'Selling at a loss', tone: 'bad', sentence: 'You are selling this for less than it costs you to make.' }
    case 'below_target':
      return { state, label: 'Below your target', tone: 'warn', sentence: `Under your ${percent(target)} target.` }
    case 'healthy':
      return { state, label: 'Healthy margin', tone: 'good', sentence: target !== null ? `At or above your ${percent(target)} target.` : '' }
    default:
      return null
  }
}

/** A verdict's colour: the word and its dot, not a number. */
export function verdictColour(tone: DishVerdict['tone'] | undefined): string {
  return tone === 'good' ? 'var(--mm-accent)'
    : tone === 'warn' ? 'var(--mm-warn)'
    : tone === 'bad' ? 'var(--mm-bad)'
    : 'var(--mm-fg)'
}

const muted = { color: 'var(--mm-muted)' }

/** "● Healthy margin" in its own colour, with the margin small beside it. */
export function VerdictWord({ verdict, marginPct }: { verdict: DishVerdict | null; marginPct: number | null }) {
  if (!verdict) return null
  const colour = verdictColour(verdict.tone)
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px]">
      <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: colour }} />
      <span className="font-semibold" style={{ color: colour }}>{verdict.label}</span>
      {marginPct !== null && <span className="mm-num" style={muted}>· {percent(marginPct)}</span>}
    </span>
  )
}

function FigureRow({ label, children, sub, first = false }: {
  label: string
  children: React.ReactNode
  sub?: React.ReactNode
  first?: boolean
}) {
  return (
    <div className={`flex items-start justify-between gap-3 py-3 ${first ? 'pt-0' : 'border-t'}`}
         style={{ borderColor: 'var(--mm-line)' }}>
      <dt className="pt-1.5 text-[11px] font-semibold uppercase tracking-[0.08em]" style={muted}>{label}</dt>
      <dd className="min-w-0 text-right">
        <div className="mm-num text-2xl font-semibold leading-tight">{children}</div>
        {sub && <div className="mt-0.5 text-[13px]" style={muted}>{sub}</div>}
      </dd>
    </div>
  )
}

const absent = (words: string) => <span className="mm-absent text-base font-normal">{words}</span>

/**
 * Cost per portion, you sell it for, you keep: one line each, big figures.
 * Shown only once the costing is complete; until then the "Cost incomplete"
 * notice stands in its place and no cost figure appears at all.
 */
export function MoneyCard({ costLabel, cost, costSub, price, keep, verdict, marginPct }: {
  costLabel: string
  cost: number | null
  costSub?: React.ReactNode
  /** Null: no price yet. Undefined: this dish is not sold on its own. */
  price?: number | null
  keep?: number | null
  verdict?: DishVerdict | null
  marginPct?: number | null
}) {
  return (
    <section aria-label="What it costs and what you keep" className="mm-card">
      <dl>
        <FigureRow first label={costLabel} sub={costSub}>{cost !== null ? money(cost) : absent('not known yet')}</FigureRow>
        {price !== undefined && (
          <FigureRow label="You sell it for">{price !== null ? charged(price) : absent('no price yet')}</FigureRow>
        )}
        {price !== undefined && (
          <FigureRow
            label="You keep"
            sub={verdict ? <VerdictWord verdict={verdict} marginPct={marginPct ?? null} /> : undefined}
          >
            {keep !== null && keep !== undefined
              ? <span style={{ color: verdict ? verdictColour(verdict.tone) : undefined }}>{money(keep)}</span>
              : absent(price === null ? 'set a price first' : 'not known yet')}
          </FigureRow>
        )}
      </dl>
    </section>
  )
}

export type SizeMoney = {
  variantId: string
  name: string
  complete: boolean
  cost: number | null
  price: number | null
  keep: number | null
  marginPct: number | null
  verdict: DishVerdict | null
}

/**
 * A dish sold in sizes: one short row per size, "you keep" as the figure and
 * the cost and price under it. Each size is costed from the same batch by
 * v_price_check.
 */
export function SizesMoneyCard({ sizes }: { sizes: SizeMoney[] }) {
  if (sizes.length === 0) return null
  return (
    <section aria-label="What each size costs and what you keep" className="mm-card">
      <ul>
        {sizes.map((z, i) => (
          <li key={z.variantId} className={`py-3 ${i === 0 ? 'pt-0' : 'border-t'} ${i === sizes.length - 1 ? 'pb-0' : ''}`}
              style={{ borderColor: 'var(--mm-line)' }}>
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0">
                <span className="block font-semibold">{z.name}</span>
                <span className="mm-num mt-0.5 block text-[13px]" style={muted}>
                  {z.complete && z.cost !== null ? <>Costs {money(z.cost)}</> : <span className="mm-absent">Cost incomplete</span>}
                  {' · '}
                  {z.price !== null ? <>sells for {charged(z.price)}</> : 'no price yet'}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.08em]" style={muted}>You keep</span>
                <span className="mm-num block text-xl font-semibold leading-tight">
                  {z.keep !== null
                    ? <span style={{ color: z.verdict ? verdictColour(z.verdict.tone) : undefined }}>{money(z.keep)}</span>
                    : absent(z.price === null ? 'no price yet' : 'not known yet')}
                </span>
                <VerdictWord verdict={z.verdict} marginPct={z.marginPct} />
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * What a sales member sees: what the dish sells for, from fn_menu_prices
 * (0064), which returns selling prices and nothing worked out from a cost.
 */
export function SalesPrices({ dishPrice, sizes }: {
  dishPrice: number | null
  sizes: { variantId: string; name: string; price: number | null }[]
}) {
  return (
    <section aria-label="What it sells for" className="mm-card">
      {sizes.length === 0 ? (
        <dl><FigureRow first label="You sell it for">{dishPrice !== null ? charged(dishPrice) : absent('no price yet')}</FigureRow></dl>
      ) : (
        <dl>
          {sizes.map((z, i) => (
            <FigureRow key={z.variantId} first={i === 0} label={z.name}>
              {z.price !== null ? charged(z.price) : absent('no price yet')}
            </FigureRow>
          ))}
        </dl>
      )}
    </section>
  )
}

/**
 * THE REFUSAL. Never ₦0 -- a named, actionable blocker, in the words the
 * dish page has always used, with each fix one tap away.
 *
 * Not "{priced} of {required} items". The engine counts inputs the owner
 * cannot see on this screen -- for a dish, portion size is a required input
 * (0007), so two visible ingredients read as "2 of 3" and the third item is
 * unfindable. The count below is the length of the list directly under it,
 * so every number on screen can be accounted for by something also on screen.
 */
export function MissingNotice({ blockers, idByName }: {
  blockers: Blocker[]
  idByName: Map<string, string>
}) {
  return (
    <Notice>
      <p className="font-medium">
        {blockers.length === 1
          ? 'Cost incomplete — one thing is still missing.'
          : `Cost incomplete — ${blockers.length} things are still missing.`}
      </p>
      <ul className="mt-2 space-y-2">
        {blockers.map((b, i) => {
          const fixId = idByName.get(b.ingredient_name ?? b.item ?? '')
          return (
            <li key={i} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span>
                {b.problem === 'missing_price' &&
                  <>Cost incomplete — <strong>{b.ingredient_name ?? b.item}</strong> has no purchase price.</>}
                {b.problem === 'missing_conversion' &&
                  <>Cost incomplete — tell us how much one <strong>{b.unit_code ?? 'measure'}</strong> of{' '}
                    <strong>{b.ingredient_name ?? b.item}</strong> weighs.</>}
                {b.problem === 'missing_portion_size' &&
                  <>Cost incomplete — say how much one portion is, under <strong>Edit this dish</strong> below.</>}
                {!['missing_price', 'missing_conversion', 'missing_portion_size'].includes(b.problem) &&
                  <>Cost incomplete — {b.problem.replace(/_/g, ' ')}.</>}
              </span>
              {b.problem === 'missing_price' && fixId && (
                <Link href={`/purchases/new?ingredient=${fixId}`} className="mm-btn mm-btn-secondary shrink-0 text-sm">
                  Enter what you paid
                </Link>
              )}
              {b.problem === 'missing_conversion' && fixId && (
                <Link href={`/ingredients/${fixId}`} className="mm-btn mm-btn-secondary shrink-0 text-sm">
                  Tell us its size
                </Link>
              )}
            </li>
          )
        })}
      </ul>
      <p className="mt-2 text-xs">
        Menu Master will not show a cost it cannot stand behind, and it will
        never treat a missing price as nothing.
      </p>
    </Notice>
  )
}

/**
 * "Charge ₦1,450 to keep 40%", with the button that does it: for a dish
 * below its target or selling at a loss, the same two states Home offers
 * "Use ₦X" for. The figure is v_price_check.recommended_price, worked out by
 * the database from her own cost and her own target. Rendered only for
 * canSetPrices; the page does not read the figure for anyone else. The figure
 * is a price she is about to save, so it reads to the kobo when it has kobo.
 */
export function DishFix({ recipeId, dishName, verdict, suggested, target, returnTo }: {
  recipeId: string
  dishName: string
  verdict: DishVerdict
  /** Null when there is no target to work a price out from: a loss is still said. */
  suggested: number | null
  target: number | null
  returnTo: string
}) {
  const offer = suggested !== null && suggested > 0 && target !== null
  return (
    <Notice>
      <p>
        <strong style={{ color: verdict.tone === 'bad' ? 'var(--mm-bad)' : undefined }}>{verdict.label}.</strong>{' '}
        {verdict.tone === 'bad' && <>{verdict.sentence} </>}
        {offer && <>Charge <span className="mm-num font-semibold">{charged(suggested)}</span> to keep {percent(target)}.</>}
      </p>
      {offer && (
        <div className="mt-3">
          <UsePrice recipeId={recipeId} price={suggested} dishName={dishName} action={setPrice}
                    returnTo={returnTo} note={`That keeps your ${percent(target)} target.`} />
        </div>
      )}
    </Notice>
  )
}

/** The same fix for a dish sold in sizes: one button for every size under target. */
export function SizesFix({ recipeId, dishName, sizes, returnTo }: {
  recipeId: string
  dishName: string
  sizes: { variantId: string; name: string; suggested: number; target: number | null; verdict: DishVerdict }[]
  returnTo: string
}) {
  if (sizes.length === 0) return null
  if (sizes.length === 1) {
    const z = sizes[0]
    return (
      <Notice>
        <p>
          <strong style={{ color: z.verdict.tone === 'bad' ? 'var(--mm-bad)' : undefined }}>{z.name}: {z.verdict.label}.</strong>{' '}
          Charge <span className="mm-num font-semibold">{charged(z.suggested)}</span> to keep {percent(z.target)}.
        </p>
        <div className="mt-3">
          <UsePrice recipeId={recipeId} variantId={z.variantId} price={z.suggested}
                    dishName={`${dishName} (${z.name})`} action={setPrice} returnTo={returnTo}
                    note={`That keeps your ${percent(z.target)} target.`} />
        </div>
      </Notice>
    )
  }
  return (
    <Notice>
      <p>
        <strong>{sizes.length} sizes are under your target.</strong>{' '}
        {sizes.map((z) => `${z.name} ${charged(z.suggested)}`).join(', ')}.
      </p>
      <div className="mt-3">
        <UsePrice recipeId={recipeId} dishName={dishName} action={setPrice} returnTo={returnTo}
                  sizes={sizes.map((z) => ({ variantId: z.variantId, size: z.name, price: z.suggested }))} />
      </div>
    </Notice>
  )
}
