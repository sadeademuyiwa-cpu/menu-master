import { redirect } from 'next/navigation'
import { revalidatePath, revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { SITE_SETTINGS_TAG } from '@/lib/data/site'
import { adminSiteRaw, savedAt } from '@/lib/data/admin'
import { describeWriteError, withNotice } from '@/lib/data/context'
import { Notice } from '@/components/ui'
import { Button } from '@/components/button'
import { noticeTone } from '@/lib/ui/notice-tone'
import { fmtDateTime } from '@/lib/admin/format'
import { HELP_GROUPS, HELP_SCREENS, checkHelpInput, parseHelpVideos } from '@/lib/site/help-videos'
import { AdminPage, Meter, Panel, Pill, SaveBar } from '../_ui/kit'

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
  const raw = await adminSiteRaw()
  if (!raw) return <AdminPage title="Help videos"><Notice>Website settings are not available on this database yet (0057).</Notice></AdminPage>
  if (!raw.help) {
    return (
      <AdminPage title="Help videos">
        <Notice>
          Help videos need database update 0065 first (deploy/runbook/DEPLOY_0065.md). Until then no screen shows a Help button.
        </Notice>
      </AdminPage>
    )
  }

  const stored = raw.help
  const videos = parseHelpVideos(stored)
  const set = Object.keys(videos).length
  const at = savedAt(stored)

  return (
    <AdminPage
      title="Help videos"
      description="Upload each video to YouTube (Public or Unlisted), copy its link from Share, and paste it beside the screen it explains. That screen then shows a green Help button at the top. Leave a box empty and the screen shows no button."
    >
      {notice && <Notice tone={noticeTone(notice, /needs|not|cannot|could/i)}>{notice}</Notice>}

      <Panel>
        <div className="grid gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-lg font-semibold tabular-nums">{set} of {HELP_SCREENS.length} screens have a video</span>
            <span className="ad-small ad-muted">
              An upright video plays upright when its link is a Shorts link (youtube.com/shorts/…); a youtube.com/watch link plays wide.
            </span>
          </div>
          <Meter value={set} max={HELP_SCREENS.length} label="Screens with a help video" />
        </div>
      </Panel>

      <form action={saveHelp} className="ad-stack">
        {HELP_GROUPS.map((group) => {
          const screens = HELP_SCREENS.filter((s) => s.group === group)
          const here = screens.filter((s) => videos[s.key]).length
          return (
            <Panel key={group} title={group} flush
                   action={<span className="ad-small ad-muted tabular-nums">{here} of {screens.length}</span>}>
              {screens.map((s) => {
                const on = Boolean(videos[s.key])
                return (
                  <label key={s.key} className="ad-alert grid gap-2 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] lg:items-center lg:gap-6">
                    <span className="grid gap-1">
                      <span className="flex flex-wrap items-center gap-2 font-semibold">
                        {s.label}
                        <Pill tone={on ? 'good' : 'neutral'}>{on ? 'Showing' : 'Not showing'}</Pill>
                      </span>
                      <span className="ad-mono ad-muted">{s.paths.map((p) => p.replace(':id', '…')).join('  ')}</span>
                    </span>
                    <input
                      name={s.key}
                      defaultValue={typeof stored[s.key] === 'string' ? (stored[s.key] as string) : ''}
                      placeholder="https://youtu.be/…"
                      inputMode="url"
                      autoComplete="off"
                      spellCheck={false}
                      className="mm-input font-mono"
                    />
                  </label>
                )
              })}
            </Panel>
          )
        })}

        <SaveBar stamp={at ? `Last saved ${fmtDateTime(at)}` : 'Not saved yet'}>
          <Button busyLabel="Saving…">Save help videos</Button>
        </SaveBar>
      </form>
    </AdminPage>
  )
}
