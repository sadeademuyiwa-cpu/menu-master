import type { Metadata } from 'next'
import { LegalPage, H2 } from '@/components/legal-page'
import { loadSiteSettings } from '@/lib/data/site'
import { plainDoc } from '@/lib/site/settings'
import { privacyDraft, PRIVACY_DRAFT_DATE } from '@/lib/site/privacy-draft'

export const metadata: Metadata = { title: 'Privacy policy — Menu Master NG' }

// Static, refreshed within a minute of the admin saving a new version.
export const revalidate = 60

function longDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' })
}

/**
 * The privacy policy, as the platform admin last saved it (Admin → Website),
 * or the bundled draft until they do. The text is plain: headings, bullets
 * and paragraphs become elements, never HTML.
 */
export default async function PrivacyPage() {
  const { privacy, company } = await loadSiteSettings()
  const body = privacy.body ?? privacyDraft(company)
  const date = privacy.effectiveDate ?? PRIVACY_DRAFT_DATE
  return (
    <LegalPage title="Privacy policy" updated={longDate(date)}>
      {plainDoc(body).map((b, i) =>
        b.kind === 'h2' ? <H2 key={i}>{b.text}</H2>
        : b.kind === 'ul' ? (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {b.items.map((t, j) => <li key={j}>{t}</li>)}
          </ul>
        )
        : <p key={i}>{b.text}</p>,
      )}
    </LegalPage>
  )
}
