import type { Instrumentation } from 'next'
import { monitoringOptions } from '@/lib/monitoring'

/**
 * Error monitoring on the server (Node and edge). Off unless
 * NEXT_PUBLIC_SENTRY_DSN is set: with no DSN the SDK is never even loaded.
 * What a report may contain is decided in lib/monitoring.ts.
 */
export async function register() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
  if (!dsn) return
  const Sentry = await import('@sentry/nextjs')
  Sentry.init(monitoringOptions(dsn))
}

/** Errors thrown while rendering a page or running a server action. */
export const onRequestError: Instrumentation.onRequestError = async (...args) => {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return
  const Sentry = await import('@sentry/nextjs')
  Sentry.captureRequestError(...args)
}
