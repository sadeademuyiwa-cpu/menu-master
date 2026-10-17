# Rollout checklist

Launch the identity everywhere at once; a half-changed brand looks like two
companies.

## Product (web/): brand layer, done 16 October 2026, committed on branch launch/2026-10-02 (bbfda01, with the branding folder in f7818e7)
- [x] `MM` tile replaced by the Rising Bowl mark: `web/src/components/brand-mark.tsx` (`BrandMark`, inline SVG, white bowl in dark mode) in the app header and sidebar, setup header, landing header and sign-in pages
- [x] Landing logo: `BrandLockup` (mark + wordmark as real text) is the default header, so Admin → Website `logoUrl` can stay empty; set it only for a custom image. Static files for other services: `web/public/brand/` (lockups, app icons, mark), served at `menumasterng.com/brand/…`
- [x] Icons: `web/src/app/icon.svg` (tile), `favicon.ico` (48/32/16), `apple-icon.png` (180, opaque square so iOS does not paint black corners), `manifest.ts` (Android install, 192/512 + maskable, theme colour matching the page canvas), theme-color meta; `/manifest.webmanifest` added to the public paths
- [x] Fonts: Plus Jakarta Sans + Inter self-hosted with `next/font/local` from `web/src/app/fonts/` (Latin, Pan-Nigerian letters and ₦; 95 KB + 30 KB; OFL files beside them), not Google-hosted, so builds and phones never reach a third host. `h1`/`h2` use the display face from Tailwind's base layer, so utilities on a heading still win; eleven weight-500 headings raised to semibold
- [ ] After the first Vercel preview, view the page source and confirm a `<link rel="preload" as="font">` for each woff2. Local Windows builds omit it because of a path check in Next 15.5's font manifest plugin (it looks for `/next-font-loader/` with forward slashes); Linux builds should not be affected
- [x] Tokens `--mm-forest`, `--mm-gold`, `--mm-gold-text`, `--mm-gold-soft` added to `globals.css` (light and dark); `--mm-accent-strong` is now Forest Green; the plan chooser's "Founding price" label is the first gold use
- [x] Open Graph / Twitter image: `web/src/app/opengraph-image.jpg` and `twitter-image.jpg` (1200 × 630, 87 KB) with alt text; the landing page's `generateMetadata` carries the parent's images into its own `openGraph` block, which would otherwise drop them, so the preview keeps its content-hashed URL
- [x] Credit for the link-preview photo (Pexels 17952748, Studio Saiz), re-checked 17 October 2026: `06-imagery/credits.md`

## Product (web/): the food look, built 17 October 2026, uncommitted on launch/2026-10-02

Phases 1 and 2 of `09-uiux/04-simplify-plan.md`, as adjusted in its section
1, with the owner's four decisions: sales staff see selling prices but never
costs; dish photos are public by link with unguessable names; the Recipes
tab is now Dishes (address still `/recipes`); WhatsApp receipts use the app's
money format. Ticked items are in the code. They are not live until the
release below runs.

**Looks like food**
- [x] Dish tile: initials over a faint Rising Bowl, brand greens only, never gold (`components/dish-tile.tsx`). Used on Home, the Dishes list, the dish page, New sale, the Sales and purchase pages, Price per head and the setup guide
- [x] Her own dish photos: "Add a photo" on the dish page and on the setup guide's finish, shrunk on the phone (1080 px and a 320 px thumbnail, under 512 KB, location data dropped), with the tip "Photograph the food, not people" (`components/dish-photo-upload.tsx`; needs 0063)
- [x] Home card "Add photos of your best sellers", once, with "Not now"
- [x] "Hide photos to save data" switch on Account, and the phone's data saver respected before the first paint (`components/photo-preference.tsx`, `app/layout.tsx`)
- [x] Public website: real Nigerian food in "Sound familiar?" (pot of jollof, Lagos produce stall, street cook), cropped to food and hands, Forest overlay, 800 px WebP of 60–87 KB in `web/public/photos/`, lazy, credited under the band
- [x] Website gold: the three step numbers are the page's one gold thing (Ink on Harvest Gold)
- [x] Website's drawn "Example dish" phone kept, now drawn with the app's own dish tile and cost bar
- [x] `06-imagery/credits.md`: photographer, Pexels page, licence and date checked for every photo in use
- [ ] Re-crop two templates before they are printed or posted (see `06-imagery/credits.md`, "Before printing or posting"): the A5 flyer shows the street cook's face and part of an apron logo beside our headline; the Instagram post shows a seller's face and a readable number plate
- [ ] One pot drawing for the empty Dishes list and the first-day Home (not built)
- [ ] Real screenshots of the live app in Admin → Website "Inside the app", after the release; never the mockups

**Fewer numbers, graphs where they help**
- [x] Money reads ₦850, not ₦850.00, with kobo only when there are kobo (`money()` in `lib/format`); percentages read 15% (`percent()`). A missing figure still says "not entered" or "not known yet", never ₦0
- [x] WhatsApp receipts and quotes in the same money format (`lib/receipt.ts`, decision 4)
- [x] Charts drawn as inline SVG, brand greens only, with "not known yet" gaps and a hidden table for screen readers (`components/charts.tsx`): the week's sold and kept bars on Home and Sales, a price line on ingredients, purchases and customers, and what a plate is made of on the dish page
- [x] "Use ₦1,450" with a one-line "From now on…" confirm and a toast, on Home's "Needs you", the dish page and Prices; "Try a price" on the dish page. Shown only to owner, manager and accountant, decided on the server

**Easier to find**
- [x] Tab Recipes renamed Dishes; address unchanged
- [x] Each tool lights its own tab and has a back link: Customers and Price per head under Sales, Ingredients and Suppliers under Purchases, Sizes and Prices under Dishes (`parentTab()` in `lib/nav.ts`)
- [x] More cut to six tiles for an owner, with a "Moved:" line until 15 December 2026
- [x] One name per thing: Dish, Size, Settings

**Who sees what**
- [x] Sales staff see each dish's selling price on New sale (`fn_menu_prices`, migration 0064), never a cost, "you keep", margin or "Use ₦…"; kitchen sees no price, as before

**Still to do before the release**
- [ ] Update the e2e journeys for the new words and money format (about 69 exact `.00` checks, the "Recipes" tab label in `nav-responsive.mjs` and `shoot.mjs`), and add the `people.mjs` check that a sales member's Home and New sale show no "you keep" and no "Use ₦"
- [ ] Run the journeys and the four-width layout audit on the finished build
- [ ] Commit the build, apart from the untracked root files (`.htaccess`, `MenumasterNG.html`) unless they are meant to be added

## Release: 0063, then 0064, then the app

Production is at 0062. The order matters: an app that reads
`recipes.photo_path` fails to load Home, Dishes and New sale on a database
without 0063. Each step is in its runbook; do not skip the PRE and POST
checks.

1. **Audit first (read-only).** Run `deploy/runbook/PRE_DEPLOY_0063.sql` (expect 9/9) and `deploy/runbook/PRE_DEPLOY_0064.sql` (expect 7/7) in the SQL Editor. Both pass on 0062, so the whole release is checked before anything is written; 0064's row 3 says whether 0063 is in yet.
2. **Apply 0063 (dish photos).** Follow [DEPLOY_0063.md](../../deploy/runbook/DEPLOY_0063.md): psql with `--single-transaction` (the guard refuses the SQL Editor), expect `NOTICE: 0063 OK`, then `POST_VERIFY_0063.sql` 7/7, then `git mv` the file from `migrations/proposed/` to `migrations/`.
3. **Apply 0064 (sales staff see selling prices).** Follow [DEPLOY_0064.md](../../deploy/runbook/DEPLOY_0064.md): only after 0063's POST has passed (0064 refuses to run without it), expect `NOTICE: 0064 OK`, then `POST_VERIFY_0064.sql` 7/7, then `git mv` it out of `proposed/`.
4. **Deploy the app.** Push the committed branch so Vercel builds it, and promote it as usual.
5. **Check on production.** Home, Dishes and New sale load. Add a photo to one dish: it shows on the dish page, Home and New sale. Sign in as a sales member: dish tiles show prices and nothing shows a cost, "you keep" or "Use ₦…". The website's photo band loads on a phone without sign-in. Then confirm the font preload line above.

**If something goes wrong,** go back in the reverse order: redeploy the
previous app first, then `migrations/rollbacks/0064_rollback.sql`, then
`migrations/rollbacks/0063_rollback.sql` (it refuses to run while 0064 is
still applied). The 0063 rollback keeps a `dish` bucket that already holds
photos; empty and delete it in Supabase → Storage.

## Channels
- [ ] WhatsApp Business profile: display picture = `03-logo/png/app-icon-1024.png`, description = positioning one-liner
- [ ] Instagram / X / TikTok / Facebook @menumasterng: avatar, bio, pinned post from `07-templates`
- [ ] Google Business Profile with the logo and the tagline
- [ ] Paystack checkout page logo and brand colour (`#1F7A52`)
- [ ] Transactional email header (Supabase auth emails) with the horizontal lockup

## Print
- [ ] Business cards (`07-templates/src/business-card.html`), 350 gsm matte
- [ ] A5 flyer for markets and food fairs (`07-templates/src/flyer-a5.html`), after the re-crop above
- [ ] Sticker sheet with the mark only, 40 mm, for buka counters

## Governance
- [ ] One person owns this folder. Changes are made here first, then everywhere else.
- [x] Usability session script updated for the new names and the held-back ideas (raised "Sell" button vs the "+", "Market" vs "Purchases", whether owners add dish photos): `docs/USABILITY_SESSIONS.md`
- [ ] Run the three owner sessions (a buka, a caterer, a baker) on the released build, before any further screen is rebuilt
- [ ] Review the guidelines after the three usability sessions and again in April 2027.
- [x] Design system updated with the dish tile, photos, charts, "Use ₦…", the money rules and the gold rule: `09-uiux/00-design-system.md`
