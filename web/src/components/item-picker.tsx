'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { Sheet } from './sheet'
import { AppIcon } from './icons'
import { groupItems, searchItems, type PickItem } from '@/lib/item-search'

type Option = { id: string; name: string; note?: string }

/**
 * Choosing one item from a long list (180 starter items and her own) by
 * typing a few letters, instead of scrolling a dropdown that Android cannot
 * search. "okro" finds Okra, "maggi" finds Seasoning cube (lib/item-search.ts).
 *
 * It stands in for a <select>: what is chosen is posted as `name`, and is
 * always posted ('' when nothing is chosen), so forms that send rows as
 * parallel lists stay aligned. Controlled (value + onChange) or not
 * (defaultValue), like an input.
 *
 * The list opens in a sheet hung from the top of a phone, so the keyboard
 * does not cover the results. The sheet is put on the page body, outside the
 * form and any <label>: Enter in its search box must not send the form, and a
 * tap on its backdrop must not reach the label and reopen it.
 */
export function ItemPicker({
  items, value, defaultValue = '', onChange, name, required = false, label, title,
  placeholder = 'Choose…', top, note, clearLabel, missing = 'Choose one from the list.', className = '',
}: {
  items: PickItem[]
  value?: string
  defaultValue?: string
  onChange?: (id: string) => void
  name?: string
  required?: boolean
  /** What is being chosen ("Item 1", "Ingredient"): the button's name, and the sheet's title unless `title` is given. */
  label: string
  /** The sheet's title, as the form asks it: "What did you buy?" */
  title?: string
  placeholder?: string
  /** A short list before anything is typed: "Bought before", "Priced by you". */
  top?: { label: string; ids: string[] }
  /** A few words beside an item: "no price yet". */
  note?: (item: PickItem) => string | undefined
  /** A first row that clears the choice ("No item"). */
  clearLabel?: string
  /** Said when the form is sent with nothing chosen. */
  missing?: string
  className?: string
}) {
  const [own, setOwn] = useState(defaultValue)
  const current = value ?? own
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [q, setQ] = useState('')
  // The highlighted row: -1 until she types or uses the arrow keys, so Enter
  // (Android's keyboard key) never chooses a row she did not point at.
  const [active, setActive] = useState(-1)
  const [unfilled, setUnfilled] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const listId = useId()
  const optionId = (i: number) => `${listId}-o${i}`

  useEffect(() => setMounted(true), [])

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const chosen = byId.get(current)
  const withNote = (i: PickItem): Option => ({ id: i.id, name: i.name, note: note?.(i) })

  // What the sheet lists: before typing, the short list and then every group;
  // once typing, the matches, best first.
  const sections = useMemo(() => {
    if (q.trim()) return [{ label: null as string | null, options: searchItems(items, q).slice(0, 60).map(withNote) }]
    const out: { label: string | null; options: Option[] }[] = []
    if (clearLabel) out.push({ label: null, options: [{ id: '', name: clearLabel }] })
    const first = (top?.ids ?? []).map((id) => byId.get(id)).filter((i): i is PickItem => !!i)
    if (top && first.length) out.push({ label: top.label, options: first.map(withNote) })
    for (const [group, list] of groupItems(items)) out.push({ label: group, options: list.map(withNote) })
    return out
    // withNote reads `note`, which callers pass inline; the items decide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, items, top, byId, clearLabel])
  const flat = sections.flatMap((s) => s.options)

  useEffect(() => {
    if (open && active >= 0) document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, open])

  function show() {
    // Opened and focused inside the tap itself, so Android raises the keyboard.
    flushSync(() => { setQ(''); setActive(-1); setOpen(true) })
    if (list.current) list.current.scrollTop = 0
    search.current?.focus()
  }
  function pick(id: string) {
    if (value === undefined) setOwn(id)
    setUnfilled(false)
    setOpen(false)
    onChange?.(id)
  }

  return (
    <span className="relative block">
      <button
        ref={trigger} type="button" data-picker={name ?? label} aria-haspopup="dialog"
        aria-label={`${label}: ${chosen ? chosen.name : 'not chosen'}`}
        aria-invalid={unfilled || undefined}
        onClick={show}
        className={`mm-input flex items-center justify-between gap-2 text-left ${className}`}
      >
        <span className="min-w-0 truncate" style={chosen ? undefined : { color: 'var(--mm-muted)' }}>
          {chosen ? chosen.name : placeholder}
        </span>
        <AppIcon name="search" size={17} className="shrink-0" style={{ color: 'var(--mm-muted)' }} />
      </button>
      {name && <input type="hidden" name={name} value={current} />}
      {required && (
        <input
          tabIndex={-1} aria-hidden="true" required value={current} onChange={() => {}}
          onInvalid={(e) => { e.preventDefault(); setUnfilled(true); trigger.current?.focus() }}
          className="mm-pick-proxy"
        />
      )}
      {unfilled && <span role="alert" className="mt-1 block text-sm" style={{ color: 'var(--mm-warn)' }}>{missing}</span>}

      {mounted && createPortal(
        <Sheet open={open} onClose={() => setOpen(false)} title={title ?? label} top>
          <div className="space-y-2">
            <input
              ref={search} type="search" value={q} placeholder="Type a name, e.g. okro or maggi"
              role="combobox" aria-expanded="true" aria-controls={listId} aria-autocomplete="list"
              aria-activedescendant={active >= 0 && active < flat.length ? optionId(active) : undefined}
              aria-label={`Search: ${label}`} autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="search"
              className="mm-input"
              onChange={(e) => {
                setQ(e.target.value)
                // Typing points at the best match, from the top of the list.
                setActive(e.target.value.trim() ? 0 : -1)
                if (list.current) list.current.scrollTop = 0
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, flat.length - 1)) }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
                else if (e.key === 'Enter') {
                  e.preventDefault()
                  // Only a row she pointed at, by typing or the arrows. With
                  // nothing typed the key just puts the keyboard away: as a
                  // pick, it chose the first row (Acha) unseen.
                  const o = active >= 0 ? flat[active] : undefined
                  if (o) pick(o.id)
                  else e.currentTarget.blur()
                }
              }}
            />
            <div ref={list} id={listId} role="listbox" aria-label={label} className="mm-pick-list">
              {/* Drawn only while open: ten closed pickers on a correction
                  would otherwise hold some 2,000 hidden buttons. */}
              {open && (() => {
                let i = -1
                return sections.map((s, si) => (
                  <div key={`${si}-${s.label ?? ''}`} role="group" aria-label={s.label ?? undefined}>
                    {s.label && <div className="mm-pick-heading" aria-hidden>{s.label}</div>}
                    {s.options.map((o) => {
                      i += 1
                      const at = i
                      return (
                        <button
                          key={`${si}-${o.id}`} id={optionId(at)} type="button" role="option" tabIndex={-1}
                          aria-selected={o.id === current} data-name={o.name} data-active={at === active || undefined}
                          className="mm-pick-option" onClick={() => pick(o.id)}
                        >
                          <span className="min-w-0 break-words">{o.name}</span>
                          {o.note && <span className="shrink-0 text-xs font-normal" style={{ color: 'var(--mm-muted)' }}>{o.note}</span>}
                        </button>
                      )
                    })}
                  </div>
                ))
              })()}
              {q.trim() && flat.length === 0 && (
                <p role="status" className="px-2 py-3 text-sm" style={{ color: 'var(--mm-muted)' }}>
                  Nothing matches “{q.trim()}”. Try another name for it, or add it to your list under Ingredients.
                </p>
              )}
            </div>
          </div>
        </Sheet>,
        document.body,
      )}
    </span>
  )
}
