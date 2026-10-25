import { adminWebsiteFacts } from '@/lib/data/admin'
import { Notice, Field } from '@/components/ui'
import { Button } from '@/components/button'
import { legalEntityWords, legalFooterParts } from '@/lib/site/settings'
import { AdminPage, FormPanel, SettingsSection, ViewOnSite } from '../../_ui/kit'
import { saveCompany } from '../actions'
import { SiteNotice, stampWords, unavailable, UP } from '../_shared'

export const dynamic = 'force-dynamic'

const str = (o: Record<string, unknown>, k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '')

export default async function AdminSiteCompany(props: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await props.searchParams
  const site = await adminWebsiteFacts()
  if (!site) return <AdminPage title="Company details" up={UP}><Notice>{unavailable}</Notice></AdminPage>

  const raw = site.raw.company ?? {}
  const c = site.facts.company
  const writeTo = c.supportEmail ?? (site.facts.landing.whatsapp ? 'the WhatsApp number on the landing page' : '"our support team", with no address')

  return (
    <AdminPage up={UP} title="Company details"
               description="Who stands behind Menu Master NG, as the Terms, Refunds and Privacy pages say it."
               actions={<ViewOnSite href="/terms">See /terms</ViewOnSite>}>
      <SiteNotice notice={notice} view={{ href: '/terms', label: 'See it on /terms' }} />

      <SettingsSection
        title="Legal details and contact"
        description="Leave anything you do not have yet empty: the pages use neutral words instead, never a placeholder."
        appearsOn={[{ label: '/terms', href: '/terms' }, { label: '/refunds', href: '/refunds' }, { label: '/privacy', href: '/privacy' }]}
        now={
          <ul>
            <li>The terms are between the owner and {legalEntityWords(c)}</li>
            <li>Under every legal page: {legalFooterParts(c).join(' · ')}</li>
            <li>Customers are told to write to {writeTo}</li>
          </ul>
        }
      >
        <form action={saveCompany}>
          <FormPanel stamp={stampWords(raw)} actions={<Button busyLabel="Saving…">Save company details</Button>}>
            <Field label="Legal company name">
              <input name="legal_name" defaultValue={str(raw, 'legal_name')} placeholder="As registered with CAC" className="mm-input mt-1" />
            </Field>
            <Field label="RC number">
              <input name="rc_number" defaultValue={str(raw, 'rc_number')} placeholder="1234567" className="mm-input mt-1" />
              <span className="ad-field-help">Shown after the legal name, so it needs one.</span>
            </Field>
            <Field label="Business address">
              <textarea name="address" defaultValue={str(raw, 'address')} rows={2} placeholder="Street, area, city, state" className="mm-input mt-1" />
            </Field>
            <Field label="Support email">
              <input name="support_email" type="email" defaultValue={str(raw, 'support_email')} placeholder="help@menumasterng.com" className="mm-input mt-1" />
              <span className="ad-field-help">
                Where customers write about billing, refunds and their data. Empty: the pages point to your WhatsApp number, if set.
              </span>
            </Field>
          </FormPanel>
        </form>
      </SettingsSection>
    </AdminPage>
  )
}
