# Rollout checklist

Launch the identity everywhere at once; a half-changed brand looks like two
companies.

## Product (web/) — done 16 October 2026, on branch launch/2026-10-02, uncommitted
- [x] `MM` tile replaced by the Rising Bowl mark: `web/src/components/brand-mark.tsx` (`BrandMark`, inline SVG, white bowl in dark mode) in the app header and sidebar, setup header, landing header and sign-in pages
- [x] Landing logo: `BrandLockup` (mark + wordmark as real text) is the default header, so Admin → Website `logoUrl` can stay empty; set it only for a custom image. Static files for other services: `web/public/brand/` (lockups, app icons, mark), served at `menumasterng.com/brand/…`
- [x] Icons: `web/src/app/icon.svg` (tile), `favicon.ico` (48/32/16), `apple-icon.png` (180, opaque square so iOS does not paint black corners), `manifest.ts` (Android install, 192/512 + maskable, theme colour matching the page canvas), theme-color meta; `/manifest.webmanifest` added to the public paths
- [x] Fonts: Plus Jakarta Sans + Inter self-hosted with `next/font/local` from `web/src/app/fonts/` (Latin, Pan-Nigerian letters and ₦; 95 KB + 30 KB; OFL files beside them), not Google-hosted, so builds and phones never reach a third host. `h1`/`h2` use the display face from Tailwind's base layer, so utilities on a heading still win; eleven weight-500 headings raised to semibold
- [ ] After the first Vercel preview, view the page source and confirm a `<link rel="preload" as="font">` for each woff2. Local Windows builds omit it because of a path check in Next 15.5's font manifest plugin (it looks for `/next-font-loader/` with forward slashes); Linux builds should not be affected
- [x] Tokens `--mm-forest`, `--mm-gold`, `--mm-gold-text`, `--mm-gold-soft` added to `globals.css` (light and dark); `--mm-accent-strong` is now Forest Green; the plan chooser's "Founding price" label is the first gold use
- [x] Open Graph / Twitter image: `web/src/app/opengraph-image.jpg` and `twitter-image.jpg` (1200 × 630, 87 KB) with alt text; the landing page's `generateMetadata` carries the parent's images into its own `openGraph` block, which would otherwise drop them, so the preview keeps its content-hashed URL

## Channels
- [ ] WhatsApp Business profile: display picture = `03-logo/png/app-icon-1024.png`, description = positioning one-liner
- [ ] Instagram / X / TikTok / Facebook @menumasterng: avatar, bio, pinned post from `07-templates`
- [ ] Google Business Profile with the logo and the tagline
- [ ] Paystack checkout page logo and brand colour (`#1F7A52`)
- [ ] Transactional email header (Supabase auth emails) with the horizontal lockup

## Print
- [ ] Business cards (`07-templates/src/business-card.html`), 350 gsm matte
- [ ] A5 flyer for markets and food fairs (`07-templates/src/flyer-a5.html`)
- [ ] Sticker sheet with the mark only, 40 mm, for buka counters

## Governance
- [ ] One person owns this folder. Changes are made here first, then everywhere else.
- [ ] Review the guidelines after the three usability sessions and again in April 2027.
