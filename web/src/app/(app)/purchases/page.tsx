import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentContext, contextRedirect } from '@/lib/data/context'
import { PageHeader, Card, Notice, Empty, SectionHeading } from '@/components/ui'
import { AppIcon } from '@/components/icons'
import { money, purchaseReference } from '@/lib/format'
import { formatDay } from '@/lib/dates'

export const dynamic = 'force-dynamic'

type Row = {
  purchase_id: string; purchase_date: string; status: string
  reference: string | null; supplier_name: string | null
  line_count: number; total_amount: string | null
}

export default async function PurchasesPage({
  searchParams,
}: { searchParams: Promise<{ notice?: string; q?: string; all?: string }> }) {
  const { notice, q = '', all = '' } = await searchParams
  const ctx = await currentContext()
  const { supabase, accountId } = ctx
  if (!accountId) redirect(contextRedirect(ctx, '/purchases'))

  const limit = all ? 1000 : 50
  const [{ data: rows }, { data: twins }] = await Promise.all([
    // v_purchase_summary (0035). purchase_lines carries two foreign keys to
    // both ingredients and purchases, so an unhinted PostgREST embed returns
    // PGRST201 and the list silently renders zero items. The view resolves the
    // joins in SQL and sums the amounts in PostgreSQL, where money belongs.
    supabase.from('v_purchase_summary')
      .select('purchase_id,purchase_date,status,reference,supplier_name,line_count,total_amount')
      .order('purchase_date', { ascending: false }).limit(limit + 1).returns<Row[]>(),
    // fn_reverse_purchase files its bookkeeping twin as a second, empty
    // purchase. The cancelled original already says "Cancelled"; the twin
    // only read as "Cancelled · 0 items" dated today, so it is not listed.
    supabase.from('purchases').select('id').not('reverses', 'is', null)
      .returns<{ id: string }[]>(),
  ])
  const twinIds = new Set((twins ?? []).map((t) => t.id))
  const term = q.trim().toLowerCase()
  const listed = (rows ?? []).filter((p) => !twinIds.has(p.purchase_id))
  const more = listed.length > limit
  const purchases = listed.slice(0, limit).filter((p) => !term
    || (p.supplier_name ?? '').toLowerCase().includes(term)
    || (purchaseReference(p.reference) ?? '').toLowerCase().includes(term)
    || formatDay(p.purchase_date).toLowerCase().includes(term))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchases"
        sub="What you actually paid. Every ingredient cost in Menu Master comes from here."
      />
      {notice && <Notice tone={/could not|cannot/i.test(notice) ? 'warn' : 'info'}>{notice}</Notice>}

      {/* One obvious thing to do here. The purchase screen takes it from there. */}
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <Link href="/purchases/new" className="mm-btn mm-btn-primary w-full text-base">
          <AppIcon name="plus" size={20} /> New purchase
        </Link>
        <Link href="/suppliers" className="mm-btn mm-btn-secondary w-full">
          <AppIcon name="supplier" size={18} /> Suppliers and markets
        </Link>
      </div>

      <section className="space-y-3">
        <SectionHeading sub="Newest first.">Purchase history</SectionHeading>
        {(listed.length > 6 || term) && (
          <form method="get" className="flex gap-2">
            {all && <input type="hidden" name="all" value="1" />}
            <input name="q" defaultValue={q} placeholder="Find by supplier, reference or date"
              aria-label="Find a purchase" className="mm-input flex-1" />
            <button className="mm-btn mm-btn-secondary" type="submit">Find</button>
          </form>
        )}
        {!purchases?.length ? (
          <Empty>
            {term
              ? <>Nothing matches “{q}”. <Link href="/purchases" className="underline">Show all</Link></>
              : 'No purchases yet. Tap New purchase after your next market run and your dish costs start working.'}
          </Empty>
        ) : (
          <ul className="space-y-2">
            {purchases.map((p) => {
              return (
                <li key={p.purchase_id}>
                  <Link href={`/purchases/${p.purchase_id}`} className="block">
                    <Card>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <span className="font-medium">
                          {formatDay(p.purchase_date)}
                          {p.supplier_name ? ` · ${p.supplier_name}` : ''}
                        </span>
                        <span className="tabular-nums font-medium">
                          {p.total_amount !== null
                            ? money(Number(p.total_amount))
                            : <span className="mm-absent">no items yet</span>}
                        </span>
                      </div>
                      <div className="mt-1 text-sm" style={{ color: 'var(--mm-muted)' }}>
                        {p.line_count} item{p.line_count === 1 ? '' : 's'}
                        {' · '}
                        <StatusWord status={p.status} />
                        {purchaseReference(p.reference) ? ` · ${purchaseReference(p.reference)}` : ''}
                      </div>
                    </Card>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
        {more && !all && (
          <p className="text-sm">
            <Link href={`/purchases?all=1${q ? `&q=${encodeURIComponent(q)}` : ''}`} className="mm-tap underline">
              Show older purchases →
            </Link>
          </p>
        )}
      </section>
    </div>
  )
}

/** Database words are not customer words. */
function StatusWord({ status }: { status: string }) {
  if (status === 'draft') return <span style={{ color: 'var(--mm-warn)' }}>Not recorded yet — finish it</span>
  if (status === 'posted') return <>Recorded</>
  if (status === 'reversed') return <span style={{ color: 'var(--mm-warn)' }}>Cancelled</span>
  return <>{status}</>
}
