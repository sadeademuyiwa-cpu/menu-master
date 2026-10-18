import Link from 'next/link'
import { redirect } from 'next/navigation'
import { revalidatePath, revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { loadSiteSettingsRaw, SITE_SETTINGS_TAG } from '@/lib/data/site'
import { describeWriteError, withNotice } from '@/lib/data/context'
import { Card, SectionHeading, Notice } from '@/components/ui'
import { Button } from '@/components/button'
import { fmtDateTime } from '@/lib/admin/format'
import { HELP_GROUPS, HELP_SCREENS, checkHelpInput, parseHelpVideos } from '@/lib/site/help-videos'

export const dynamic = 'force-dynamic'

const HERE = '/admin/help'

async function saveHelp(formData: FormData) {
  'use server'
  const input = Object.fromEntries(HELP_SCREENS.map((s) => [s.key, String(formData.get(s.key) ?? '')]))
  const checked = checkHelpInput(input)
  if (!checked.ok) redirect(withNotice(HERE, checked.error))
  const supabase = await createClient()
  const { error } = await supabase.rpc('fn_admin_set_site_setting', { p_key: 'help', p_value: checked.value })
  // Every app page carries the Help button: clear the cached settings.
  revalidateTag(SITE_SETTINGS_TAG)
  revalidatePath('/', 'layout')
  const count = Object.keys(checked.value).length
  redirect(withNotice(HERE, describeWriteError(error)
    ?? `Help videos saved. ${count} ${count === 1 ? 'screen shows' : 'screens show'} a Help button.`))
}

export default async function AdminHelpVideos(props: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await props.searchParams
  const raw = await loadSiteSettingsRaw()
  if (!raw) return <Notice>Website settings are not available on this database yet (0057).</Notice>
  if (!raw.help) {
    return (
      <Notice>
        Help videos need database update 0065 first (deploy/runbook/DEPLOY_0065.md). Until then no screen shows a Help button.
      </Notice>
    )
  }

  const stored = raw.help
  const videos = parseHelpVideos(stored)
  const set = Object.keys(videos).length
  const saved = typeof stored._updated_at === 'string' && Object.keys(stored).some((k) => k !== '_updated_at')
  const bad = notice && /needs|not|cannot|could/i.test(notice)

  return (
    <div className="space-y-6">
      {notice && <Notice tone={bad ? 'warn' : 'info'}>{notice}</Notice>}
      <SectionHeading sub="Upload each video to YouTube (Public or Unlisted), copy its link from Share, and paste it beside the screen it explains. That screen then shows a green Help button at the top. Leave a box empty and the screen shows no button.">
        Help videos
      </SectionHeading>
      <p className="text-[13px]" style={{ color: 'var(--mm-muted)' }}>
        An upright video plays upright when its link is a Shorts link (youtube.com/shorts/…), which is what YouTube&apos;s
        Share button gives for a Short. A youtube.com/watch link plays in a wide player.
      </p>

      <form action={saveHelp} className="space-y-6">
        {HELP_GROUPS.map((group) => (
          <Card key={group}>
            <h3 className="text-sm font-semibold">{group}</h3>
            <div className="mt-3 space-y-4">
              {HELP_SCREENS.filter((s) => s.group === group).map((s) => (
                <label key={s.key} className="block">
                  <span className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm font-medium">
                    <span>{s.label}</span>
                    <span className="font-mono text-[12px] font-normal" style={{ color: 'var(--mm-muted)' }}>
                      {s.paths.map((p) => p.replace(':id', '…')).join('  ')}
                    </span>
                  </span>
                  <input
                    name={s.key}
                    defaultValue={typeof stored[s.key] === 'string' ? (stored[s.key] as string) : ''}
                    placeholder="https://youtu.be/…"
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    className="mm-input mt-1 font-mono"
                  />
                </label>
              ))}
            </div>
          </Card>
        ))}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-[13px]" style={{ color: 'var(--mm-muted)' }}>
            {set} of {HELP_SCREENS.length} screens have a video
            {saved && typeof stored._updated_at === 'string' ? ` · Last saved ${fmtDateTime(stored._updated_at)}` : ''}
            {' · '}<Link href="/dashboard" className="underline">Back to the app</Link>
          </span>
          <Button busyLabel="Saving…">Save help videos</Button>
        </div>
      </form>
    </div>
  )
}
