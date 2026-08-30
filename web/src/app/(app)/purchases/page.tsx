import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { currentContext, describeWriteError, withNotice } from '@/lib/data/context'
import { PageHeader, Card, Field, Submit, Notice, Empty, SectionHeading } from '@/components/ui'
import { money } from '@/lib/format'

export const dynamic = 'force-dynamic'

type Row = {
  purchase_id: string; purchase_date: string; status: string
  reference: string | null; supplier_name: string | null
  line_count: number; total_amount: string | null
}
type Supplier = { id: string; name: string }

/** Start a draft. Lines are added on the next screen; nothing costs anything
 *  until fn_post_purchase runs, so an abandoned draft affects no recipe. */
async function startPurchase(formData: FormData) {
  'use server'
  const { supabase, accountId, businessId } = await currentContext()
  if (!accountId || !businessId) redirect(withNotice('/purchases', 'No business found for your login.'))

  const supplierRaw = String(formData.get('supplier_id') ?? '')
  const { data, error } = await supabase.from('purchases').insert({
    account_id: accountId,
    business_id: businessId,
    purchase_date: String(formData.get('purchase_date') || new Date().toISOString().slice(0, 10)),
    supplier_id: supplierRaw || null,
    reference: String(formData.get('reference') ?? '') || null,
  }).select('id').single()

  if (error || !data) redirect(withNotice('/purchases', describeWriteError(error) ?? 'Could not start that purchase.'))
  revalidatePath('/purchases')
  redirect(`/purchases/${data.id}`)
}

export default async function PurchasesPage({
  searchParams,
}: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams
  const { supabase, accountId } = await currentContext()
  if (!accountId) redirect('/onboarding')

  const [{ data: purchases }, { data: suppliers }] = await Promise.all([
    // v_purchase_summary (0035). purchase_lines carries two foreign keys to
    // both ingredients and purchases, so an unhinted PostgREST embed returns
    // PGRST201 and the list silently renders zero items. The view resolves the
    // joins in SQL and sums the amounts in PostgreSQL, where money belongs.
    supabase.from('v_purchase_summary')
      .select('purchase_id,purchase_date,status,reference,supplier_name,line_count,total_amount')
      .order('purchase_date', { ascending: false }).limit(50).returns<Row[]>(),
    supabase.from('suppliers').select('id,name').eq('is_active', true)
      .order('name').returns<Supplier[]>(),
  ])

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchases"
        sub="What you actually paid. Every ingredient cost in Menu Master comes from here."
      />
      {notice && <Notice tone={/could not|cannot/i.test(notice) ? 'warn' : 'info'}>{notice}</Notice>}

      <Card>
        <SectionHeading sub="Record a market run or a supplier delivery. Add the items on the next screen.">
          Record a purchase
        </SectionHeading>
        <form action={startPurchase} className="mt-3 grid gap-3 sm:grid-cols-4">
          <Field label="Date">
            <input name="purchase_date" type="date" defaultValue={today}
              className="mt-1 w-full rounded border px-3 py-2 text-base"
              style={{ borderColor: 'var(--mm-line)', background: 'transparent' }} />
          </Field>
          <Field label="Supplier or market (optional)">
            <select name="supplier_id" className="mt-1 w-full rounded border px-3 py-2 text-base"
              style={{ borderColor: 'var(--mm-line)', background: 'transparent' }}>
              <option value="">Not recorded</option>
              {(suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Reference (optional)">
            <input name="reference" placeholder="receipt no."
              className="mt-1 w-full rounded border px-3 py-2 text-base"
              style={{ borderColor: 'var(--mm-line)', background: 'transparent' }} />
          </Field>
          <div className="flex items-end"><Submit>Start purchase</Submit></div>
        </form>
      </Card>

      <section className="space-y-3">
        <SectionHeading sub="Newest first.">Purchase history</SectionHeading>
        {!purchases?.length ? (
          <Empty>No purchases yet. Record one above and your ingredient costs start working.</Empty>
        ) : (
          <ul className="space-y-2">
            {purchases.map((p) => {
              return (
                <li key={p.purchase_id}>
                  <Link href={`/purchases/${p.purchase_id}`} className="block">
                    <Card>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <span className="font-medium">
                          {p.purchase_date}
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
                        {p.reference ? ` · ${p.reference}` : ''}
                      </div>
                    </Card>
                  </Link>
                </li>
              )
            })}
          </ul>
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
