import type { Metadata, Viewport } from 'next'
import { Suspense } from 'react'
import { Progress } from '@/components/progress'
import './globals.css'

export const metadata: Metadata = {
  title: 'Menu Master NG',
  description: 'Know your cost. Know your price. Know your profit.',
}

// Mobile is built concurrently, not retrofitted.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* The bar across the top while the next page is on its way. */}
        <Suspense fallback={null}><Progress /></Suspense>
        {children}
      </body>
    </html>
  )
}
