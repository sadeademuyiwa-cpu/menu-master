# Design system

The product's visual language, written down so a new screen looks like
the old ones. The live source of truth for tokens is
`web/src/app/globals.css`; this document names them, adds the brand
layer (fonts, logo, gold) and lists the components with their rules.
The CSS that implements all of it for the mockups is `screens/_app.css`.

Updated 17 October 2026 for the food look (`04-simplify-plan.md`, section
1): dish pictures, fewer numbers, small charts and less text. Section 5b
lists the components that carry it. Where this document and the mockups
disagree, this document wins; the mockups have no food photos and are
reference only.

## 1. Principles

1. **Phone first, worst phone first.** Design at 360–390 px, one column, thumb reach, no sideways scroll. Desktop gets a sidebar and two columns, nothing more.
2. **One primary action per screen.** Green button, bottom of the content, sticky on phones. Everything else is secondary (outlined) or a text link.
3. **Numbers are the product, so show fewer of them.** One figure per card. ₦850, not ₦850.00; 15%, not 15.00%. Kobo only where they matter. Tabular figures, ₦ tight to the number, and a missing number is a word, never ₦0 (section 5c).
4. **Food first.** A dish shows as a picture: her own photo once she has taken one, and until then a tile with its initials. Never a stock or AI photo in a dish slot, and no photos on ingredients, purchases or reports, where the numbers are the point.
5. **A picture where it helps.** A small chart instead of a column of figures: the week as bars, what a plate is made of as one bar, a price over time as a line. Every chart says in one sentence what it shows.
6. **States are the design.** Every list has an empty state; every submit has a busy state and a toast; every irreversible act has a confirm sheet.
7. **Say it in the owner's words, and say less.** Dish, plate, pot, paint, what you keep. A page gets at most one short line under its title; longer explanations go behind the (i).
8. **Calm.** White space, one accent, no decoration. Gold appears once per screen at most, and never on a screen with an amber warning.

## 2. Tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `--mm-bg` | `#F7F8F6` | `#101411` | Page |
| `--mm-surface` | `#FFFFFF` | `#171D19` | Cards, inputs |
| `--mm-surface-2` | `#F0F3F0` | `#1D251F` | Inset panels, table heads, segmented control, the "soft" dish tile |
| `--mm-fg` | `#171B18` | `#F2F6F3` | Text |
| `--mm-muted` | `#66706A` | `#98A39D` | Secondary text |
| `--mm-line` | `#DDE3DE` | `#29322C` | Borders |
| `--mm-accent` | `#1F7A52` | `#5AC58F` | Primary action, links, active nav, "good" |
| `--mm-accent-strong` | `#0F5E3C` (was `#17633F`) | `#70D8A4` | Hover, pressed, headings on mint |
| `--mm-accent-soft` | `#E8F5EE` | `#173426` | Selected, badge "good", icon tiles |
| `--mm-warn` / `-soft` | `#A06300` / `#FFF6DF` | `#E3B14E` / `#33290F` | Below target, stale, unpaid |
| `--mm-bad` / `-soft` | `#B42318` / `#FDECEA` | `#F08C7D` / `#3B1512` | Missing price, below cost, errors |
| `--mm-forest` | `#0F5E3C` | same | Logo green, marketing blocks, "kept" in charts, the photo overlay |
| `--mm-gold` / `--mm-gold-text` / `-soft` | `#D4A020` / `#8A6A0E` / `#FBF3DC` | `#D4A020` / `#E6B94A` / `#2E2510` | The screen's one highlight (section 5d) |
| `--mm-radius` / `-sm` | 16 px / 11 px | | Cards / controls |
| `--mm-touch` | 46 px | | Minimum height of anything tappable |
| `--mm-motion-fast` / `--mm-motion` | 120 ms / 220 ms, `cubic-bezier(.2,0,0,1)` | | Hover, sheets; 0 under reduced motion |
| Shadows | `0 10px 30px -20px rgb(24 38 29/.45)` and a 2 px soft | | Sheets, FAB; cards use the soft one |

Chart colours are set on `.mm-chart` and `.mm-spark` in `globals.css`:
sold is Kitchen Green at 32% over the surface, kept is Forest (Leaf in dark
mode), and "not known yet" is a dashed or hatched `--mm-muted`.

Spacing scale: 4, 8, 12, 16, 18, 24, 32. Page gutter 16 px on phones, 32 px on desktop. Content max-width 1040 px.

## 3. Type

Inter for everything in the app; Plus Jakarta Sans 700 for page titles and section headings (`h1`, `h2`). Full scale in `05-typography/typography.md`. In the app:

- Page title 26 / 1.1 Jakarta 700. Section heading 18 Jakarta 700. Card title 16 Inter 600.
- Body 15–16 / 1.5. Hints 13 / 1.45 muted. Eyebrow 11 / caps / +0.06 em / 600.
- Hero number 34 Inter 700 tabular. Stat 22. Row amount 16 Inter 700.
- Every figure, including chart labels, is Inter with tabular numbers (`.mm-num`), so columns of money line up.

## 4. Layout and navigation

- **Phone (< 768):** sticky header (business name + account chip), content, bottom bar with the five destinations (Home, Sales, Purchases, Dishes, More), a green "+" quick-add above it. The "+" offers only what the person's role can do. `.mm-main` keeps 160 px plus the safe area free at the bottom, so the "+" never covers the last card.
- **Tablet (768–1023):** same, the five destinations move into the header as pills.
- **Desktop (≥ 1024):** 248 px sidebar (brand, five destinations, Settings and Account at the bottom), header carries the "New sale" button, content in one or two columns.
- The fourth tab is **Dishes**; its address stays `/recipes`, so no link or bookmark broke.
- Every page outside the five belongs to one of them, lights that tab, and shows a back link to it at the top left: Customers and Price per head → Sales; Ingredients and Suppliers → Purchases; Sizes and Prices → Dishes; Settings, People, Reports, Plans & billing, Account, Setup guide and Administration → More. `activeHref()` and `parentTab()` in `web/src/lib/nav.ts` decide it; use `parentTab(pathname)` with `BackLink` (`components/ui.tsx`) rather than hard-coding the parent.
- More has six tiles for an owner (Settings, People, Reports, Plans & billing, Account, Setup guide), plus Administration for a platform admin. Until 15 December 2026 a "Moved:" line on More links to the pages that left it.
- A page is never without an active nav item.
- Same five tabs for every role. What changes by role is what a screen shows and which buttons it offers, decided on the server (section 5c).

## 5. Components

| Component | Rule |
|---|---|
| **Page header** | Title, wrapping to two lines rather than being cut off. At most one short line under it, and only where the title alone is unclear; a longer explanation sits behind the (i) beside it. |
| **Section heading** | Title, optional subtitle, optional right-aligned link ("All dishes ›"). |
| **Card** | White, 1 px line, 16 px radius, 16 px padding. Lists use `pad-0` and rows. One figure per card. |
| **Row** | Dish tile or icon, title (with up to one badge), meta line, right-aligned amount with a small caption. 60 px min. Whole row tappable. |
| **Tile** | Icon tile + label + hint; 2-up on phones, 4-up on desktop. For navigation, never for data. Not to be confused with the dish tile (5b). |
| **Stat** | Eyebrow, big tabular number, caption. Colour only when it carries meaning (good/warn/bad). |
| **Hero stat trio** (dish page) | Cost → price → keep, in that order, always. |
| **Status dot** | A green, amber or red dot beside "you keep ₦X", in place of four figures. Always with words for a screen reader (`role="img"` and an `aria-label` such as "Below target") and never the only sign. |
| **Badge** | 12 px, pill. good / warn / bad / neutral / gold / outline. One per row. Text is a plain phrase: "Below target", "No price for pepper". |
| **Notice** | info / warn / bad / gold. Icon, bold lead, one sentence, optional link. Never stacks more than two. |
| **Empty state** | Icon tile, 17 px title, one sentence, the primary action. Shown on first visit of every list. |
| **Button** | primary (green, white), secondary (white, line), ghost (green text), danger (white, red text and line), gold (founding/upgrade only), wa (WhatsApp green, only for sending to WhatsApp). 46 px. Sentence case. One primary per screen. Busy state: spinner + label change + disabled. |
| **Sticky CTA** | On phones the primary action sits above the bottom bar; on desktop it is static at the end of the column. |
| **Input** | 46 px, 11 px radius, 16 px text (prevents iOS zoom), ₦ or unit as a prefix/suffix inside the field. Focus: green ring. Error: red line + message under. |
| **Segmented control** | For 2–4 mutually exclusive options that change the view (Today / Week / Month, Cash / Transfer / POS / Later). |
| **Tabs** | For filtered views of the same list, with counts ("Needs attention · 3"). |
| **Key-value list** | Label left muted, value right bold tabular, total row bold. Used for summaries and receipts. |
| **Table** | Desktop and dense phone data (Prices, Reports). Right-aligned numbers, uppercase 11 px headers. Where a chart can say it (Reports by day or by dish), put the chart first and keep the table one tap away. |
| **Progress** | 6 px bar + "Step 1 of 3" or "1 of 4 done". |
| **Steps list** | Numbered circles: done (green tick), next (green ring), later (grey). |
| **Bottom sheet** | `components/sheet.tsx`. For confirms and quick edits on phones; dialog on desktop. Title, one sentence, optional field, two buttons (Keep / Do it). |
| **Toast** | Dark, bottom, 4 s, icon + bold lead + sentence. On every outcome: saved, refused, failed. A server action redirects with `?notice=` and the toaster shows it. |
| **Skeleton** | Grey bars in the shape of the content while a read-only page loads. |
| **Lock panel** | Gold-soft card for a feature outside the plan: lock icon, what it is, the upgrade button, "what's included". Never a dead button. |
| **Receipt** | White, 12 px radius, mark + business name, lines, dashed total rule, "Thank you for your order." What the WhatsApp text mirrors, in the same money format as the app. |

## 5a. Brand components in the code

- `BrandMark` (`web/src/components/brand-mark.tsx`): the Rising Bowl as inline SVG; `size` is its height. Bowl colour `--mm-brand-bowl` (Forest, white in dark mode), bars `--mm-brand-gold`.
- `BrandLockup`: mark + "Menu Master" in the display face at 800 + gold "NG", as real text. Landing header, sign-in, setup. Inside the app the header shows the mark beside the business's own name, never the lockup.
- Fonts come from `next/font/local` in `app/layout.tsx` as `--font-ui` (Inter) and `--font-display` (Plus Jakarta Sans); `h1`, `h2` and `.mm-display` take the display face.

## 5b. Food, prices and charts in the code

All imports use the `@/` alias for `web/src`. Their CSS is in the
"DISHES, PHOTOS AND CHARTS" section of `globals.css`, inside
`@layer components`, so a utility passed in `className` still wins. Put new
component CSS inside that layer too: a loose rule beats every Tailwind
utility on the same element.

### Dish tile: `DishTile` (`components/dish-tile.tsx`)

```tsx
<DishTile name={dish.name} photoPath={dish.photo_path} size="sm" />
```

- **What it shows.** Her own photo when the dish has one; until then, the dish's first two letters ("JR" for Jollof rice) over a faint Rising Bowl. The tile is plainly a placeholder and never pretends to be her food.
- **Sizes.** `xs` 32 px, `sm` 40 px, `md` 56 px (squares, for rows and lists; `md` is the default); `card` fills its box at 4:3 (Home's "Your dishes" grid); `lg` fills the width at 16:9, at most 240 px tall (the dish page header). Only `lg` loads the full photo; the rest load the 320 px thumbnail.
- **Colour.** Chosen from the name, so a dish looks the same everywhere: Forest with white letters, Kitchen Green with white, Surface 2 with Forest, or white with a Kitchen Green border. Never gold, amber, red or mint, so a grid of dishes never reads as a grid of warnings.
- **Loading.** The photo is an `<img alt="" loading="lazy" decoding="async">` laid over the tile, so a slow photo shows the tile through it and a failed one repaints the tile with no broken-image icon. Keep it lazy everywhere, the dish page included, or "Hide photos" stops saving data.
- **Accessibility.** It is `aria-hidden`. Always print the dish name beside it.
- **Server-safe.** No hooks, so a server page and the sale screen (a client component) both render it.

### Adding a photo: `DishPhotoUpload` (`components/dish-photo-upload.tsx`)

```tsx
{canAddDishPhotos(ctx.role) && (
  <DishPhotoUpload businessId={recipe.business_id} recipeId={recipe.id}
                   photoPath={recipe.photo_path} action={setDishPhoto} />
)}
```

- **What it does.** "Add a photo" (or "Change photo" and "Remove photo" once there is one) opens the phone's camera or gallery. The phone shrinks the photo before sending: a 1080 px copy (about 120 KB) and a thumbnail 320 px on its short side (about 15 KB), WebP or else JPEG, under 512 KB. Redrawing it drops the camera's notes, the kitchen's GPS location among them.
- **The tip** under the button: "Daylight from a window, shoot from above, right after dishing. Photograph the food, not people."
- **Storage.** Both files go to the public `dish` bucket under `<business_id>/<recipe_id>/<32 random hex>.<webp|jpg>`, the thumbnail with `-320` before the extension. Public by link with an unguessable name (owner's decision, October 2026). `recipes.photo_path` stores the full photo's name (migration 0063).
- **Who.** Owner, manager and kitchen (`canAddDishPhotos`, `lib/dish-photo.ts`), the same people who can edit dishes. Storage refuses everyone else anyway.
- **The action.** You write it beside the page. It receives `recipe_id`, `photo_path` (`''` means remove) and `return_to`, checks `isDishPhotoPath(path, businessId, recipeId)` before writing, saves with `.select()` (an update RLS refuses returns no error and zero rows), revalidates and redirects with `?notice=`.
- **Helpers** in `lib/dish-photo.ts`: `dishPhotoUrl(path, 'thumb' | 'full')`, `newDishPhotoPaths`, `isDishPhotoPath`, `dishThumbPath`, `dishInitials`, `dishTileTone`, `dishPhotoDimensions`.

### Hiding photos: `PhotoPreference` (`components/photo-preference.tsx`)

- **What it is.** The "Hide photos to save data" switch (`role="switch"`), in its own "Photos" card on Account. It is not needed anywhere else.
- **Where the choice lives.** In this phone's `localStorage` (`mm_photos`), not on the account: an owner on Wi-Fi at home and on a bundle at the market may want different answers. It sets `<html data-photos>` at once, and other tabs follow.
- **Before the first paint.** A script in `app/layout.tsx` applies the saved choice. With no choice saved, the phone's own data saver decides.
- **What hides.** `html[data-photos=off]` hides every dish photo and the tile shows instead. Because the photos are lazy, a hidden one is never downloaded. The public website's photo band follows the same switch.

### "Use ₦1,450": `UsePrice` (`components/use-price.tsx`)

```tsx
{canSetPrices(ctx.role) && (
  <UsePrice recipeId={p.recipe_id} variantId={p.variant_id} price={n(p.recommended_price)}
            dishName={p.product_name} action={setPrice} returnTo="/dashboard" variant="quiet" />
)}
```

- **What it does.** Offers the suggested price in two taps. It opens a sheet saying "From now on, <dish> sells for ₦1,450." with Confirm (busy "Saving…") and Keep current price. Confirming calls `setPrice` (`lib/actions/set-price.ts`), which appends the price (undo is setting the old one again), and the toast confirms it.
- **Sizes.** Pass `sizes` instead of `price` to set every size at once; the label becomes "Use suggested prices for both sizes".
- **Nothing to offer.** It renders nothing when the price is missing or not above zero, so an incomplete cost is never offered a number.
- **Role gate on the server.** It has no role prop on purpose: the suggested price is worked out from a cost, so rendering it sends that figure to the phone. Render it only when `canSetPrices(ctx.role)` (owner, manager, accountant), and do not fetch the figure otherwise.
- **Forms.** Never put it inside another `<form>`; its sheet carries its own.

### Charts (`components/charts.tsx`)

Inline SVG, no library, rendered on the server. Brand greens and neutrals
only: no gold, no amber, no red, because a chart is not a warning and gold
is the screen's one highlight. Every chart:

- takes `ariaLabel`, one plain sentence of what it shows ("Sold and kept, each day this week.");
- carries a visually hidden table of its numbers for a screen reader;
- draws an unknown value as a visible gap labelled "not known yet": a dashed outline or a hatch, never a bar of zero;
- needs at least three known points, otherwise it shows the caller's friendly empty state.

| Chart | Use | Rules |
|---|---|---|
| `WeekBars({ days, ariaLabel, empty?, caption?, height? })` | Home: what came in and what she kept, day by day | Two bars a day, sold (light) and kept (Forest; Leaf in dark mode). A day with sales but an unknown cost shows a dashed outline the height of sold, and the legend adds "not known yet". A loss goes below the line. Fewer than 3 days with sales shows `empty`, such as "Record sales on three days and your week shows here." |
| `Sparkline({ points, ariaLabel, labels?, tone?, format?, width?, height?, empty? })` | Beside one sentence: "Rice up 8% since September" on an ingredient or a purchase row | A null point is a gap in the line; the last point gets a dot. `tone` forest, kitchen or muted. `format` money, percent or number for the hidden table. |
| `CostBreakdown({ parts, total, ariaLabel, caption? })` | The dish page: what one plate is made of, as one bar instead of a column of figures | One rounded bar with a two-column legend of up to 6 rows; more parts fold the smaller ones into "Everything else". A part whose amount is null is hatched and labelled "not known yet"; its width is room to see the gap, not a measure. Pass amounts per portion so they add up to `total`. Renders nothing if there is nothing to draw. |

## 5c. Money, percentages and who sees them

**Formatting** (`lib/format/index.ts`):

| Function | Gives | Use |
|---|---|---|
| `money(v)` | ₦850, ₦184,500; kobo only when there are kobo (₦218.75, ₦1.70); a loss is -₦200; a real 0 is ₦0 | Every amount in the app, the WhatsApp receipt and quote, and the website |
| `moneyExact(v)` | Always two decimals: ₦850.00 | Only where kobo must line up, such as a table of ingredient unit prices |
| `percent(v)` | Whole numbers (15%, -13%); one decimal only below 1% (0.4%); a half rounds away from zero, as PostgreSQL does | Margins and targets |

- **Missing is a word.** `money(null)` says "not entered" and `percent(null)` "not available", never ₦0 or 0%. Pass a better word as the second argument where it reads better: "not known yet", "no price yet". A chart draws the gap; it never draws a zero.
- **The sums.** `keepAt(price, cost)`, `marginAt(price, cost)` and `suggestedPrice(cost, target, roundTo)` in `lib/pricing.ts` are the same sums as the database's `v_price_check`. Each returns null when any input is missing. Pass a cost only when the costing is complete. Label a figure worked out on the phone "about".

**Who sees what.** The rule is decided on the server, never by hiding
something that was sent:

| Role | Selling prices | Costs, "you keep", margins, suggested prices, "Use ₦…" | Sets prices | Adds dish photos |
|---|---|---|---|---|
| Owner, manager | yes | yes | yes | yes |
| Accountant | yes | yes | yes | no |
| Sales | yes (`fn_menu_prices`, migration 0064) | **no** | no | no |
| Kitchen | no ("No price yet") | **no** | no | yes |

Use `canSeeCosts`, `canSetPrices` and `canSeeSellingPrices` from
`lib/pricing.ts` and `canAddDishPhotos` from `lib/dish-photo.ts` with
`ctx.role`, and do not fetch a figure a role may not see. Selling prices
for the menu come from `fn_menu_prices()`; costs, "you keep" and suggested
prices still come only from `v_price_check` and `v_product_attention`.

## 5d. Gold

- **The rule.** Gold is the screen's one highlight: at most one gold thing per screen, and none on a screen that shows an amber warning, where it would read as a second warning. The gold "NG" in the logo does not count.
- **Where it is used.** The landing page's three step numbers (Ink on Harvest Gold) and the "Founding price" label in the plan chooser (Gold Text). Planned, not built yet: the slim trial line in Gold Soft (mockup 06).
- **Where it is never used.** Never on a dish tile, a chart or a status dot. Never as body text on white (use `--mm-gold-text`). Never white text on gold.
- **Review.** When a screen is added or changed, count its gold before it ships.

## 5e. Photos on the public website

- **Which photos.** Three free Pexels photos in the "Sound familiar?" band: a pot of jollof, a Lagos produce stall and a street cook. They are cropped to food and hands, with no faces, no logos and no number plates.
- **The files.** `web/public/photos/*.webp`, 800 × 600, 50–90 KB each. They must be .webp or .jpg: the sign-in check lets only svg, png, jpg and webp through without a session.
- **How they show.** Forest overlay at 80–88% under the white title, fading upwards; `loading="lazy"`, width and height set, and alt text that says what is in the picture.
- **Credits.** Under the band, and in `06-imagery/credits.md` with the licence check.
- **The phone drawing.** The drawn "Example dish" phone at the top of the page uses the app's own `DishTile` and `CostBreakdown`.
- **Never in the app.** Stock photos never go inside the app. Real screenshots of the live app may go in Admin → Website "Inside the app"; never the mockups.

## 6. Icons

Lucide-style line icons, 24 grid, 1.75 px stroke, round caps. Sizes 18 (inline), 20 (nav, rows), 22 (bottom bar), 30 (empty states). The set the shell uses is in `screens/_shell.js`. The bowl mark is never used as an icon inside the UI except in the header, on receipts and faintly behind a dish tile's initials.

## 7. Copy rules in components

- Labels are questions or plain nouns: "One pot makes", "You paid", "What kind of work?".
- Hints explain the consequence, not the field: "Leave blank if nobody is paid for this: the dish is reported as incomplete, never as if the work were free."
- Badges are the owner's diagnosis: "No price for pepper", not "COST_BLOCKED".
- Money: ₦ tight, thousands separated, no .00: "₦1,450 a plate". Negative is a sentence.
- Missing: "not known yet", "no price yet", "set a price", "cost unknown". Never 0, never N/A.
- One name per thing: Dish (not recipe or product), Size (not format), Settings.
- Sentence case, plain Nigerian English, no exclamation marks.

## 8. Accessibility

- All text ≥ 4.5:1 on its background (see `04-colour/palette.md`). Gold is never body text. White on the photo overlay stays above 4.5:1.
- Touch targets ≥ 46 px (44 px is the floor). Bottom bar items ≥ 66 px tall.
- Focus ring on every control (green, 3 px soft).
- Colour never carries meaning alone: every badge has words, every stat has a caption, every status dot has a label.
- Every chart has a one-sentence label and a hidden table of its numbers.
- Dish tiles and dish photos are decorative; the dish name is always printed beside them.
- Reduced motion honoured. Dark mode follows the phone.
- Labels are real `<label>`s; icons have `aria-hidden`; the current nav item has `aria-current="page"`.
