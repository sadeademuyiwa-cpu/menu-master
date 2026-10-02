'use client'

import { useEffect } from 'react'

/**
 * The last resort: an error the pages themselves did not handle. Says so in
 * plain words, offers the one thing that usually helps, and reports it when
 * monitoring is on. Nothing the owner entered is lost by an error here --
 * every save happened, or did not, in the database already.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return
    void import('@sentry/nextjs').then((Sentry) => Sentry.captureException(error)).catch(() => {})
  }, [error])

  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0, background: '#f7f8f6', color: '#171b18' }}>
        <main style={{ maxWidth: 420, margin: '0 auto', padding: '64px 20px' }}>
          <h1 style={{ fontSize: 22, margin: 0 }}>Something went wrong on our side</h1>
          <p style={{ marginTop: 12, lineHeight: 1.6, color: '#66706a' }}>
            Your saved work is safe. Try again; if it keeps happening, tell us on WhatsApp or by email
            {error.digest ? <> and mention code <strong>{error.digest}</strong></> : null}.
          </p>
          <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
            <button type="button" onClick={() => reset()}
                    style={{ minHeight: 46, padding: '0 20px', borderRadius: 12, border: 0, background: '#1f7a52', color: '#fff', fontWeight: 600, fontSize: 15 }}>
              Try again
            </button>
            <a href="/dashboard"
               style={{ minHeight: 46, padding: '0 20px', borderRadius: 12, border: '1px solid #dde3de', display: 'inline-flex', alignItems: 'center', color: '#171b18', textDecoration: 'none', fontWeight: 600, fontSize: 15 }}>
              Go to the dashboard
            </a>
          </div>
        </main>
      </body>
    </html>
  )
}
