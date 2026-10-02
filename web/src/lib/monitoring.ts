/**
 * What an error report may carry to the monitoring service (Sentry).
 *
 * Kept free of the SDK so it is tested directly. Reports are for finding
 * bugs, not people: no cookies, no request headers, no IP address, and any
 * email address in an error message is blanked. Owners' recipes, prices and
 * customers never appear in error text by design; this is the backstop for
 * the one personal detail that easily slips into a message.
 */
const EMAIL = /[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+\.[A-Za-z]{2,}/g

export function blankEmails(s: string): string {
  return s.replace(EMAIL, '[email]')
}

type Frame = { value?: string; type?: string }
export type ReportEvent = {
  message?: string
  exception?: { values?: Frame[] }
  request?: { cookies?: unknown; headers?: Record<string, string>; data?: unknown; query_string?: unknown; url?: string }
  user?: unknown
  breadcrumbs?: { message?: string; data?: unknown }[]
}

/** Strips an event down to what finding a bug needs. Returns the same object. */
export function scrubEvent<E extends ReportEvent>(event: E): E {
  if (event.message) event.message = blankEmails(event.message)
  for (const v of event.exception?.values ?? []) {
    if (v.value) v.value = blankEmails(v.value)
  }
  if (event.request) {
    delete event.request.cookies
    delete event.request.headers
    delete event.request.data
    delete event.request.query_string
    if (event.request.url) event.request.url = event.request.url.split('?')[0]
  }
  delete event.user
  for (const b of event.breadcrumbs ?? []) {
    if (b.message) b.message = blankEmails(b.message)
    delete b.data
  }
  return event
}

/** The monitoring settings every runtime shares. */
export function monitoringOptions(dsn: string) {
  return {
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.VERCEL_ENV ?? 'local',
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
    beforeSendTransaction: () => null,
  }
}
