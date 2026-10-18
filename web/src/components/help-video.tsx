'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { AppIcon } from '@/components/icons'
import { embedUrl, helpLabel, helpScreenFor, type HelpVideos } from '@/lib/site/help-videos'

/**
 * "Help" at the top of a screen: plays the video the admin chose for this
 * screen (Platform → Help videos). A screen without one shows no button, so
 * nothing promises help that is not there.
 *
 * The player is mounted only while open: nothing is fetched from YouTube
 * until she asks, and closing it stops the sound.
 */
export function HelpVideoButton({ videos }: { videos: HelpVideos }) {
  const pathname = usePathname()
  const key = helpScreenFor(pathname)
  const video = key ? videos[key] : undefined
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  // Moving to another screen closes the video of the last one.
  useEffect(() => { setOpen(false) }, [pathname])

  if (!key || !video) return null
  const title = `How to use: ${helpLabel(key)}`

  return (
    <>
      <button type="button" className="mm-help-chip" onClick={() => setOpen(true)}
              aria-haspopup="dialog" title={title}>
        <AppIcon name="play" size={19} />
        <span>Help</span>
      </button>
      <dialog
        ref={ref}
        className={`mm-sheet mm-video-sheet${video.vertical ? ' mm-video-sheet--tall' : ''}`}
        onClose={() => setOpen(false)}
        onClick={(e) => { if (e.target === ref.current) setOpen(false) }}
        aria-label={title}
      >
        <div className="mm-sheet-body">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold tracking-tight">{title}</h2>
            <button type="button" className="mm-icon-btn" aria-label="Close" onClick={() => setOpen(false)}>×</button>
          </div>
          <div className="mm-video-frame mt-3">
            {open && (
              <iframe
                src={embedUrl(video)}
                title={title}
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
              />
            )}
          </div>
          <p className="mt-3 text-[13px]" style={{ color: 'var(--mm-muted)' }}>
            Plays from YouTube.{' '}
            <a href={video.url} target="_blank" rel="noopener noreferrer" className="mm-inline-tap">Open it on YouTube</a>
          </p>
        </div>
      </dialog>
    </>
  )
}
