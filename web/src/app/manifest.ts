import type { MetadataRoute } from 'next'

/**
 * Web app manifest, so "Add to Home screen" on Android installs Menu Master
 * with the Rising Bowl icon and opens it full-screen on /dashboard. The icon
 * files live in public/brand/ (source: branding/03-logo/).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Menu Master NG',
    short_name: 'Menu Master',
    description: 'Know your cost. Know your price. Know your profit.',
    start_url: '/dashboard',
    display: 'standalone',
    // Same canvas as the page's theme-color meta, so an installed launch does
    // not flash one colour and settle on another.
    background_color: '#f7f8f6',
    theme_color: '#f7f8f6',
    icons: [
      { src: '/brand/app-icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/brand/app-icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/brand/app-icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
