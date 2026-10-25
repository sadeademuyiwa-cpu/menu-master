import { adminWebsiteFacts } from '@/lib/data/admin'
import { Notice, Disclosure } from '@/components/ui'
import { Button } from '@/components/button'
import { CopyValue } from '@/components/copy-value'
import { showGoogleButton } from '@/lib/site/settings'
import { AdminPage, FieldPanel, FormPanel, Pill, SettingsSection, ViewOnSite } from '../../_ui/kit'
import { saveSignIn } from '../actions'
import { SiteNotice, stampWords, unavailable, UP } from '../_shared'

export const dynamic = 'force-dynamic'

export default async function AdminSiteSignIn(props: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await props.searchParams
  // Asked fresh: this page must show the truth the moment Google is on in Supabase.
  const site = await adminWebsiteFacts(true)
  if (!site) return <AdminPage title="Sign in with Google" up={UP}><Notice>{unavailable}</Notice></AdminPage>

  const { signin, provider } = site.facts
  const googleShown = showGoogleButton(signin, provider)
  const url = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://menumasterng.com').replace(/\/$/, '')
  const siteHost = new URL(url).hostname
  const origins = [url, ...(/^(www\.|localhost$|\d+\.\d+\.\d+\.\d+$)/.test(siteHost) ? [] : [url.replace('://', '://www.')])]
  const supabaseCallback = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/callback`

  return (
    <AdminPage up={UP} title="Sign in with Google"
               description="Owners who sign in with Google skip the confirmation email. The button appears only when Google is switched on in Supabase AND here, so it can never lead to an error page."
               actions={<ViewOnSite href="/login">See /login</ViewOnSite>}>
      <SiteNotice notice={notice} view={{ href: '/login', label: 'See it on /login' }} />

      <SettingsSection
        title="The button"
        description="Both switches must be on for owners to see it."
        appearsOn={[{ label: '/login', href: '/login' }, { label: '/signup', href: '/signup' }]}
        now={<p>The button is <strong>{googleShown ? 'showing' : 'hidden'}</strong> on log in and sign up.</p>}
      >
        <form action={saveSignIn}>
          <FormPanel stamp={stampWords(site.raw.signin)} actions={<Button busyLabel="Saving…">Save sign-in</Button>}>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Pill tone={provider === true ? 'good' : provider === false ? 'warn' : 'neutral'}>
                {provider === true ? 'On in Supabase' : provider === false ? 'Not on in Supabase yet' : 'Could not ask Supabase'}
              </Pill>
              <Pill tone={signin.google ? 'good' : 'neutral'}>{signin.google ? 'Switched on here' : 'Switched off here'}</Pill>
            </div>
            <label className="flex min-h-[44px] items-center gap-3 text-sm font-medium">
              <input type="checkbox" name="google" defaultChecked={signin.google} className="h-5 w-5" />
              Offer “Continue with Google” on log in and sign up
            </label>
          </FormPanel>
        </form>
      </SettingsSection>

      <SettingsSection
        title="Set it up"
        description="Once, in Google Cloud and in Supabase. Each value has a Copy button; paste it where the step says."
      >
        <FieldPanel>
          <Disclosure summary="How to set it up (paste these values)" open={provider !== true}>
            <ol className="list-decimal space-y-4 pl-5 text-sm">
              <li className="space-y-2">
                <p><strong>Google Cloud</strong> → APIs &amp; Services → Credentials → Create credentials → OAuth client ID → Web application.</p>
                {origins.map((o, i) => <CopyValue key={o} label={`Authorised JavaScript origin ${i + 1}`} value={o} />)}
                <CopyValue label="Authorised redirect URI" value={supabaseCallback} />
              </li>
              <li className="space-y-2">
                <p><strong>Google Cloud</strong> → OAuth consent screen: app name Menu Master NG; scopes email, profile, openid.</p>
                <CopyValue label="Authorised domain" value={siteHost} />
                <CopyValue label="Privacy policy link" value={`${url}/privacy`} />
                <CopyValue label="Terms of service link" value={`${url}/terms`} />
              </li>
              <li>
                <p><strong>Supabase</strong> → Authentication → Sign In / Providers → Google: switch on, paste the Client ID and Client Secret from step 1, save.</p>
              </li>
              <li className="space-y-2">
                <p><strong>Supabase</strong> → Authentication → URL Configuration → Redirect URLs: add</p>
                <CopyValue label="Redirect URL" value={`${url}/**`} />
              </li>
              <li>
                <p>
                  Switch it on above. The first badge turns green as soon as step 3 is saved in Supabase; the button on
                  the public pages can take up to five minutes to follow, unless you save here, which updates them at once.
                </p>
              </li>
            </ol>
          </Disclosure>
        </FieldPanel>
      </SettingsSection>
    </AdminPage>
  )
}
