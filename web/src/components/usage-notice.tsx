'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AppIcon } from '@/components/icons'
import { dismissNotice, markNoticeShown, noticeOpen } from '@/lib/usage-notice'

/**
 * Says, once to each person, that the app sees which screens are used
 * (0069), with the way to turn it off. Their screens are recorded only after
 * this has been on screen (lib/usage-client.ts). "OK" puts it away for them
 * on this phone. The words hold for someone who has already turned it off.
 * The server cannot know whether it was seen, so it appears once the page is
 * live.
 */
export function UsageNotice({ userId }: { userId: string }) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (!noticeOpen(userId)) { setShow(false); return }
    markNoticeShown(userId)
    setShow(true)
  }, [userId])

  if (!show) return null
  return (
    <div role="status" className="mm-notice" data-tone="info">
      <span className="mt-0.5 shrink-0" aria-hidden><AppIcon name="info" size={19} /></span>
      <div className="min-w-0 flex-1 space-y-2">
        <p>
          So we can help when you get stuck, Menu Master sees which screens you use and for how long, unless
          you turn this off in <Link href="/account#usage" className="underline">Account</Link>. Never what you type.
        </p>
        <button type="button" className="mm-btn mm-btn-secondary !min-h-[40px] !px-4 text-sm"
                onClick={() => { dismissNotice(userId); setShow(false) }}>
          OK
        </button>
      </div>
    </div>
  )
}
