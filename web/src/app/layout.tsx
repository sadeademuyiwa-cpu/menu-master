import type { Metadata, Viewport } from 'next'
import { Suspense } from 'react'
import { Progress } from '@/components/progress'
import { Analytics } from '@/components/analytics'
import { loadSiteSettings } from '@/lib/data/site'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://menumasterng.com'),
  title: 'Menu Master NG',
  description: 'Know your cost. Know your price. Know your profit.',
}

// Pages that are otherwise static pick up the admin's website settings
// (pixels) within a minute; a save in the admin clears them at once.
export const revalidate = 60

// Mobile is built concurrently, not retrofitted.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const site = await loadSiteSettings()
  return (
    <html lang="en">
      <body>
        {/* The bar across the top while the next page is on its way. */}
        <Suspense fallback={null}><Progress /></Suspense>
        {children}
        <Suspense fallback={null}><Analytics settings={site.analytics} /></Suspense>
      </body>
    </html>
  )
}
