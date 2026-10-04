import Link from 'next/link'
import { SETUP_STEP_COUNT, canOpen, type SetupView, type WizardStep } from '@/lib/setup-gate'
import { AppIcon } from '@/components/icons'

const STEPS: { view: SetupView; label: string }[] = [
  { view: 'business', label: 'Your business' },
  { view: 'purchase', label: 'What you paid' },
  { view: 'dish', label: 'Your first dish' },
  { view: 'price', label: 'Your price' },
]
const NUMBER: Record<SetupView, number> = { business: 1, purchase: 2, dish: 3, price: 4, done: 5 }

/**
 * The four steps as tabs. Every step up to the one the owner has reached can
 * be opened again to see and change what they entered; later steps stay
 * greyed out because each needs the one before it.
 *
 * On /onboarding the business does not exist yet, so nothing is a link
 * (`progress` is left out there).
 */
export function SetupSteps({ view, progress }: { view: SetupView; progress?: WizardStep }) {
  const current = NUMBER[view]
  const reached = progress ? NUMBER[progress] : current
  const heading = progress === 'done'
    ? (view === 'done' ? 'Setup complete' : 'Setup complete · looking back')
    : `Step ${Math.min(current, SETUP_STEP_COUNT)} of ${SETUP_STEP_COUNT}`

  return (
    <nav aria-label="Setup steps" className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--mm-muted)' }}>
          {heading}
        </div>
        {progress && (
          <span className="text-[11px]" style={{ color: 'var(--mm-muted)' }}>Tap a finished step to change it</span>
        )}
      </div>
      <ol className="grid grid-cols-4 gap-1.5">
        {STEPS.map(({ view: v, label }) => {
          const n = NUMBER[v]
          const done = n < reached
          const here = v === view
          const open = progress ? canOpen(v, progress) : false
          const body = (
            <>
              <div className="h-1.5 rounded-full"
                   style={{ background: done || here || n <= reached ? 'var(--mm-accent)' : 'var(--mm-line)' }} />
              <div className={`mt-1.5 flex items-center gap-1 text-[11px] ${here ? 'font-semibold' : ''}`}
                   style={{ color: !open && !here ? 'var(--mm-muted)' : undefined }}>
                {done && <AppIcon name="check" size={12} className="shrink-0" style={{ color: 'var(--mm-accent)' }} />}
                <span className="truncate">{label}</span>
              </div>
            </>
          )
          return (
            <li key={v} aria-current={here ? 'step' : undefined}>
              {open && !here ? (
                <Link href={`/start?step=${v}`} className="mm-setup-tab block" aria-label={`Open step ${n}: ${label}`}>
                  {body}
                </Link>
              ) : (
                <div className="mm-setup-tab" aria-disabled={!open || undefined}>{body}</div>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export function SetupTitle({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
      {children && <p className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--mm-muted)' }}>{children}</p>}
    </div>
  )
}

/** Back / Next under a step. Next is only offered where the owner has already been. */
export function StepNav({ back, next, nextLabel = 'Next' }: {
  back: SetupView | null
  next: SetupView | null
  nextLabel?: string
}) {
  if (!back && !next) return null
  return (
    <div className="flex items-center justify-between gap-3">
      {back ? (
        <Link href={`/start?step=${back}`} className="mm-btn mm-btn-quiet">
          <AppIcon name="arrow-left" size={16} /> Back
        </Link>
      ) : <span />}
      {next && (
        <Link href={`/start?step=${next}`} className="mm-btn mm-btn-secondary">
          {nextLabel} <AppIcon name="arrow-right" size={16} />
        </Link>
      )}
    </div>
  )
}
