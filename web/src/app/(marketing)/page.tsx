import type { Metadata, ResolvingMetadata } from 'next'
import Link from 'next/link'
import { loadSiteSettings, loadPublicPlans } from '@/lib/data/site'
import { COSTING_FEATURES, TRADING_FEATURES, PLAN_FAQ } from '@/lib/site/plan-features'
import { AppIcon, type IconName } from '@/components/icons'
import { BrandLockup } from '@/components/brand-mark'
import { TrackOnce } from '@/components/track-once'
import { DishTile } from '@/components/dish-tile'
import { CostBreakdown } from '@/components/charts'
import { money, percent } from '@/lib/format'
import { LEGAL } from '@/lib/legal'
import './landing.css'

export async function generateMetadata(_props: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  // Setting openGraph here replaces the parent's whole block, which is where
  // app/opengraph-image.jpg (with its content-hashed URL) arrives from; carry
  // the images over so the link preview survives and stays cache-correct.
  const images = (await parent).openGraph?.images ?? []
  return {
    title: 'Menu Master NG — know what every plate really costs',
    description:
      'Turn your market receipts into the true cost of every dish, the right selling price and the profit on every sale. Built for Nigerian food businesses. 14 days free.',
    openGraph: {
      title: 'Know what every plate really costs',
      description: 'Cost, price and profit for Nigerian food businesses — on your phone. 14 days free, no card needed.',
      type: 'website',
      images,
    },
  }
}

// Static, rebuilt at most every minute: ads send people here, so it must be
// fast. Signed-in owners never see it -- the middleware sends them to the app.
export const revalidate = 60

type Photo = {
  /** In web/public/photos: .webp, because the middleware lets only svg, png,
   *  jpg and webp past the sign-in check (middleware.ts matcher). */
  src: string
  /** What is in the picture, not what it is for. */
  alt: string
  /** object-position for the phone's wider 16:9 cut of the 4:3 photo. */
  focus: string
}

/**
 * Real Nigerian food, beside the owner's real worries. Free Pexels photos,
 * cropped to the food and hands with no faces and no number plates, credited
 * under the band and in branding/06-imagery/credits.md. A vendor's face next
 * to "where is the profit?" would show a real person in a poor light, which
 * the Pexels licence forbids, so the crops leave faces out.
 */
const PAINS: { title: string; body: string; photo: Photo }[] = [
  {
    title: 'Market prices moved again',
    body: 'Tomatoes doubled, gas went up, and your menu prices stayed where they were.',
    photo: { src: '/photos/market-stall-lagos.webp', alt: 'Tomatoes and peppers piled on trays at a Lagos market stall.', focus: '50% 45%' },
  },
  {
    title: 'Busy, but where is the profit?',
    body: 'Orders keep coming, yet there is never enough left at the end of the month.',
    photo: { src: '/photos/street-cook-lagos.webp', alt: 'A street cook in Lagos turns a tray of meat and sliced onions.', focus: '50% 35%' },
  },
  {
    title: 'Pricing by guesswork',
    body: 'You copy the shop next door and hope the price covers what you spent.',
    photo: { src: '/photos/jollof-pot-jos.webp', alt: 'A big pot of jollof rice, just cooked, in Jos.', focus: '50% 40%' },
  },
]

const STEPS: { title: string; body: string }[] = [
  { title: 'Record what you bought', body: 'Your market purchases, the way you buy them: a 50 kg bag of rice, a crate of eggs, a paint bucket of pepper.' },
  { title: 'Build your dish', body: 'Add what goes into it. Menu Master works out the cost of one plate from your own prices.' },
  { title: 'Price it and sell', body: 'See your profit at any price before you change it. Record sales and send receipts on WhatsApp.' },
]

const FEATURES: { icon: IconName; title: string; body: string; plan?: string }[] = [
  { icon: 'recipes', title: 'True cost per plate', body: 'From what you actually paid, in the units you buy. No averages, no guesses.' },
  { icon: 'pricing', title: 'A selling price that pays', body: 'See your profit per plate and margin before you set a price.' },
  { icon: 'purchases', title: 'Prices that keep up', body: 'Record a new purchase and every dish that uses it is costed again.' },
  { icon: 'package', title: 'The hidden costs too', body: 'Packs and sizes, packaging, paid work and your monthly bills.' },
  { icon: 'sales', title: 'Sales and WhatsApp receipts', body: 'Take an order in a few taps and send the receipt straight to WhatsApp.', plan: 'Costing + Sales' },
  { icon: 'reports', title: 'What you really earned', body: 'Daily takings, profit and your best customers, in one place.', plan: 'Costing + Sales' },
]

/**
 * A drawn example of a costed dish, shown when no screenshot is set. It is
 * drawn with the app's own pieces (the dish tile and the cost bar), so the
 * page shows what the dish page really looks like. Biggest part first: the
 * cost bar colours its parts in the order given. Short labels, because the
 * legend has two narrow columns inside the drawn phone.
 */
const EXAMPLE = {
  dish: 'Jollof rice & chicken',
  parts: [
    { label: 'Chicken', amount: 780 },
    { label: 'Rice', amount: 520 },
    { label: 'Pepper mix', amount: 260 },
    { label: 'Oil & spices', amount: 150 },
    { label: 'Pack & gas', amount: 130 },
  ],
  price: 3000,
  tryPrice: 3300,
}

function PhoneMock({ imageUrl }: { imageUrl: string | null }) {
  const cost = EXAMPLE.parts.reduce((s, p) => s + p.amount, 0)
  const keep = EXAMPLE.price - cost
  return (
    <div className="lp-phone" aria-hidden={imageUrl ? undefined : true}>
      <div className="lp-phone-notch" />
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="Menu Master on a phone" className="lp-phone-img" />
      ) : (
        <div className="lp-phone-screen">
          <div className="lp-mock-head">
            <DishTile name={EXAMPLE.dish} size="sm" />
            <div className="min-w-0">
              <p className="lp-mock-eyebrow">Example dish</p>
              <p className="lp-mock-title">{EXAMPLE.dish}</p>
            </div>
          </div>
          <div className="lp-mock-stats">
            <div><span>Cost per plate</span><strong>{money(cost)}</strong></div>
            <div><span>You sell at</span><strong>{money(EXAMPLE.price)}</strong></div>
          </div>
          <div className="lp-mock-profit">
            <span>You keep, per plate</span>
            <strong>{money(keep)}</strong>
            <em>{percent((keep / EXAMPLE.price) * 100)} margin</em>
          </div>
          <p className="lp-mock-label">What one plate costs</p>
          <CostBreakdown
            ariaLabel={`What one plate of ${EXAMPLE.dish.toLowerCase()} is made of.`}
            total={cost}
            parts={EXAMPLE.parts}
          />
          <div className="lp-mock-check">
            <span>Try a price</span>
            <strong>At {money(EXAMPLE.tryPrice)} you keep {money(EXAMPLE.tryPrice - cost)} a plate</strong>
          </div>
          <div className="lp-mock-update">
            <span className="lp-mock-dot" />
            Rice went up at the market. Cost updated.
          </div>
        </div>
      )}
    </div>
  )
}

function Cta({ children = 'Start your free trial', className = '' }: { children?: React.ReactNode; className?: string }) {
  return (
    <Link href="/signup" className={`mm-btn mm-btn-primary lp-cta ${className}`.trim()}>
      {children}
      <AppIcon name="arrow-right" size={18} />
    </Link>
  )
}

export default async function LandingPage() {
  const [site, plans] = await Promise.all([loadSiteSettings(), loadPublicPlans()])
  const L = site.landing
  const wa = L.whatsapp
    ? `https://wa.me/${L.whatsapp}?text=${encodeURIComponent('Hello, I have a question about Menu Master')}`
    : null
  const price = (tier: 'costing' | 'trading') => plans?.find((p) => p.tier === tier) ?? null
  const anyFounding = plans?.some((p) => p.founding !== null && p.standard !== null && p.founding < p.standard)

  return (
    <div className="lp">
      <TrackOnce event="landing_view" />

      {/* --- header ------------------------------------------------------- */}
      <header className="lp-header">
        <div className="lp-wrap flex h-16 items-center justify-between gap-3">
          <Link href="/" className="flex shrink-0 items-center gap-2.5 whitespace-nowrap font-semibold tracking-tight">
            {L.logoUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={L.logoUrl} alt={LEGAL.productName} className="h-8 w-auto" />
              : <BrandLockup size={44} />}
          </Link>
          <nav className="flex items-center gap-1 sm:gap-3">
            <a href="#pricing" className="mm-tap lp-desk px-2 text-sm font-medium" style={{ color: 'var(--mm-muted)' }}>Pricing</a>
            <Link href="/login" className="mm-tap whitespace-nowrap px-2 text-sm font-semibold">Log in</Link>
            {/* On a phone the sticky bar at the bottom carries this. */}
            <Link href="/signup" className="mm-btn mm-btn-primary lp-desk">Start free</Link>
          </nav>
        </div>
      </header>

      <main>
        {/* --- hero --------------------------------------------------------- */}
        <section className="lp-hero">
          <div className="lp-wrap grid items-center gap-12 lg:grid-cols-[1.1fr_0.9fr]">
            <div>
              <p className="lp-pill">Built for Nigerian food businesses</p>
              <h1 className="lp-h1">Know what every plate really costs — and price it to profit.</h1>
              <p className="lp-lead">
                Menu Master turns your market receipts into the true cost of each dish, shows you what
                to charge, and tells you the profit on every sale. All from your phone.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Cta />
                <a href="#how" className="mm-btn mm-btn-secondary lp-cta">See how it works</a>
              </div>
              <ul className="lp-trust">
                <li><AppIcon name="check" size={16} /> 14 days free</li>
                <li><AppIcon name="check" size={16} /> No card needed</li>
                <li><AppIcon name="check" size={16} /> Works on any phone</li>
              </ul>
            </div>
            <div className="flex justify-center lg:justify-end">
              <PhoneMock imageUrl={L.heroImageUrl} />
            </div>
          </div>
        </section>

        {/* --- pains, over real food ---------------------------------------- */}
        <section className="lp-section">
          <div className="lp-wrap">
            <h2 className="lp-h2">Sound familiar?</h2>
            <div className="lp-pains">
              {PAINS.map((p) => (
                <article key={p.title} className="lp-pain">
                  <div className="lp-photo">
                    {/* A plain <img>: the file is already 800 px and under
                        90 KB, and next/image would only fetch it again
                        through this server. Lazy, so a visitor who never
                        scrolls this far never downloads it. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.photo.src}
                      alt={p.photo.alt}
                      width={800}
                      height={600}
                      loading="lazy"
                      decoding="async"
                      style={{ objectPosition: p.photo.focus }}
                    />
                    <h3 className="lp-pain-title">{p.title}</h3>
                  </div>
                  <p className="lp-muted lp-pain-body">{p.body}</p>
                </article>
              ))}
            </div>
            <p className="lp-credit">Photos: Godiva Omoruyi, Jboy Designer and Jagaba Denis, on Pexels.</p>
            <p className="lp-answer">
              Menu Master answers one question for every dish you sell: <strong>after paying for everything in it, what do you keep?</strong>
            </p>
          </div>
        </section>

        {/* --- how it works ------------------------------------------------- */}
        <section id="how" className="lp-section lp-tint">
          <div className="lp-wrap">
            <p className="lp-kicker">How it works</p>
            <h2 className="lp-h2">From market receipt to profit in three steps</h2>
            <ol className="lp-steps">
              {STEPS.map((s, i) => (
                <li key={s.title}>
                  <span className="lp-step-n">{i + 1}</span>
                  <h3 className="text-lg font-semibold">{s.title}</h3>
                  <p className="lp-muted mt-2">{s.body}</p>
                </li>
              ))}
            </ol>
            <p className="lp-muted mt-8 text-center text-sm">
              Setup takes about ten minutes, and it walks you through your first dish.
            </p>
          </div>
        </section>

        {/* --- screenshots (admin) ------------------------------------------ */}
        {L.screenshots.length > 0 && (
          <section className="lp-section">
            <div className="lp-wrap">
              <p className="lp-kicker">Inside the app</p>
              <h2 className="lp-h2">Made for a busy kitchen, on a small screen</h2>
              <div className="lp-shots">
                {L.screenshots.map((s, i) => (
                  <figure key={i} className="lp-shot">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={s.url} alt={s.caption || `Menu Master screen ${i + 1}`} loading="lazy" />
                    {s.caption && <figcaption>{s.caption}</figcaption>}
                  </figure>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* --- features ----------------------------------------------------- */}
        <section className="lp-section">
          <div className="lp-wrap">
            <p className="lp-kicker">What you get</p>
            <h2 className="lp-h2">Everything between the market and your profit</h2>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <div key={f.title} className="lp-card">
                  <span className="flex items-center justify-between gap-2">
                    <span className="lp-icon"><AppIcon name={f.icon} size={20} /></span>
                    {f.plan && <span className="lp-tag">{f.plan}</span>}
                  </span>
                  <h3 className="mt-4 text-base font-semibold">{f.title}</h3>
                  <p className="lp-muted mt-1.5">{f.body}</p>
                </div>
              ))}
            </div>
            <div className="lp-promise">
              <AppIcon name="lock" size={20} />
              <p>
                <strong>Your numbers, never invented.</strong> Menu Master calculates only from the figures you enter.
                If a price is missing, it tells you — it never fills the gap with a guess. Your records stay yours.
              </p>
            </div>
          </div>
        </section>

        {/* --- testimonials (admin) ----------------------------------------- */}
        {L.testimonials.length > 0 && (
          <section className="lp-section lp-tint">
            <div className="lp-wrap">
              <p className="lp-kicker">From our customers</p>
              <h2 className="lp-h2">Food businesses that know their numbers</h2>
              <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {L.testimonials.map((t, i) => (
                  <figure key={i} className="lp-card lp-quote">
                    <blockquote>“{t.quote}”</blockquote>
                    <figcaption>
                      <strong>{t.name}</strong>
                      {t.business && <span>{t.business}</span>}
                    </figcaption>
                  </figure>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* --- pricing ------------------------------------------------------ */}
        <section id="pricing" className="lp-section">
          <div className="lp-wrap">
            <p className="lp-kicker">Pricing</p>
            <h2 className="lp-h2">Start free. Pay only when it is working for you.</h2>
            <p className="lp-muted mx-auto mt-3 max-w-xl text-center">
              Every plan starts with a 14-day free trial with everything open. No card needed to start.
            </p>
            <div className="mx-auto mt-10 grid max-w-4xl gap-4 md:grid-cols-2">
              {([
                { tier: 'costing' as const, name: 'Costing', blurb: 'Know your costs and set prices that pay.', features: COSTING_FEATURES },
                { tier: 'trading' as const, name: 'Costing + Sales', blurb: 'Run your sales and see your profit every day.', features: TRADING_FEATURES },
              ]).map((p) => {
                const pr = price(p.tier)
                const popular = p.tier === 'trading'
                return (
                  <div key={p.tier} className="lp-plan" data-popular={popular || undefined}>
                    {popular && <span className="lp-plan-badge">Most complete</span>}
                    <h3 className="text-lg font-semibold">{p.name}</h3>
                    <p className="lp-muted mt-1 text-sm">{p.blurb}</p>
                    <p className="mt-5 flex items-baseline gap-1">
                      {pr?.standard != null ? (
                        <>
                          <span className="text-3xl font-semibold tracking-tight">{money(pr.standard)}</span>
                          <span className="lp-muted text-sm">/month</span>
                        </>
                      ) : (
                        <span className="text-xl font-semibold">Free for 14 days</span>
                      )}
                    </p>
                    <ul className="mt-5 space-y-2.5 text-sm">
                      {p.features.map((f) => (
                        <li key={f} className="flex gap-2">
                          <span className="lp-tick"><AppIcon name="check" size={14} /></span>{f}
                        </li>
                      ))}
                    </ul>
                    <Link href="/signup" className={`mm-btn ${popular ? 'mm-btn-primary' : 'mm-btn-secondary'} mt-7 w-full`}>
                      Start 14 days free
                    </Link>
                  </div>
                )
              })}
            </div>
            {anyFounding && (
              <p className="lp-muted mx-auto mt-6 max-w-xl text-center text-sm">
                Early businesses may get a lower founding price, kept for as long as they stay subscribed.
                You will see it when you choose your plan.
              </p>
            )}
            <p className="lp-muted mx-auto mt-3 max-w-xl text-center text-sm">
              Payments are handled securely by Paystack. Cancel any time.
            </p>
          </div>
        </section>

        {/* --- FAQ ---------------------------------------------------------- */}
        <section className="lp-section lp-tint">
          <div className="lp-wrap max-w-3xl">
            <h2 className="lp-h2">Questions</h2>
            <div className="mt-8 space-y-3">
              {[
                ['Do I need to be good with computers?', 'No. If you can send a WhatsApp message, you can use Menu Master. Setup walks you through your first dish step by step.'],
                ['Does it work for small kitchens and home caterers?', 'Yes. It is made for restaurants, caterers, bakers, small chops and home kitchens — anyone who buys ingredients and sells food.'],
                ['Where do the prices come from?', 'Only from you. You record what you paid at the market; Menu Master never fills in prices for you.'],
                ...PLAN_FAQ,
              ].map(([q, a]) => (
                <details key={q} className="lp-faq">
                  <summary>{q}<AppIcon name="chevron-right" size={18} /></summary>
                  <p>{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* --- final CTA ---------------------------------------------------- */}
        <section className="lp-final">
          <div className="lp-wrap text-center">
            <h2 className="lp-final-h">Find out what your best-selling dish really earns you.</h2>
            <p className="lp-final-sub">It takes ten minutes. The first 14 days are free.</p>
            <div className="mt-8 flex justify-center">
              <Link href="/signup" className="mm-btn lp-final-cta">
                Start your free trial <AppIcon name="arrow-right" size={18} />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} {LEGAL.productName}</p>
          <nav className="flex flex-wrap gap-x-5 gap-y-1" aria-label="Legal">
            <Link href="/terms" className="mm-tap">Terms</Link>
            <Link href="/privacy" className="mm-tap">Privacy</Link>
            <Link href="/refunds" className="mm-tap">Refunds</Link>
            <Link href="/login" className="mm-tap">Log in</Link>
            {wa && <a href={wa} className="mm-tap" target="_blank" rel="noopener noreferrer">WhatsApp us</a>}
          </nav>
        </div>
      </footer>

      {/* On a phone the way in is always one thumb away. */}
      <div className="lp-sticky sm:hidden">
        <Link href="/signup" className="mm-btn mm-btn-primary w-full">Start your free trial</Link>
      </div>

      {wa && (
        <a href={wa} className="lp-wa" target="_blank" rel="noopener noreferrer" aria-label="Ask us on WhatsApp">
          <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden fill="currentColor">
            <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.85 9.85 0 0 0 12.04 2zm5.8 14.12c-.24.68-1.41 1.3-1.95 1.38-.5.07-1.13.1-1.82-.12-.42-.13-.96-.31-1.65-.61-2.9-1.25-4.8-4.17-4.94-4.36-.14-.19-1.18-1.57-1.18-3 0-1.42.75-2.12 1.01-2.41.27-.29.58-.36.78-.36h.56c.18 0 .42-.07.66.5.24.58.82 2 .89 2.15.07.14.12.31.02.5-.1.19-.14.31-.29.48-.14.17-.3.37-.43.5-.14.14-.29.3-.13.59.17.29.74 1.22 1.59 1.97 1.09.97 2.01 1.27 2.3 1.41.29.14.46.12.63-.07.17-.19.72-.84.91-1.13.19-.29.38-.24.65-.14.26.1 1.68.79 1.97.94.29.14.48.22.55.34.07.12.07.7-.17 1.38z" />
          </svg>
        </a>
      )}
    </div>
  )
}
