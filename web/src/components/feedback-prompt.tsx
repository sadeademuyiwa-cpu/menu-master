'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/button'
import { helpScreenFor } from '@/lib/site/help-videos'

/**
 * One short question, now and then (0069 fn_feedback_due decides which, if
 * any): how easy the first costed dish and the first sale were (1-5), and
 * after a month of real use whether they would recommend Menu Master (0-10).
 * Never on the first day, at most once a fortnight, each question once, and
 * never while someone is typing.
 *
 * One way out, whatever closes it (Send, Not now, ×, Escape, the back
 * gesture): a score she chose is kept, with what she wrote if anything ("Skip
 * writing" keeps the score and drops the words); with no score it is kept
 * as "Not now". The database takes an answer only to the question that is
 * due, so the first is the one that counts.
 */
type Prompt = 'first_dish' | 'first_sale' | 'nps'

const QUESTION: Record<Prompt, string> = {
  first_dish: 'How easy was it to cost your first dish?',
  first_sale: 'How easy was it to record a sale?',
  nps: 'How likely are you to recommend Menu Master to another food business owner?',
}
const EASE = ['Very hard', 'Hard', 'Okay', 'Easy', 'Very easy']
const isLow = (p: Prompt, n: number) => (p === 'nps' ? n <= 6 : n <= 3)

export function FeedbackPrompt() {
  const pathname = usePathname() ?? '/'
  const id = useId()
  const [prompt, setPrompt] = useState<Prompt | null>(null)
  const [score, setScore] = useState<number | null>(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [thanks, setThanks] = useState(false)
  const asked = useRef(false)
  const done = useRef(false)          // this question has been answered or put away
  const ref = useRef<HTMLDialogElement>(null)

  // Ask once per page load, a few seconds after arriving on a screen, and
  // only if nobody is in the middle of filling something in.
  useEffect(() => {
    if (asked.current) return
    const t = setTimeout(async () => {
      const el = document.activeElement
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return
      if (document.querySelector('dialog[open]')) return
      asked.current = true
      const { data } = await createClient().rpc('fn_feedback_due').then((r) => r, () => ({ data: null }))
      if (data === 'first_dish' || data === 'first_sale' || data === 'nps') setPrompt(data)
    }, 6000)
    return () => clearTimeout(t)
  }, [pathname])

  useEffect(() => {
    const d = ref.current
    if (d && prompt && !d.open) d.showModal()
  }, [prompt])

  /** Closing through the dialog hands focus back to where she was. */
  function hide() {
    if (ref.current?.open) ref.current.close()
    setPrompt(null)
  }

  async function finish(final: number | null, text: string | null) {
    if (!prompt || done.current) return
    done.current = true
    if (final === null) hide()          // "Not now" goes at once
    setBusy(true)
    await createClient().rpc('fn_give_feedback', {
      p_prompt: prompt, p_score: final, p_comment: text, p_screen: helpScreenFor(pathname),
    }).then(() => undefined, () => undefined)
    setBusy(false)
    if (final === null) return
    setThanks(true)
    setTimeout(hide, 1800)
  }

  /**
   * ×, Escape, Not now: keep the score she chose, if she chose one, with what
   * she wrote. Once an answer is on its way, they just close the sheet.
   */
  const leave = () => {
    if (done.current) { hide(); return }
    void finish(score, score !== null ? comment.trim() || null : null)
  }
  /** Skip writing: keep the score, drop the words. */
  const skipWriting = () => { if (done.current) hide(); else void finish(score, null) }

  function choose(n: number) {
    if (done.current) return
    setScore(n)
    if (prompt && !isLow(prompt, n)) void finish(n, null)       // a good score needs nothing more
  }

  if (!prompt) return null
  const scale = prompt === 'nps' ? Array.from({ length: 11 }, (_, i) => i) : [1, 2, 3, 4, 5]
  const low = score !== null && isLow(prompt, score)

  return (
    <dialog ref={ref} className="mm-sheet" aria-labelledby={`${id}-q`}
            onClose={() => { if (!done.current) leave(); setPrompt(null) }}>
      <div className="mm-sheet-body space-y-4">
        {thanks ? (
          <p id={`${id}-q`} className="text-base font-semibold" role="status">Thank you. It helps us make Menu Master better.</p>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <h2 id={`${id}-q`} className="text-base font-semibold tracking-tight">{QUESTION[prompt]}</h2>
              <button type="button" className="mm-icon-btn" aria-label="Not now" onClick={leave}>×</button>
            </div>
            <div className={prompt === 'nps' ? 'grid grid-cols-6 gap-1.5 sm:grid-cols-11' : 'grid grid-cols-5 gap-1.5'}
                 role="group" aria-labelledby={`${id}-q`} aria-describedby={prompt === 'nps' ? `${id}-scale` : undefined}>
              {scale.map((n) => (
                <button key={n} type="button" disabled={busy}
                        className={`mm-btn ${score === n ? 'mm-btn-primary' : 'mm-btn-secondary'} flex-col !px-1 !py-2 text-sm`}
                        aria-pressed={score === n} onClick={() => choose(n)}
                        aria-label={prompt === 'nps' ? `${n} of 10` : `${n}, ${EASE[n - 1]}`}>
                  <span className="tabular-nums" aria-hidden>{n}</span>
                  {prompt !== 'nps' && <span className="text-[10px] font-medium leading-tight" aria-hidden>{EASE[n - 1]}</span>}
                </button>
              ))}
            </div>
            {prompt === 'nps' && (
              <p id={`${id}-scale`} className="flex justify-between text-xs" style={{ color: 'var(--mm-muted)' }}>
                <span>0 Not at all likely</span><span>10 Very likely</span>
              </p>
            )}
            {low && (
              <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void finish(score, comment.trim() || null) }}>
                <label className="block">
                  <span className="text-sm font-medium">{prompt === 'nps' ? 'What is the main reason for your score?' : 'What made it hard?'}</span>
                  <textarea name="feedback_comment" rows={3} maxLength={500} value={comment}
                            onChange={(e) => setComment(e.target.value)} className="mm-input mt-1" />
                </label>
                <Button busy={busy} busyLabel="Sending…" className="w-full">Send</Button>
              </form>
            )}
            <button type="button" className="mm-inline-tap text-sm" style={{ color: 'var(--mm-muted)' }} onClick={low ? skipWriting : leave}>
              {low ? 'Skip writing' : 'Not now'}
            </button>
          </>
        )}
      </div>
    </dialog>
  )
}
