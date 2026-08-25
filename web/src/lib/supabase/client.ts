'use client'

import { createBrowserClient } from '@supabase/ssr'

/**
 * Browser Supabase client. Carries only the publishable (anon) key.
 * The service_role key must never reach this file or any bundle it is in.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}
