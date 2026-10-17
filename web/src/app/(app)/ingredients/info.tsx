import { AppIcon } from '@/components/icons'

/**
 * An explanation behind an (i), for a field rather than a page or section
 * title. The same markup as the page header's own InfoHint (components/ui),
 * which that file does not export, so it looks and behaves the same: a
 * details element, opened by a 44px round button, no script needed.
 */
export function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="mm-info relative inline-block shrink-0 align-middle">
      <summary className="mm-icon-btn" aria-label={label} title={label}>
        <AppIcon name="info" size={18} />
      </summary>
      <div className="mm-info-popover">{children}</div>
    </details>
  )
}
