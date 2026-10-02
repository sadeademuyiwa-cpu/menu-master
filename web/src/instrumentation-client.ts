import { monitoringOptions } from '@/lib/monitoring'

/**
 * Error monitoring in the browser. Off unless NEXT_PUBLIC_SENTRY_DSN is set,
 * and loaded as a separate download only then, so the landing page an
 * advert sends people to stays as small as it is without it.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
if (dsn) {
  void import('@sentry/nextjs').then((Sentry) => Sentry.init(monitoringOptions(dsn))).catch(() => {})
}
