'use client'

import { useEffect } from 'react'
import { track } from '@/lib/analytics/client'
import type { AppEvent } from '@/lib/analytics/events'

/**
 * Reports one moment when this renders: once per page view, or with
 * oncePer="session" once per browser tab session (a banner shown on every
 * page should not count every page).
 */
export function TrackOnce({ event, oncePer }: { event: AppEvent; oncePer?: 'session' }) {
  useEffect(() => {
    if (oncePer === 'session') {
      const key = `mm_once_${event}`
      try {
        if (sessionStorage.getItem(key)) return
        sessionStorage.setItem(key, '1')
      } catch { /* private mode: report it anyway */ }
    }
    track(event)
  }, [event, oncePer])
  return null
}
