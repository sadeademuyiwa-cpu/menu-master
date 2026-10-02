import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { isPublicPath } from '@/lib/public-paths'
import { SETUP_COOKIE, isSetupExempt, needsFirstRunSetup, type SetupFacts } from '@/lib/setup-gate'
import { SOURCE_COOKIE, encodeSource, sourceFromUrl } from '@/lib/analytics/events'

type Client = ReturnType<typeof createServerClient>

/**
 * What first-run setup needs to know, read under the caller's own RLS. Null
 * when any lookup fails: an unanswered question never locks an owner out.
 */
async function setupFacts(supabase: Client, userId: string): Promise<SetupFacts | null> {
  const { data: membership, error: mErr } = await supabase.from('memberships')
    .select('role').eq('user_id', userId).order('created_at').limit(1).maybeSingle()
  if (mErr) return null
  if (!membership) return { hasBusiness: false, role: null, completeCostings: 0, pricesSet: 0 }
  const role = (membership as { role: string }).role
  if (role !== 'owner' && role !== 'manager') {
    return { hasBusiness: true, role, completeCostings: 0, pricesSet: 0 }
  }

  // "Is there at least one?" is all setup needs, so read one row rather than
  // ask for an exact count: cheaper, and it does not depend on a header.
  const [business, costings, prices] = await Promise.all([
    supabase.from('businesses').select('id').is('deleted_at', null).limit(1),
    supabase.from('cost_snapshots').select('id').eq('is_complete', true).limit(1),
    supabase.from('recipe_prices').select('id').limit(1),
  ])
  if (business.error || costings.error || prices.error) return null
  return {
    hasBusiness: (business.data?.length ?? 0) > 0,
    role,
    completeCostings: costings.data?.length ?? 0,
    pricesSet: prices.data?.length ?? 0,
  }
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          toSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          toSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const isPublic = isPublicPath(path)

  // The advert or link that brought a new visitor: first touch only, a
  // session cookie, used at signup only if they accept cookies.
  if (!user && isPublic && !request.cookies.get(SOURCE_COOKIE)) {
    const source = sourceFromUrl(request.nextUrl)
    if (source) {
      response.cookies.set(SOURCE_COOKIE, encodeSource(source), { path: '/', sameSite: 'lax', httpOnly: false })
    }
  }

  // The landing page is for visitors. A signed-in owner who opens the site
  // goes straight to their app (?preview=1 lets an admin look at it).
  if (user && path === '/' && !request.nextUrl.searchParams.has('preview')) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    url.search = ''
    return NextResponse.redirect(url)
  }

  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // D7: email confirmation is required. An unconfirmed session may only reach
  // the verify-email page. This is a convenience redirect -- the database is
  // still the enforcement point for everything that matters.
  if (user && !user.email_confirmed_at && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/verify-email'
    return NextResponse.redirect(url)
  }

  // First-run setup is compulsory for a new owner: the app is only useful once
  // one dish is costed from their own purchases and has a price. The database
  // is asked only until that is true; the cookie then remembers it. A forged
  // cookie skips a tutorial and nothing else -- RLS still guards every write.
  if (user && !isPublic && !isSetupExempt(path) &&
      request.cookies.get(SETUP_COOKIE)?.value !== user.id) {
    const facts = await setupFacts(supabase, user.id)
    if (facts && needsFirstRunSetup(facts)) {
      const url = request.nextUrl.clone()
      url.pathname = '/start'
      url.search = ''
      return NextResponse.redirect(url)
    }
    if (facts?.hasBusiness) {
      response.cookies.set(SETUP_COOKIE, user.id, {
        httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365,
      })
    }
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp)$).*)'],
}
