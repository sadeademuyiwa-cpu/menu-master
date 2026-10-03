import { SETUP_STEP_COUNT } from '@/lib/setup-gate'

const LABELS = ['Your business', 'What you paid', 'Your first dish', 'Your price']

/** "Step 2 of 4" with the four names, so the owner sees how short setup is. */
export function SetupSteps({ current }: { current: number }) {
  return (
    <nav aria-label="Setup progress" className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--mm-muted)' }}>
        {current > SETUP_STEP_COUNT ? 'Setup complete' : `Step ${current} of ${SETUP_STEP_COUNT}`}
      </div>
      <ol className="grid grid-cols-4 gap-1.5">
        {LABELS.map((label, i) => {
          const n = i + 1
          const state = n < current ? 'done' : n === current ? 'current' : 'todo'
          return (
            <li key={label} aria-current={state === 'current' ? 'step' : undefined}>
              <div
                className="h-1.5 rounded-full"
                style={{ background: state === 'todo' ? 'var(--mm-line)' : 'var(--mm-accent)' }}
              />
              <div
                className={`mt-1.5 truncate text-[11px] ${state === 'current' ? 'font-semibold' : ''}`}
                style={{ color: state === 'todo' ? 'var(--mm-muted)' : undefined }}
              >
                {label}
              </div>
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
