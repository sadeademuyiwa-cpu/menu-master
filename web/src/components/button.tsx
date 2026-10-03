'use client'

import { useFormStatus } from 'react-dom'

type Variant = 'primary' | 'secondary' | 'quiet'

type Props = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  variant?: Variant
  /**
   * Force the working state. Left undefined, a submit button inside a form
   * reads it from the form itself (useFormStatus), so every server-action
   * form in the app gets a busy state without being told about it.
   */
  busy?: boolean
  /** What the button says while working. Defaults to its label. */
  busyLabel?: React.ReactNode
  children: React.ReactNode
}

/**
 * The one button.
 *
 * It answers a press at once (a 120 ms scale, see .mm-btn:active), shows that
 * it is working (spinner, aria-busy, the label swapped for busyLabel) and
 * refuses a second press until the first is answered. The database decides
 * whether the work succeeded; this only makes it visible that work is
 * happening.
 */
export function Button({
  variant = 'primary', busy, busyLabel, children, className = '', type = 'submit', disabled, ...rest
}: Props) {
  const status = useFormStatus()
  const working = busy ?? (type === 'submit' && status.pending)

  return (
    <button
      type={type}
      className={`mm-btn mm-btn-${variant} ${className}`.trim()}
      aria-busy={working || undefined}
      disabled={disabled || working}
      {...rest}
    >
      {working && <span className="mm-spinner" aria-hidden />}
      {working && busyLabel !== undefined ? busyLabel : children}
    </button>
  )
}
