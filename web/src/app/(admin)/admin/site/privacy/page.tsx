import { adminWebsiteFacts } from '@/lib/data/admin'
import { Notice, Field } from '@/components/ui'
import { Button } from '@/components/button'
import { privacyDraft, PRIVACY_DRAFT_DATE } from '@/lib/site/privacy-draft'
import { fmtDate } from '@/lib/admin/format'
import { websiteChecklist } from '@/lib/admin/website'
import { AdminPage, FormPanel, Pill, SettingsSection, ViewOnSite } from '../../_ui/kit'
import { savePrivacy } from '../actions'
import { SiteNotice, stampWords, unavailable, UP } from '../_shared'

export const dynamic = 'force-dynamic'

const str = (o: Record<string, unknown>, k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '')

export default async function AdminSitePrivacy(props: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await props.searchParams
  const site = await adminWebsiteFacts()
  if (!site) return <AdminPage title="Privacy policy" up={UP}><Notice>{unavailable}</Notice></AdminPage>

  const raw = site.raw.privacy ?? {}
  const p = site.facts.privacy
  const stale = websiteChecklist(site.facts).some((i) => i.key === 'privacy_stale')

  return (
    <AdminPage up={UP} title="Privacy policy"
               description="The text at /privacy, which the cookie notice links to."
               actions={<ViewOnSite href="/privacy">See /privacy</ViewOnSite>}>
      <SiteNotice notice={notice} view={{ href: '/privacy', label: 'See it on /privacy' }} />
      {stale && (
        <Notice>
          The company details were changed after this policy was saved, and its text does not give the new ones. Read it
          through and update it, or start again from the draft, which uses the current details.
        </Notice>
      )}

      <SettingsSection
        title="Policy text"
        description='Plain text. A line starting "## " is a heading, "- " a bullet point, and an empty line starts a new paragraph.'
        appearsOn={[{ label: '/privacy', href: '/privacy' }]}
        now={
          <div className="grid gap-1.5">
            <Pill tone={p.body === null ? 'warn' : 'good'}>{p.body === null ? 'The built-in draft' : 'Your text'}</Pill>
            <p>
              {p.body === null
                ? 'Not saved yet: /privacy shows the draft below, built from the company details. Read it, then save.'
                : `In effect from ${fmtDate(p.effectiveDate)}.`}
            </p>
          </div>
        }
      >
        <form action={savePrivacy}>
          <FormPanel stamp={stampWords(raw)} actions={<>
            <Button variant="quiet" name="restore" value="1" busyLabel="Resetting…">Start again from the draft</Button>
            <Button busyLabel="Saving…">Save privacy policy</Button>
          </>}>
            <Field label="Takes effect on">
              <input type="date" name="effective_date" required
                     defaultValue={str(raw, 'effective_date') || PRIVACY_DRAFT_DATE} className="mm-input mt-1 max-w-[12rem]" />
            </Field>
            <Field label="Policy text">
              <textarea name="body" rows={24} defaultValue={str(raw, 'body') || privacyDraft(site.facts.company)}
                        className="mm-input mt-1 max-w-[80ch] text-[14px] leading-6" />
            </Field>
          </FormPanel>
        </form>
      </SettingsSection>
    </AdminPage>
  )
}
