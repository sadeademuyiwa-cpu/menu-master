import Link from 'next/link'
import { adminWebsiteFacts, savedAt } from '@/lib/data/admin'
import { Notice } from '@/components/ui'
import { AppIcon, type IconName } from '@/components/icons'
import { fmtDateTime } from '@/lib/admin/format'
import { customersCannotReach, websiteAreas, websiteChecklist, type AreaKey, type Priority } from '@/lib/admin/website'
import { AdminPage, AreaIcon, Meter, Panel, Pill, ViewOnSite } from '../_ui/kit'
import { unavailable } from './_shared'

export const dynamic = 'force-dynamic'

const ICONS: Record<AreaKey, IconName> = {
  company: 'store', signin: 'account', tracking: 'chart', landing: 'home', privacy: 'lock', help: 'play',
}
const RAW_KEY: Record<AreaKey, string> = {
  company: 'company', signin: 'signin', tracking: 'analytics', landing: 'landing', privacy: 'privacy', help: 'help',
}
const PRIORITY: Record<Priority, string> = {
  reach: 'Customers cannot reach you',
  legal: 'The legal pages',
  extra: 'Worth adding',
}

/**
 * Admin -> Website: what the public site shows now, area by area, and what
 * is still missing. Each area has its own page; nothing is edited here.
 */
export default async function AdminSite() {
  const site = await adminWebsiteFacts()
  if (!site) return <AdminPage title="Website"><Notice>{unavailable}</Notice></AdminPage>

  const checklist = websiteChecklist(site.facts)
  const areas = websiteAreas(site.facts, checklist)
  const done = checklist.filter((i) => i.done).length
  const open = checklist.filter((i) => !i.done)
  const cannotReach = customersCannotReach(site.facts)
  const byPriority = (['reach', 'legal', 'extra'] as const)
    .map((p) => ({ p, items: open.filter((i) => i.priority === p) }))
    .filter((g) => g.items.length > 0)
  const href = (k: AreaKey) => areas.find((a) => a.key === k)?.href ?? '/admin/site'

  return (
    <AdminPage
      title="Website"
      description="Everything visitors see that you control: the legal pages, sign-in, tracking, the landing page and the help videos inside the app."
      actions={<ViewOnSite href="/?preview=1">View the website</ViewOnSite>}
    >
      {cannotReach && (
        <Notice>
          A customer with a problem has nowhere to write: there is no support email and no WhatsApp number on the website.{' '}
          <Link href="/admin/site/company" className="font-semibold underline">Add a support email</Link>
          {' or '}
          <Link href="/admin/site/landing" className="font-semibold underline">a WhatsApp number</Link>.
        </Notice>
      )}

      <Panel title="Set up" flush
             description={open.length ? `${done} of ${checklist.length} done. The most important first.` : `All ${checklist.length} done.`}>
        <div className="ad-panel-body grid gap-2">
          <Meter value={done} max={checklist.length} label="Website set up" />
        </div>
        {byPriority.map((g) => (
          <div key={g.p} className="border-t" style={{ borderColor: 'var(--ad-line)' }}>
            <p className="px-[18px] pt-3 text-[12.5px] font-bold" style={{ color: g.p === 'reach' ? 'var(--mm-warn)' : 'var(--ad-muted)' }}>
              {PRIORITY[g.p]}
            </p>
            <ul className="ad-attn">
              {g.items.map((i) => (
                <li key={i.key}>
                  <Link href={href(i.area)} className="ad-attn-row" data-tone={g.p === 'reach' ? 'warn' : undefined}>
                    <span className="ad-attn-main">
                      <span className="ad-attn-title">{i.label}</span>
                      <span className="ad-attn-detail">Now: {i.missing}</span>
                    </span>
                    <span className="ad-attn-go"><span className="ad-attn-go-words">Set it</span><AppIcon name="chevron-right" size={16} /></span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Panel>

      <section className="grid gap-3" aria-label="Areas of the website">
        <h2 className="ad-panel-title">Areas</h2>
        <div className="ad-areas">
          {areas.map((a) => {
            const at = savedAt(site.raw[RAW_KEY[a.key]])
            return (
              <Link key={a.key} href={a.href} className="ad-area">
                <AreaIcon name={ICONS[a.key]} />
                <div className="min-w-0">
                  <div className="ad-area-title">
                    <span>{a.title}</span>
                    <Pill tone={a.tone}>{a.status}</Pill>
                  </div>
                  <p className="ad-area-now">{a.now}</p>
                  {a.gaps.length > 0 && (
                    <ul className="ad-area-gaps">
                      {a.gaps.slice(0, 3).map((g) => <li key={g.key}>{g.label}</li>)}
                    </ul>
                  )}
                  <div className="ad-area-foot">
                    <span>{at ? `Last saved ${fmtDateTime(at)}` : 'Not saved yet'}</span>
                    <span className="ad-link">Open <AppIcon name="chevron-right" size={14} /></span>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      </section>
    </AdminPage>
  )
}
