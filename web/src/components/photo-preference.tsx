'use client'

import { useId, useSyncExternalStore } from 'react'
import { PHOTO_PREFERENCE_KEY, type PhotoPreference as Choice } from '@/lib/dish-photo'

/** Other switches on this page, and other tabs, hear the change. */
const CHANGED = 'mm-photos-change'

function subscribe(onChange: () => void): () => void {
  // A choice made in another tab of this browser applies here too, at once.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== PHOTO_PREFERENCE_KEY) return
    if (e.newValue === 'on' || e.newValue === 'off') {
      document.documentElement.setAttribute('data-photos', e.newValue)
    }
    onChange()
  }
  window.addEventListener(CHANGED, onChange)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(CHANGED, onChange)
    window.removeEventListener('storage', onStorage)
  }
}

/** What <html data-photos> says now. The <head> script (app/layout.tsx) set it
 *  before the first paint, from the saved choice or the phone's data saver. */
function current(): Choice {
  return document.documentElement.getAttribute('data-photos') === 'off' ? 'off' : 'on'
}

function saveData(): boolean {
  try {
    return !!(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData
  } catch {
    return false
  }
}

/**
 * "Hide photos to save data", for this phone only.
 *
 * Dish photos are small (about 15 KB each in a list) but a full menu still
 * costs a phone on a small bundle something on every new device. Turning
 * this on hides every dish photo at once and shows each dish's tile instead
 * (html[data-photos=off] in globals.css); because the photos are lazy, a
 * hidden one is not downloaded either.
 *
 * The choice is kept in this browser's localStorage, not on the account: it
 * is about this phone's data, and an owner on Wi-Fi at home and on a bundle
 * at the market may want different answers. With no choice saved, the
 * phone's own data saver decides.
 */
export function PhotoPreference() {
  const id = useId()
  // The server cannot know this phone's choice; it renders "shown" and the
  // switch corrects itself as soon as the page is live.
  const choice = useSyncExternalStore<Choice>(subscribe, current, () => 'on')
  const hidden = choice === 'off'

  function toggle() {
    const next: Choice = hidden ? 'on' : 'off'
    document.documentElement.setAttribute('data-photos', next)
    try { localStorage.setItem(PHOTO_PREFERENCE_KEY, next) } catch { /* private mode: this visit only */ }
    window.dispatchEvent(new Event(CHANGED))
  }

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <span id={`${id}-label`} className="block text-sm font-medium">Hide photos to save data</span>
        <span id={`${id}-hint`} className="mt-0.5 block text-[13px]" style={{ color: 'var(--mm-muted)' }}>
          {hidden && saveData()
            ? 'Your phone’s data saver is on, so dishes show their coloured tile. This phone only.'
            : 'Dishes show their coloured tile instead of a photo. This phone only.'}
        </span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={hidden}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-hint`}
        className="mm-switch"
        onClick={toggle}
      >
        <span className="mm-switch-track" aria-hidden="true"><span className="mm-switch-knob" /></span>
      </button>
    </div>
  )
}
