import { Badge, Disclosure, Empty, Field, SectionHeading, inputClass } from '@/components/ui'
import { Button } from '@/components/button'
import { ConfirmSubmit } from '@/components/confirm-submit'
import { money } from '@/lib/format'
import { addKindOfWork, addLabour, removeLabour, updateLabour } from './actions'
import { TapRow } from './tap-row'
import { n, type LabourLine } from './types'

const muted = { color: 'var(--mm-muted)' }
const line = { borderColor: 'var(--mm-line)' }

const hoursText = (h: number) => `${h} hour${h === 1 ? '' : 's'} a batch`

/**
 * Time it takes: hours of paid work in one batch. Always on the page, never
 * behind "See every cost": labour is the cost owners most often forget to
 * charge for, and hidden it stayed forgotten.
 *
 * The hourly rate is a cost, so `costs` decides whether it is shown at all;
 * the page does not even read it for anyone else.
 */
export function TimeItTakes({ recipeId, labour, rates, costs, edits, addsKinds, stamp }: {
  recipeId: string
  labour: LabourLine[]
  /** The business's kinds of work, names only. */
  rates: { id: string; name: string }[]
  costs: boolean
  /** Owner, manager, kitchen: may put hours on this dish. */
  edits: boolean
  /** Owner, manager, accountant: may add a kind of work and its rate. */
  addsKinds: boolean
  stamp: number
}) {
  // A sales member or an accountant with nothing to add sees the section
  // only when the dish has paid work on it.
  if (!edits && !addsKinds && labour.length === 0) return null

  return (
    <section className="space-y-3">
      <SectionHeading sub="Hours of paid work in one batch, at the rate set for that kind of work. If you cook it yourself and pay no one, leave this empty.">
        Time it takes
      </SectionHeading>

      {labour.length === 0 ? (
        <Empty>No paid work on this dish yet.</Empty>
      ) : (
        <ul className="overflow-hidden rounded-[var(--mm-radius)] border bg-[var(--mm-surface)]" style={line}>
          {labour.map((l, i) => {
            const hours = Number(l.hours)
            const rate = costs ? n(l.rate?.rate_per_hour) : null
            const body = (
              <span className="block">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
                  {l.rate?.name ?? 'Unknown work'}
                  {costs && l.rate && l.rate.rate_per_hour === null && <Badge tone="warn">No rate set</Badge>}
                </span>
                <span className="mm-num mt-0.5 block text-sm" style={muted}>
                  {hoursText(hours)}{rate !== null && <> · {money(rate)} an hour</>}
                </span>
              </span>
            )
            return (
              <li key={l.id} className={i === 0 ? '' : 'border-t'} style={line}>
                {edits ? (
                  <TapRow stamp={stamp} title={l.rate?.name ?? 'Work'} sheet={
                    <div className="space-y-5">
                      <form action={updateLabour} className="space-y-3">
                        <input type="hidden" name="recipe_id" value={recipeId} />
                        <input type="hidden" name="id" value={l.id} />
                        <Field label="Hours a batch">
                          <input name="hours" type="number" step="any" min="0" required inputMode="decimal"
                            defaultValue={hours} className={inputClass} />
                        </Field>
                        <Button className="w-full" busyLabel="Saving…">Save</Button>
                      </form>
                      <form action={removeLabour} className="border-t pt-4" style={line}>
                        <input type="hidden" name="recipe_id" value={recipeId} />
                        <input type="hidden" name="id" value={l.id} />
                        <ConfirmSubmit variant="secondary" message={`Remove ${l.rate?.name ?? 'this work'} from this dish?`}>Remove from this dish</ConfirmSubmit>
                      </form>
                    </div>
                  }>{body}</TapRow>
                ) : (
                  <div className="px-3 py-2.5">{body}</div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {edits && (
        <Disclosure summary="Add work">
          <div className="space-y-5">
            {rates.length > 0 && (
              <form action={addLabour} className="grid gap-3 sm:grid-cols-3 sm:items-end">
                <input type="hidden" name="recipe_id" value={recipeId} />
                <Field label="Kind of work">
                  <select name="labour_rate_id" required className={inputClass}>
                    {rates.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </Field>
                <Field label="Hours a batch">
                  <input name="hours" type="number" step="any" min="0" required inputMode="decimal" className={inputClass} />
                </Field>
                <Button className="w-full sm:w-auto">Add work</Button>
              </form>
            )}
            {addsKinds ? (
              <form action={addKindOfWork} className={`grid gap-3 sm:grid-cols-3 sm:items-end ${rates.length > 0 ? 'border-t pt-4' : ''}`} style={line}>
                <input type="hidden" name="recipe_id" value={recipeId} />
                <p className="text-sm font-medium sm:col-span-3">{rates.length > 0 ? 'Someone new to pay' : 'What kind of work is it?'}</p>
                <Field label="Kind of work">
                  <input name="name" required maxLength={80} placeholder="Decorating" className={inputClass} />
                </Field>
                <div className="grid grid-cols-2 gap-3 sm:col-span-2">
                  <Field label="Paid per hour (₦)">
                    <input name="rate_per_hour" type="number" step="0.01" min="0" inputMode="decimal" className={inputClass} />
                  </Field>
                  <Field label="Hours a batch">
                    <input name="hours" type="number" step="any" min="0" required inputMode="decimal" className={inputClass} />
                  </Field>
                </div>
                <Button variant={rates.length > 0 ? 'secondary' : 'primary'} className="w-full sm:col-span-3 sm:w-auto sm:justify-self-start">
                  Add this work
                </Button>
              </form>
            ) : (
              <p className="text-sm" style={muted}>
                {rates.length > 0 ? 'Not in the list? ' : 'No kinds of paid work yet. '}Ask the owner to add this rate.
              </p>
            )}
          </div>
        </Disclosure>
      )}

      {!edits && addsKinds && (
        <Disclosure summary="Add a kind of work">
          <form action={addKindOfWork} className="grid gap-3 sm:grid-cols-3 sm:items-end">
            <input type="hidden" name="recipe_id" value={recipeId} />
            <Field label="Kind of work">
              <input name="name" required maxLength={80} placeholder="Decorating" className={inputClass} />
            </Field>
            <Field label="Paid per hour (₦)">
              <input name="rate_per_hour" type="number" step="0.01" min="0" inputMode="decimal" className={inputClass} />
            </Field>
            <Button className="w-full sm:w-auto">Add</Button>
          </form>
        </Disclosure>
      )}
    </section>
  )
}
