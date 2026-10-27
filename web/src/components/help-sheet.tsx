'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { sendUsage } from '@/lib/usage-client'
import { AppIcon } from '@/components/icons'
import { Button } from '@/components/button'
import { embedUrl, helpLabel, helpScreenFor, type HelpVideos } from '@/lib/site/help-videos'
import { deviceFor, routePattern } from '@/lib/usage'

/**
 * "Help" at the top of every screen, for someone signed in (0069). One
 * sheet, three ways:
 *   - watch how: this screen's video, when the admin chose one;
 *   - write to us: one box, sent with the screen it came from;
 *   - WhatsApp: when the website has a support number, WhatsApp opens with a
 *     message started, and the request is noted with its screen -- once per
 *     opening of the sheet, however often the button is pressed.
 * The sign-in pages keep components/help-video.tsx: nobody is signed in to
 * write from there.
 */
export function HelpSheet({ videos, whatsapp, compact = false }: {
  videos: HelpVideos
  whatsapp: string | null
  /** The setup header, where the logo needs the room: the word goes on a narrow phone, the name stays. */
  compact?: boolean
}) {
  const pathname = usePathname() ?? '/'
  const key = helpScreenFor(pathname)
  const video = key ? videos[key] : undefined
  const where = key ? helpLabel(key) : 'this screen'
  const [open, setOpen] = useState(false)
  const [watching, setWatching] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null)
  const ref = useRef<HTMLDialogElement>(null)
  // WhatsApp already noted since the sheet opened
  const noted = useRef(false)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) { noted.current = false; d.showModal() }
    if (!open && d.open) d.close()
  }, [open])
  // Another screen: start fresh.
  useEffect(() => { setOpen(false); setWatching(false); setNote(null) }, [pathname])

  const context = () => ({
    screen: key, path: routePattern(pathname),
    device: deviceFor(window.innerWidth, window.innerHeight, window.matchMedia?.('(pointer: coarse)').matches ?? false),
  })
  const logEvent = (kind: 'help_open' | 'help_video') => {
    const c = context()
    sendUsage('fn_usage_event', { p_kind: kind, p_screen: c.screen, p_path: c.path })
  }

  async function ask(channel: 'message' | 'whatsapp'): Promise<string | null> {
    const c = context()
    const { data, error } = await createClient().rpc('fn_ask_for_help', {
      p_screen: c.screen, p_path: c.path, p_channel: channel,
      p_message: channel === 'message' ? text : null, p_device: c.device,
    })
    if (error) {
      // WhatsApp is open by now: a note that failed here is not her message failing
      if (channel === 'whatsapp') return null
      setNote({ text: /say what|already have/i.test(error.message) ? error.message : 'That did not send. Check your connection and try again.', bad: true })
      return null
    }
    return (data as { ref?: string } | null)?.ref ?? null
  }

  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim()) { setNote({ text: 'Say what you were trying to do, so we can help.', bad: true }); return }
    setBusy(true)
    const refNo = await ask('message')
    setBusy(false)
    if (refNo) {
      setText('')
      setNote({ text: `Sent. Your reference is ${refNo}. We will get back to you on WhatsApp if you gave us your number, or by email.`, bad: false })
    }
  }

  function chat() {
    // WhatsApp opens at once -- a phone blocks a window opened after a wait --
    // and the request is noted alongside, with its screen, so the admin sees
    // it even if the message is never sent.
    if (!noted.current) { noted.current = true; void ask('whatsapp') }
    const msg = `Hello Menu Master, I need help on ${where}.`
    window.open(`https://wa.me/${whatsapp}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener')
  }

  return (
    <>
      <button type="button" className="mm-help-chip" aria-haspopup="dialog" title="Help with this screen"
              onClick={() => { setOpen(true); logEvent('help_open') }}>
        <AppIcon name="info" size={19} />
        <span className={compact ? 'max-[419px]:sr-only' : undefined}>Help</span>
      </button>
      <dialog
        ref={ref}
        className={`mm-sheet${watching && video ? ` mm-video-sheet${video.vertical ? ' mm-video-sheet--tall' : ''}` : ''}`}
        onClose={() => { setOpen(false); setWatching(false) }}
        onClick={(e) => { if (e.target === ref.current) setOpen(false) }}
        aria-label="Help"
      >
        {/* Only in the page while open: a closed sheet's form would sit inside
            every screen, behind the screen's own buttons. What was typed is
            kept in state, so closing it loses nothing. */}
        {open && <div className="mm-sheet-body">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold tracking-tight">{watching ? `How to use: ${where}` : 'Need help?'}</h2>
            <button type="button" className="mm-icon-btn" aria-label="Close" onClick={() => setOpen(false)}>×</button>
          </div>

          {watching && video ? (
            <>
              <div className="mm-video-frame mt-3">
                <iframe src={embedUrl(video)} title={`How to use: ${where}`}
                        allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen
                        referrerPolicy="strict-origin-when-cross-origin" />
              </div>
              <button type="button" className="mm-inline-tap mt-2 text-sm" onClick={() => setWatching(false)}>Back to help</button>
            </>
          ) : (
            <div className="mt-3 space-y-5">
              <p className="text-sm" style={{ color: 'var(--mm-muted)' }}>You are on: <strong style={{ color: 'var(--mm-fg)' }}>{where}</strong></p>

              {video && (
                <button type="button" className="mm-btn mm-btn-secondary w-full"
                        onClick={() => { setWatching(true); logEvent('help_video') }}>
                  <AppIcon name="play" size={18} /> Watch how to use this screen
                </button>
              )}

              <form onSubmit={send} className="space-y-2">
                <label className="block">
                  <span className="text-sm font-medium">Write to us</span>
                  <textarea name="help_message" rows={3} value={text} maxLength={1000}
                            onChange={(e) => { setText(e.target.value); setNote(null) }}
                            placeholder="What were you trying to do?" className="mm-input mt-1" />
                </label>
                <p className="text-xs" style={{ color: 'var(--mm-muted)' }}>
                  We see which screen you were on, so you do not need to explain where. Please do not send passwords or card details.
                </p>
                <Button busy={busy} busyLabel="Sending…" className="w-full">Send</Button>
              </form>

              {whatsapp && (
                <button type="button" className="mm-btn mm-btn-secondary w-full" disabled={busy} onClick={chat}>
                  Chat with us on WhatsApp
                </button>
              )}

              {note && (
                <p role="status" className="text-sm" style={{ color: note.bad ? 'var(--mm-warn)' : 'var(--mm-accent-strong)' }}>{note.text}</p>
              )}
            </div>
          )}
        </div>}
      </dialog>
    </>
  )
}
