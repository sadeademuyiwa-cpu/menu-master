import Link from 'next/link'
import { Notice } from '@/components/ui'
import { noticeTone } from '@/lib/ui/notice-tone'
import { fmtDateTime } from '@/lib/admin/format'
import { savedAt } from '@/lib/data/admin'

/** The Website pages' own refusals, on top of the shared words (lib/ui/notice-tone). */
export const SITE_REFUSAL = /\bnot\b|cannot|needs|look right|paste|give|could|one address|digits/i

/** The outcome of a save, at the top of the page it came back to, with the way to see it live. */
export function SiteNotice({ notice, view }: { notice?: string; view?: { href: string; label: string } }) {
  if (!notice) return null
  const tone = noticeTone(notice, SITE_REFUSAL)
  return (
    <Notice tone={tone}>
      {notice}
      {tone === 'info' && view && (
        <> <Link href={view.href} target="_blank" rel="noopener" className="font-semibold underline">{view.label}</Link></>
      )}
    </Notice>
  )
}

export function stampWords(o: Record<string, unknown> | undefined): string {
  const at = savedAt(o)
  return at ? `Last saved ${fmtDateTime(at)}` : 'Not saved yet'
}

export const UP = { href: '/admin/site', label: 'Website' }

export const unavailable = 'Website settings are not available on this database yet (0057).'
