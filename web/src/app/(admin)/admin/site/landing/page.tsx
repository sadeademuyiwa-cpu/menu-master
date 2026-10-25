import { adminWebsiteFacts } from '@/lib/data/admin'
import { Notice, Field } from '@/components/ui'
import { Button } from '@/components/button'
import { ImageField } from '@/components/image-field'
import { MAX_SCREENSHOTS, MAX_TESTIMONIALS } from '@/lib/site/settings'
import { AdminPage, FieldPanel, SaveBar, SettingsSection, ViewOnSite } from '../../_ui/kit'
import { saveLanding } from '../actions'
import { SiteNotice, stampWords, unavailable, UP } from '../_shared'

export const dynamic = 'force-dynamic'

const str = (o: Record<string, unknown>, k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '')

export default async function AdminSiteLanding(props: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await props.searchParams
  const site = await adminWebsiteFacts()
  if (!site) return <AdminPage title="Landing page" up={UP}><Notice>{unavailable}</Notice></AdminPage>

  const raw = site.raw.landing ?? {}
  const l = site.facts.landing
  const shots = Array.isArray(raw.screenshots) ? (raw.screenshots as Record<string, string>[]) : []
  const quotes = Array.isArray(raw.testimonials) ? (raw.testimonials as Record<string, string>[]) : []
  const preview = { label: 'the landing page', href: '/?preview=1' }

  return (
    <AdminPage up={UP} title="Landing page"
               description="The public page visitors land on. Upload a picture from this phone or computer (PNG, JPEG or WebP, up to 2 MB), or paste a link to one. Nothing changes on the website until you press Save; anything left empty is simply not shown."
               actions={<ViewOnSite href="/?preview=1">See the landing page</ViewOnSite>}>
      <SiteNotice notice={notice} view={{ href: '/?preview=1', label: 'See the landing page' }} />

      <form action={saveLanding}>
        <SettingsSection title="Your brand and contact" appearsOn={[preview]}
          description="The logo in the page's header, and the WhatsApp number behind every 'message us'."
          now={<ul>
            <li>Header: {l.logoUrl ? 'your logo' : 'the built-in Menu Master logo'}</li>
            <li>{l.whatsapp ? 'WhatsApp button on the landing page, in the footer and under More in the app' : 'No WhatsApp button anywhere'}</li>
          </ul>}>
          <FieldPanel>
            <ImageField name="logo_url" label="Logo" prefix="logo"
                        defaultValue={str(raw, 'logo_url')} placeholder="https://…/logo.png" />
            <Field label="WhatsApp number for questions">
              <input name="whatsapp" defaultValue={str(raw, 'whatsapp')} placeholder="08012345678" inputMode="tel" className="mm-input mt-1" />
              <span className="ad-field-help">Also used by Terms and Refunds when there is no support email.</span>
            </Field>
          </FieldPanel>
        </SettingsSection>

        <SettingsSection title="Main picture" appearsOn={[preview]}
          description="Beside the headline, inside a drawn phone. A phone screenshot of the app works best."
          now={<p>{l.heroImageUrl ? 'Your picture' : 'A drawn preview of a costed dish'}</p>}>
          <FieldPanel>
            <ImageField name="hero_image_url" label="Main picture (beside the headline)" prefix="hero"
                        defaultValue={str(raw, 'hero_image_url')} placeholder="https://…/app-on-phone.png" />
          </FieldPanel>
        </SettingsSection>

        <SettingsSection title={`Screenshots (${l.screenshots.length} of ${MAX_SCREENSHOTS})`} appearsOn={[preview]}
          description="The 'Inside the app' row. Real screens of the live app only, never mock-ups. The caption is read out to visitors who cannot see the picture."
          now={<p>{l.screenshots.length ? `${l.screenshots.length} shown in 'Inside the app'` : "'Inside the app' is hidden"}</p>}>
          <FieldPanel>
            <div className="ad-slots">
              {Array.from({ length: MAX_SCREENSHOTS }, (_, i) => (
                <div key={i} className="ad-slot" data-filled={shots[i]?.url ? '' : undefined}>
                  <span className="ad-slot-label">No. {i + 1}</span>
                  <ImageField name={`shot_url_${i}`} prefix={`screen-${i + 1}`}
                              defaultValue={shots[i]?.url ?? ''} placeholder={`Screenshot ${i + 1}: https://…`} />
                  <input name={`shot_caption_${i}`} defaultValue={shots[i]?.caption ?? ''} placeholder="Caption" aria-label={`Screenshot ${i + 1} caption`} className="mm-input" />
                </div>
              ))}
            </div>
          </FieldPanel>
        </SettingsSection>

        <SettingsSection title={`Testimonials (${l.testimonials.length} of ${MAX_TESTIMONIALS})`} appearsOn={[preview]}
          description="The 'From our customers' row. Only real customers, in their own words, with their permission."
          now={<p>{l.testimonials.length ? `${l.testimonials.length} shown in 'From our customers'` : "'From our customers' is hidden"}</p>}>
          <FieldPanel>
            <div className="ad-slots">
              {Array.from({ length: MAX_TESTIMONIALS }, (_, i) => (
                <div key={i} className="ad-slot" data-filled={quotes[i]?.quote ? '' : undefined}>
                  <span className="ad-slot-label">No. {i + 1}</span>
                  <textarea name={`t_quote_${i}`} defaultValue={quotes[i]?.quote ?? ''} rows={3} placeholder={`Testimonial ${i + 1}: what they said`} aria-label={`Testimonial ${i + 1} quote`} className="mm-input" />
                  <input name={`t_name_${i}`} defaultValue={quotes[i]?.name ?? ''} placeholder="Their name" aria-label={`Testimonial ${i + 1} name`} className="mm-input" />
                  <input name={`t_business_${i}`} defaultValue={quotes[i]?.business ?? ''} placeholder="Business, city" aria-label={`Testimonial ${i + 1} business`} className="mm-input" />
                </div>
              ))}
            </div>
          </FieldPanel>
        </SettingsSection>

        <SaveBar stamp={stampWords(raw)}>
          <Button busyLabel="Saving…">Save landing page</Button>
        </SaveBar>
      </form>
    </AdminPage>
  )
}
