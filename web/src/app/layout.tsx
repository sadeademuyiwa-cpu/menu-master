import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import { Suspense } from 'react'
import { Progress } from '@/components/progress'
import { Analytics } from '@/components/analytics'
import { loadSiteSettings } from '@/lib/data/site'
import './globals.css'

// The brand's two faces, self-hosted (SIL OFL, licences beside the files) and
// subset to Latin plus the Naira sign: Inter for the interface and numbers,
// Plus Jakarta Sans for headings. Served from this origin, so a build never
// reaches Google and a phone on data never waits on a third host.
const inter = localFont({
  src: './fonts/Inter-var.woff2',
  weight: '100 900',
  variable: '--font-ui',
  display: 'swap',
})
const jakarta = localFont({
  src: './fonts/PlusJakartaSans-var.woff2',
  weight: '200 800',
  variable: '--font-display',
  display: 'swap',
})

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://menumasterng.com'),
  title: 'Menu Master NG',
  description: 'Know your cost. Know your price. Know your profit.',
  applicationName: 'Menu Master NG',
  appleWebApp: { title: 'Menu Master', statusBarStyle: 'default' },
}

// Pages that are otherwise static pick up the admin's website settings
// (pixels) within a minute; a save in the admin clears them at once.
export const revalidate = 60

// Mobile is built concurrently, not retrofitted.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // The browser chrome matches the page canvas, so the header reads as one piece.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f8f6' },
    { media: '(prefers-color-scheme: dark)', color: '#101411' },
  ],
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const site = await loadSiteSettings()
  return (
    <html lang="en" className={`${inter.variable} ${jakarta.variable}`}>
      <body>
        {/* The bar across the top while the next page is on its way. */}
        <Suspense fallback={null}><Progress /></Suspense>
        {children}
        <Suspense fallback={null}><Analytics settings={site.analytics} /></Suspense>
      </body>
    </html>
  )
}
