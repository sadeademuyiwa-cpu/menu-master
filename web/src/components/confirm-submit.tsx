'use client'

import { Button } from '@/components/button'

/**
 * A submit button for something that cannot be undone from the screen it is
 * on: removing a line, discarding a draft, cancelling a sale. One plain
 * question first. Everything reversible (hide, put away) asks nothing.
 */
export function ConfirmSubmit({
  message, children, variant = 'quiet',
}: {
  message: string
  children: React.ReactNode
  variant?: 'quiet' | 'secondary' | 'primary'
}) {
  return (
    <Button
      variant={variant}
      onClick={(e) => { if (!window.confirm(message)) e.preventDefault() }}
    >
      {children}
    </Button>
  )
}
