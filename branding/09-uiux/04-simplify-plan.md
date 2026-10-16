# Simplify Menu Master and make it look like a food app

Analysis and recommended path, 16 October 2026. Produced by four audits (plan vs build, imagery, navigation, comparable apps), three independent design paths, two judges and a synthesis, then adjusted for the owner's direction: Chowdeck-style dish pictures, fewer numbers, graphs where they help, less text. Nothing here is built yet.

## 1. Adjustments for the owner's direction

The synthesis below was written before the owner asked for fewer numbers, graphs and less text, and it held photos back to Phase 2. These changes override it where they disagree.

- **Photos sooner.** Phases 1 and 2 run back to back as "two weeks to a food-looking app". Week 1 builds the layout with dish tiles (the tile stays as the fallback for any dish without a photo). Week 2 adds the owner's own photos (migration 0063). The tile is not a substitute for photos; it is what a dish shows before its photo is taken.
- **Home becomes a menu, Chowdeck-style.** From the top: logo and business name once; one hero figure, "This week you kept ₦61,300", over a seven-day bar chart of sold (light) and kept (dark); "Needs you", at most three photo rows, each with its fix ("Charge ₦1,450 · Use"); "Your dishes", a two-column photo grid where each card shows the photo, the name and one figure ("you keep ₦1,160") with a green, amber or red dot; two full-width buttons, "Record a sale" and "Record a purchase", shown only to roles that can do them. Removed: the duplicated business name, the four truncated tiles, "Make your costs more accurate" (moves to the setup guide) and "More shortcuts".
- **Graphs, drawn as inline SVG, no chart library.**
  - Home: the seven-day sold vs kept bars.
  - Dish page: one horizontal bar showing what a plate is made of (rice, chicken, oil, pack, labour), replacing a column of numbers; a price slider that shows "you keep" as it moves.
  - Ingredient page and purchase rows: a small trend line and one sentence, "Rice up 8% since September".
  - Reports: bars by day and by dish instead of tables first; the table stays one tap away.
  - Rules: a chart needs at least three days of data, otherwise a friendly empty state; an unknown cost is a visible gap labelled "not known yet", never zero; every chart carries one plain sentence that says what it shows.
- **Fewer numbers.** One figure per card. "₦850" not "₦850.00" and "15%" not "15.00%" in the app; kobo only where they matter (receipts, tables of ingredient prices). Margin as a coloured dot plus "you keep ₦X", not four figures.
- **Less text.** This reverses the synthesis item "show each page's one-line purpose instead of hiding it behind (i)". Explanation boxes ("Sold by the portion. If you sell this in sizes…") move behind the existing (i) buttons. A page gets at most one short line under its title, and only where the title alone is unclear. Sizes, labour and scaling stay out of sight until a dish uses them.

## 2. Has the branding plan been implemented?

No, only part of it is built. The brand identity layer is in the app: the Rising Bowl logo in the header and sidebar, the phone and browser icons, the self-hosted fonts, the forest green and gold colours, and the WhatsApp/social link preview. It is all still uncommitted on branch launch/2026-10-02. Of the 31 planned items I checked, 9 are done, 12 are partial and 10 are not started, and several of the partial ones were already in the app before the branding work. Not built yet: the 32-screen redesign, the channel rollout (WhatsApp Business, social profiles, Paystack checkout, sign-up emails), print, and the three owner test sessions. Gold, half of the logo, appears in only one place, the "Founding price" badge (web/src/components/plan-chooser.tsx:66). The plan also has gaps of its own: it put no food photos inside the app and kept navigation as crowded as it is today. Building it exactly as drawn would not have fixed what you are describing.

## 3. Why are there no food images in the app?

Food pictures were never designed into the product, and there is nowhere to keep them. The design rules say "Calm. White space, one accent, no decoration" (branding/09-uiux/00-design-system.md:16). The photo guide keeps photos for marketing: "Use people photos for atmosphere and the app's own screens for the product" (branding/06-imagery/free-image-sources.md:63-64). The 32 design mockups have no food photo inside the app either. I opened them and searched all their source files. The only pictures are the logo and a "Take or choose a photo" button for a market receipt (12-purchase-new.html:30-31), and the New sale mockup (16-sale-new-390.png) shows text-only dish tiles. The database has no place for a business's own photos: the only storage is the admin-only website bucket (migrations/0059_site_images.sql:18-21). The eight food photos we downloaded went into the marketing templates and the WhatsApp link preview only. On the public website, the screen plan asked for a drawn phone (03-screen-specs.md:112), and the main picture stays empty until an admin uploads one.

## 4. Recommended path

Plate First: same five tabs, her own food, the price answer up front. Keep the five tabs and the costing engine as they are, and change what the owner sees on them. In about a week, with no database change: every dish shows as a brand-coloured tile with its initials; Home and the dish page say "Charge ₦1,450 to keep 40%" with a Use button and a "Try a price" box; money reads ₦850 instead of ₦850.00; each tool sits under the tab it belongs to, with that tab lit and a back link; More goes from 12 tiles to 6; and the public website shows real Nigerian food. Next, one small database change lets owners add photos of their own dishes, which replace the tiles. Then three real owners (a buka, a caterer and a baker) try it before the biggest screen, the dish page, is rebuilt. Last, the daily jobs (market run, deposit, quote to order) lose their extra taps. Both reviewers chose this path because it answers your complaint fastest with the least risk of breaking anything. It takes the best ideas from the two bolder options: the price fix in week one, Home showing your dishes as a picture grid, and Home buttons that depend on the person's role. It leaves out their risky parts: a different bottom bar for each role, renaming three tabs at once, removing the check step before a sale is confirmed, and copying last week's quantities or costs into new records. Every phase leaves the app ready to ship, and every cost still comes only from the business's own entries.

## 5. Navigation, before and after

BEFORE (today)
- Five tabs: Home, Sales, Purchases, Recipes, More (web/src/lib/nav.ts:22-28).
- Every page outside those four lights More (nav.ts:43-46). So Customers, Ingredients, Suppliers, Sizes and Prices all seem to live in More, even though the code's own notes say Customers belongs to Sales and Ingredients to Purchases (nav.ts:13-16).
- More has 12 tiles for an owner and 13 for a platform admin (more/page.tsx:17-47).
- List pages such as Customers, Ingredients, Sizes and Prices have no back link.
- Home (dashboard-390.png) shows:
  - the business name twice;
  - four tiles with cut-off labels ("New pu…", "Ingredi…");
  - the same four actions again behind the green "+", which covers the checklist;
  - a "More shortcuts" block;
  - about 25 things to tap before any dish appears.
- One thing goes by several names: Recipes, dish and Products; Size and format; Settings and "Wages & running costs".

AFTER (end of Phase 1)
- The same five tabs in the same places, for every role: Home, Sales, Purchases, Dishes, More. Only the Recipes label changes, to Dishes. The address stays /recipes, so no link or bookmark breaks.
- Sales holds Customers and Price per head; for a catering business, Price per head comes first. Purchases holds Ingredients and Suppliers. Dishes holds Sizes and Prices. Each of these pages lights its own tab and has a back link to it.
- More shrinks to 6 tiles for an owner: Settings, People, Reports, Plans & billing, Account and Setup guide, plus Administration for platform admins. Staff see 5. For a few weeks, a short line on More says where the rest moved, and each name in it is a link.
- Home, from the top:
  - the business name once;
  - this week's money;
  - "Needs attention", where each row has its fix button;
  - two full-width buttons, "Record a sale" and "Record a purchase", each shown only to roles that can do it (migrations/0015_write_side_role_enforcement.sql:56-76);
  - "Your dishes" as a picture grid.
  "More shortcuts" goes. That leaves about 15 tap targets instead of about 25.
- The green "+" stays on phones, because owners may already use it. It gets padding so it never covers a card, and it offers only the actions your role can do. "Add an item" opens the add form instead of a list that is 16,100 px tall (about 25 phone screens).
- Ingredients opens on your own priced items, with the 157-item starter list one tap away.
- One name per thing: Dish, Size, Settings.
- Desktop keeps the sidebar, and the duplicate account circle goes (globals.css:111-112 overrides lg:hidden at layout.tsx:59).

Not changed yet, on purpose: renaming Purchases to "Market", a raised "Sell" button in the bar, and removing the "+". Those go to the three owner sessions first.

## 6. Imagery plan

A dish's picture slot only ever shows that business's own photo. Pictures come in four layers, cheapest first.

1) Dish tiles (Phase 1, no data, no upload)
- What it is: a rounded tile with the dish's first letters ("JR" for Jollof rice) and a faint bowl mark.
- Colour: chosen from the dish name, so it never changes. Only these brand pairs are used: Forest with white letters, Kitchen Green with white, Surface 2 with Forest, and white with a Kitchen Green border. Tiles never use gold, amber, red or mint. In branding/04-colour/palette.md:16-27, Gold Soft is the warning background and Mint is the badge fill, and the palette allows one gold thing per screen (palette.md:57-59).
- Where it shows: the New sale tiles (sales/new/take-order.tsx:161-181), the Dishes list (recipes/page.tsx:102-133), Home's "Needs attention" rows and "Your dishes" grid, and the dish page header. On the header it replaces the shop icon the app currently guesses from the dish name (components/ui.tsx:5-20).
- Why: it is plainly a placeholder and never pretends to be her food. Square and Loyverse use the same idea.

2) Her own dish photos (Phase 2, one database change)
- Adding a photo: one "Add a photo" button on the dish page header, plus an optional prompt on the setup finish card ((setup)/start/page.tsx:869-891). The picker offers the camera or her gallery, including photos she has already sent on WhatsApp.
- Size: the phone shrinks each photo before sending. It makes a 320 px thumbnail of about 15 KB and a 1080 px copy of about 120 KB, never the 3-6 MB camera original. Shrinking also removes the GPS location of her kitchen.
- Tip in the picker: "Daylight from a window, shoot from above, right after dishing" (matches 06-imagery/photo-direction.md).
- Where it shows: the same four places as the tile. Name, price and "+" work before the photo arrives, and photos load only as they scroll into view.
- Data: a 20-dish menu costs about 300-400 KB once, then comes from the phone's memory, using the same one-year caching as components/image-field.tsx:53. The phone's own data saver is respected, and there is a "Hide photos to save data" switch.
- Storage: a new 'dish' storage area and one photo column on dishes (migration 0063). It is kept separate from the admin's website storage, which promises never to hold customer content (0059_site_images.sql:18-26).
- One pot drawing is added for the empty Dishes list and the first-day Home.

3) Real food on the public website (Phase 1)
- A photo band in "Sound familiar?" ((marketing)/page.tsx:180-218), using 2-3 of the verified free photos: the pot of jollof (06-imagery/samples/pexels-36707708.jpg), the Lagos produce stall (pexels-23490764.jpg) and the street vendor (pexels-34772940.jpg). They get the forest-green overlay from photo-direction.md:28.
- They are shrunk to about 800 px, 50-90 KB each. They must be saved as .webp or .jpg: the sign-in check lets only svg, png, jpg and webp files through (web/src/middleware.ts:127), so a .jpeg would send visitors to the log-in page and the picture would not show.
- A credits file records the photographer, link, licence and date checked, including for the link-preview photo already live (pexels-17952748).
- The drawn "Example dish" phone at the top of the page stays.
- After Phase 2, real screenshots of the live app go into Admin > Website "Inside the app" (docs/LAUNCH_CHECKLIST.md:105-107). Never the 32 mockups, which show screens that do not exist yet.

4) Later, only if owners ask
- a private photo of the market receipt on a purchase;
- sending the receipt as a picture;
- a shareable menu link with her photos and selling prices, never costs;
- drawings on the onboarding business-type cards.

Never
- a stock or AI photo in a dish slot;
- photos on ingredients, purchases or reports, where the numbers are the point;
- reading a number off a picture;
- photos in the WhatsApp text receipt, since wa.me links carry text only (lib/receipt.ts:93-96).

## 7. Phases

### Phase 0: Save the brand work already done

**Effort:** About half an engineer-day.  
**Database change:** no

**What changes**

- Commit the brand layer on its own: the logo component (components/brand-mark.tsx), icons, manifest, fonts, colour tokens, link-preview images, the audit.mjs selector fix and the branding/ folder.
- Leave web/src/app/(app)/quote/per-head.tsx out of that commit. It was changed before the brand work started.
- Leave the untracked root files (.htaccess, MenumasterNG.html) out unless you mean to add them.
- Open a Vercel preview and tick the font early-loading check (branding/02-brand-strategy/rollout-checklist.md:45).
- Add the credit record for the Pexels photo used in the link preview.

**What the owner sees**

Nothing new on screen. The logo, fonts and link preview are safely saved and live on a preview link, so every later change is small and easy to undo.

### Phase 1: Looks like food, says what to charge, easier to find (about one week)

**Effort:** About 6 engineer-days: 5.5 of build plus test and screenshot updates. If it must fit 5 days, the page-title explanation lines move to Phase 3.  
**Database change:** no

**What changes**

Shipped as four small releases. After each one, the customer journeys and the four-width layout audit are run again.

(a) Food look, 1.5 days
- A new dish-tile component with palette-only colours.
- Placed on the New sale tiles, the Dishes list, Home's Needs attention rows and a new 2-column "Your dishes" grid on Home (replacing the "Products" cards, dashboard/page.tsx:257), and the dish page header.
- The landing-page photo band, saved as .webp in web/public/photos/, with a credits file.
- Gold step numbers on the landing page (landing.css:96,112).

(b) The money answer, 1.5 days
- The dish page draws its price section once, straight under the cost/price/keep card. Today it appears above the ingredients until a price is set, then jumps to the bottom (recipes/[id]/page.tsx:743-745 and 1186-1188).
- "Charge ₦X to keep your target" shows when the dish is Low as well as at a Loss (page.tsx:682).
- A "Try a price" box shows live what she would keep. It appears only when the cost is complete and uses the same sum as the database (migrations/0037_deterministic_snapshot.sql:222-229), checked by a unit test.
- A [Use ₦1,450] button, with a one-line confirm and a toast, on the dish page and on Home's Needs attention rows. A dish sold in sizes shows one row with "Use suggested prices for both sizes".
- The two price-saving actions (page.tsx:305, 418) move to a shared file with a checked return address.
- Shown only to owner, manager and accountant, the roles the database lets see and set prices (migrations/0004_integrity_and_security_fixes.sql:50-53).

(c) Readable, 1 day
- Money drops ".00" when there are no kobo, and percentages drop trailing zeros (lib/format/index.ts:44-67). A missing figure still says "not entered".
- About 70 money and 10 percent checks in five e2e files are updated in the same commit.
- Each of the 23 page titles shows its one-line explanation instead of hiding it behind the (i) (components/ui.tsx:33-46). Titles can wrap to two lines instead of being cut off.

(d) Find your way, 1.5 days
- Tab label Recipes becomes Dishes.
- Each child page lights its parent tab and gets a back link.
- Buttons to reach them: Customers on Sales, Ingredients on Purchases, Prices on Dishes.
- More cut to 6 tiles, plus the temporary "Moved" line.
- One name per thing: Settings, and "size" instead of "format".
- Home: duplicate title and More shortcuts removed; 4 tiles become 2 full-label buttons by role; padding so the "+" never covers a card.
- The "+" offers only actions your role can do, and "Add an item" opens the add form.
- Ingredients opens on your own items (ingredients/page.tsx:209). Price per head comes first on Sales for caterers.
- Two fixes: the Prices page puts labels over the wrong numbers on tablet and desktop (pricing/page.tsx:74,128-135), and desktop shows the account circle twice.

Tests: nav.test.mts, nav-responsive.mjs, the Home strings in journey.mjs:690-704, and a new people.mjs check that a sales member's Home and New sale show no "you keep" and no "Use ₦".

**What the owner sees**

- Every dish has its own green tile on Home, the dish list, the dish page and the sale screen, so the app looks like a menu.
- A dish below target says "Charge ₦1,450 to keep 40%". You can fix it in two taps from Home, or try ₦1,200 first and see what you would keep.
- Figures read ₦850 and 15%.
- Each page says in one line what it is for.
- More has 6 tiles. Customers lights Sales, and Ingredients lights Purchases.
- The website shows real jollof, vendors and market stalls.

### Phase 2: Her own food (dish photos)

**Effort:** About 6 engineer-days, plus about 1 day if the staff-price change is approved.  
**Database change:** yes

**What changes**

Database change (migration 0063, in migrations/proposed/)
- A photo column on dishes, with a check that each photo sits in the dish's own business folder.
- A separate 'dish' storage area: 512 KB limit, JPEG and WebP only.
- Upload rights for owner, manager and kitchen on a paid-up account, the same people who can edit dishes (0015:64, 0028). Anyone in the business can view.
- The usual guard, counts check, self-check, undo script and an acceptance test (tests/049_dish_photos.sql, modelled on tests/045_site_images.sql).

App
- Upload with shrinking on the phone and the shooting tip.
- Photos shown in the four tile places.
- "Hide photos to save data" switch, and the phone's data saver respected.
- Optional photo prompt on the setup finish card, and a one-time Home nudge to photograph the 3 best sellers.
- One pot drawing for empty screens.
- Real app screenshots uploaded to Admin > Website.
- A new upload test journey modelled on journey-site.mjs.

Order matters: 0063 is applied on production before the app version that reads it is deployed. If you decide staff should see selling prices, a separate small migration ships in this phase too.

**What the owner sees**

Ada taps "Add a photo" on her jollof and picks the picture she already posted on WhatsApp. From then on her own plate appears on the sale screen, the dish list, Home and the dish page. It costs about 15 KB of data per dish, and photos can be switched off on a phone.

### Gate: watch three owners use it

**Effort:** About 1.5-2 days, mostly your time. No code.  
**Database change:** no

**What changes**

- First, update the wording in docs/USABILITY_SESSIONS.md to the new names (Dishes, Settings).
- Run its 15 tasks with a buka owner, a caterer and a baker on the Phase 1 and 2 build.
- Also try a paper or HTML version of the Phase 3 dish page.
- Test the ideas held back: a raised "Sell" button against the "+", and the tab name "Market" against "Purchases".
- Write up "What three owners stalled on" in PLAN_NATURAL_UX.md. If two or more owners stall on the same thing, treat it as a bug, then re-order Phases 3 and 4.

**What the owner sees**

Proof from real Ada, Tunde and Kemi that the simpler screens are easier, and a list of the exact words and screens that still confuse them, before the biggest screen is rebuilt.

### Phase 3: The dish page on one screen

**Effort:** About 7-8 engineer-days. The costing engine itself is unchanged.  
**Database change:** no

**What changes**

Rebuild recipes/[id]/page.tsx (1,389 lines, 15 forms) top to bottom:
- photo or tile, with the always-visible summary line;
- the cost/price/keep card;
- the fix notice with [Use ₦X], and Try a price;
- what is missing, using the existing "Cost incomplete" notice word for word (page.tsx:690-740);
- short ingredient rows, where tapping a row opens a sheet to change or remove it (replacing the inline Update/Remove forms at :1355-1380);
- Time it takes, kept visible because labour is what owners forget;
- one "About this dish" area holding Sizes, Edit, Scale and Put away.

New sizes and kinds of paid work can be created right on the dish. Kinds of work are for owner, manager and accountant, as the database allows (0015:68). Kitchen sees "Ask the owner to add this rate".

A "Not sold on its own" switch uses the existing dish/sub-recipe setting (migrations/0001_init.sql:289), so the stew in the jollof leaves the sale tiles. The cost engine treats the two kinds differently (0046:370; 0037:186), so this change also re-runs the cost and gets its own test.

Section headings show their explanation lines. The e2e helper that opens fold-outs is fixed once (e2e/setup-helper.mjs:106). "See every cost" stays.

**What the owner sees**

Opening a dish shows its photo, what it costs, what you sell it for, what you keep and what to charge, on the first screen, in about two phone screens instead of six. Fixing "4 kg" to "4 paint" is: tap the line, change it, done. Kemi adds her decorator's rate and her cake sizes without leaving the cake.

### Phase 4: Fewer taps on the daily jobs

**Effort:** About 8 engineer-days. No migration expected; confirm the deposit uses only the existing payment fields before starting.  
**Database change:** no

**What changes**

New sale
- The check-and-confirm step stays.
- It gains "you keep about ₦X" for roles that can see costs, and a deposit choice: Paid now / Part paid ₦__ / Not paid. Part payment already exists in the database (0001:605), and the save already records the amount after confirming (sales/new/actions.ts:150-157).
- One main button, "Confirm and send receipt".

Extras
- Recent extras appear as chips that fill in the name and the charge only. The cost is typed fresh, with "last time ₦3,000" as a hint.

Price per head
- "Take the order" carries the dishes and quantities into the order (quote/per-head.tsx:154). Settle the earlier uncommitted change to that file first.

New purchase
- "Same as last market run" picks the items and units only. Quantities and amounts stay blank, with a "last time: 1 bag for ₦85,000" hint.
- "Bought before" chips with small category drawings.
- An in-place "How much is one paint of rice?" sheet that keeps the typed rows. It is for owner, manager and kitchen (0015:60); others see "Ask the owner".
- Rows survive leaving the page, and a new market unit gives a warning instead of blocking the line.

Also
- Purchase list rows name the items and the market.
- The sale page shows a receipt card with the bowl mark and business name (sales/[id]/page.tsx:531-554).

**What the owner sees**

Ada repeats her usual market run by typing only how much and what she paid. Kemi takes a cake deposit and sends the receipt in one go. Tunde's per-head quote becomes an order without retyping 100 guests and 4 dishes. Every sale shows the owner what she keeps before she confirms.

### Later: only if the owner sessions ask for it

**Effort:** About 2-5 engineer-days each.  
**Database change:** yes

**What changes**

- A private photo of the market receipt on a purchase, gated like ingredient prices (needs a migration).
- Sending the receipt as a picture through the phone's share sheet.
- A business logo on receipts (needs a migration).
- A shareable menu link with photos and selling prices, never costs.
- Drawings for the onboarding business types, and examples for caterers and bakers, not only jollof.
- Keeping a sale on the phone when there is no signal and sending it later.

Running alongside, as your own tasks: WhatsApp Business, social profiles, Paystack branding, sign-up emails and print (rollout-checklist.md:49-59).

**What the owner sees**

Photos start to sell: a menu ready for WhatsApp status, branded receipts, and proof-of-price photos on purchases.

## 8. Taps for the daily jobs

| Job | Taps now | Taps after |
|---|---|---|
| Ada: record this morning's market run of 5 items she has bought before (Phase 4; counted from Home's "Record a purchase", 14 through the +; quantities and amounts typed, never copied) | 25 | 13 |
| Ada: sell 3 plates of jollof to a walk-in and send the WhatsApp receipt (Phase 4). Today it is 10 through the + and already 9 through Home's "New sale" tile, so the honest saving is 1 tap; the real gain is finding the dish by its picture | 10 | 8 |
| Ada: check what a plate costs and change the price to keep 40% (Phase 1: "Use ₦1,450" then Confirm on Home, no scrolling; today 4 taps plus 3-4 screens of scrolling) | 4 | 2 |
| Tunde: food cost and price per head for 100 guests and 4 dishes, sent on WhatsApp (already works; now under Sales, which lights up) | 10 | 10 |
| Tunde: turn that quote into an order with ₦5,000 delivery and send the quote (Phase 4; the order arrives filled in, the delivery chip fills the name and charge, the cost is typed; 14 the first time) | 26 | 11 |
| Tunde: a 12-item market run for an event (Phase 4, repeating his last run; about 40 for a brand-new list using the chips) | 63 | 29 |
| Kemi: cost a new cake with 8 ingredients, 2 hours of paid decorating and 6-inch and 8-inch sizes (Phase 3; no trips through More; typing the ingredients is still about 45 of the taps) | 86 | 70 |
| Kemi: take an 8-inch cake order with a deposit and send the receipt (Phase 4; deposit taken on the order, one "Confirm and send receipt") | 14 | 9 |
| Kemi: fix the prices of a 2-size cake that slipped below target after a price rise (Phase 1: "Use suggested prices for both sizes" then Confirm on Home; today 5 taps plus long scrolling) | 5 | 2 |

Tap counts come from reading the screens, not from watching an owner. The owner-session gate can reorder or cut Phases 3 and 4.

## 9. Brand features kept

- Logo: the Rising Bowl mark and business name stay in the app header and sidebar (web/src/app/(app)/layout.tsx:33,51). The lockup stays on the landing, sign-in and setup pages. Nothing touches brand-mark.tsx, the icons, the manifest or the link preview. The bowl gains new places: a faint mark on every dish tile, and the receipt card on the sale page (Phase 4).
- Colour: forest and Kitchen Green stay the one action colour. Gold finally does its job as the single highlight per screen:
  - the slim trial line in Gold Soft, as mockup 06 shows;
  - the landing step numbers and plan badge;
  - the "Founding price" badge.
  A written review rule keeps it to one gold item per screen, and no gold on a screen that already shows an amber warning (palette.md:57-59). Dish tiles carry no gold and no status colour, so a tile never reads as a warning.
- Type: Plus Jakarta Sans for page titles, which may now wrap to two lines instead of being cut off. Inter for everything else, with evenly spaced figures for money.
- Voice: plain Nigerian English and one name per thing: Dish, Size, Settings, "you keep", "Charge ₦1,450 to keep 40%", "Same as last market run", "How much is one paint of rice?". Each page's one-line purpose is shown, not hidden behind (i).
- Photos: on the website they follow the brand's photo direction (real, daylight, forest overlay, credited). In the app, only the owner's own food.
- The governing rule stays visible everywhere:
  - a tile is plainly a placeholder, never a fake plate;
  - "Try a price" uses the database's own sum and disappears when a cost is incomplete;
  - "Use ₦1,450" uses the database's own suggested price from her own target;
  - the "Cost incomplete" notice and its fix buttons stay word for word;
  - "Same as last market run" never copies quantities or amounts;
  - a missing figure still says "not entered", never ₦0.

## 10. Risks and mitigations

- Sales staff already see "No price yet" on every New sale tile. The database hides selling prices from the sales and kitchen roles on purpose (migrations/0004_integrity_and_security_fixes.sql:48-53), and the price views follow that rule. So a helper must type each price, and photos help her find the dish but not price it. Mitigation: your decision below. If yes, a small separate migration lets the sales role see current selling prices only, never costs, with a check in e2e/people.mjs.
- Cost figures could reach staff phones through the new Home grid, "you keep" lines and Use buttons. Mitigation: leave them out on the server for the sales and kitchen roles (fn_can_see_costs, 0004:23-33), not just hide them on screen. Add a people.mjs check that a sales member's Home and New sale pages contain no "you keep" and no "Use ₦".
- "Use ₦1,450" makes a price change very easy. Mitigation: a one-line confirm that says "from now on", and a toast. Undo just re-adds the old price, because price history is only ever added to. It is shown only to the roles allowed to set prices, and the wording says the figure comes from her own target.
- "Try a price" does its sum on the phone and could disagree with the database. Mitigation: use the same formula as v_price_check (0037:222-229), show it only when the cost is complete, label it "about", and add a unit test that both give the same answer.
- Moving the price section changes the most-tested screen. Today the section is drawn in one of two places depending on whether a price exists (recipes/[id]/page.tsx:743-745 and 1186-1188); it is not a duplicate to delete. Mitigation: draw it once at the top, keep its heading words, and re-run journey.mjs (90 checks) and journey-edit.mjs.
- Dropping ".00" breaks about 70 exact money checks and about 10 percent checks in journey.mjs, journey-sales.mjs, journey-edit.mjs, journey-setup-nav.mjs and shots-acceptance.mjs. Mitigation: update them in the same commit as lib/format/index.ts. Kobo still show (₦218.75), and missing figures still say "not entered".
- Showing explanations instead of hiding them makes pages taller. Mitigation: cut each of the 23 page lines to one short sentence. The 57 section-heading lines wait until Phase 3.
- Returning owners may look for Customers or Ingredients in More. Mitigation: a temporary "Moved" line with links, parent tabs that light up, and back links. nav.test.mts and e2e/nav-responsive.mjs (:26, :98-103) change in the same commit.
- Renaming Recipes to Dishes changes text that nav-responsive.mjs and shoot.mjs check. Mitigation: the address stays /recipes, so no link breaks. Check in the sessions that "the stew in the jollof" still makes sense under Dishes.
- The "Not sold on its own" switch is not just a label: the cost engine treats dishes and sub-recipes differently (portion size required only for dishes, 0046:370; the price view lists only dishes, 0037:186). Mitigation: Phase 3 only, with a cost re-run and its own test. Until then the stew stays a sale tile, as it is today.
- Photos need migration 0063 on production before the app that reads it is deployed, or Home, Dishes and New sale fail to load. Mitigation: apply first, then deploy. Follow the house routine: author in proposed/, transaction guard, preflight counts (118 policies; 98 functions going to 99), self-check, undo script, tests/049.
- Photos cost owners data and cost us storage. Mitigation: shrink on the phone (about 15 KB and 120 KB), load lazily, respect the phone's data saver, add a "Hide photos" switch, and never block a sale on a photo. Check the Supabase Pro allowance; expect about 4.5 GB for 1,000 businesses with 30 dishes each.
- Privacy if photos are publicly viewable by link. Mitigation: unguessable file names, location data removed when the phone shrinks the photo, and a line in the picker: "Photograph the food, not people."
- Copying old numbers forward would break the governing rule: unit cost is what she paid divided by how much she bought. Mitigation: "Same as last market run" copies items and units only. The delivery chip copies the name and charge only, and the cost is typed fresh with last time's as a hint.
- Stock photo licences. Mitigation: re-check each Pexels page before shipping. No faces implying endorsement and no visible brand logos (free-image-sources.md:5-26; photo-direction.md:13,21). Keep a credits file, which must also cover the link-preview photo already live.
- Gold creep as screens are added. Mitigation: the written one-gold-per-screen review rule, and no gold on dish tiles.
- The dish page rebuild is the biggest regression risk (1,389 lines, 15 server actions). Mitigation: it comes after the owner sessions; every server action and database call is kept and only moved; the fold-out test helper is fixed once in e2e/setup-helper.mjs:106.
- Uncommitted work sits on launch/2026-10-02, including an unrelated earlier change to quote/per-head.tsx. Mitigation: Phase 0 commits the brand layer on its own; settle per-head.tsx before Phase 4 touches it.
- Every tap count here comes from reading the screens, not from watching an owner. Mitigation: the gate before Phase 3 can reorder or cut Phases 3 and 4.

## 11. Decisions for the owner

- Should your sales staff see selling prices (never costs)? Today they cannot, by design, so a helper types the price for every dish. Recommended: yes for the sales role only, with a small separate change in Phase 2. Kitchen stays as it is.
- Dish photos: viewable by anyone who has the exact link (public), or only by your business (private)? Recommended: public with unguessable file names. It is cheapest on your customers' data and ready for a shared menu later. Receipt photos, if built later, stay private.
- WhatsApp receipts: keep ₦850.00 or match the app's ₦850? Recommended: match the app, so what you see and what your customer gets are the same.
- Tab names: Recipes becomes Dishes now. Recommended: yes now, and test "Market" instead of "Purchases" and a raised "Sell" button with the three owners before changing them.
- Keep the green "+" on phones? Recommended: keep it, with padding so it never covers a card, until the owner sessions show whether people use it.
- Dish tile colours: brand greens only, or gold letters too? Recommended: greens only, because the palette allows one gold item per screen and a grid of gold letters would break that. Gold stays for the trial line and the founding badge.
- Which website photos to use? Recommended: the pot of jollof (pexels-36707708), the Lagos produce stall (pexels-23490764) and the street vendor (pexels-34772940), after re-checking each licence page.
- Who runs the three owner sessions, and when? Recommended: you, on the Phase 1 and 2 build, before the dish page is rebuilt, with one buka, one caterer and one baker.
- Commit the brand work now? Recommended: yes, as Phase 0, in its own commit and without quote/per-head.tsx.

## 12. Ideas considered and rejected

- A different bottom bar for each staff role (Menu First). Owners train helpers by saying "tap X", and with four bars the helper's X may not exist. Keep one bar for everyone and show each role only the actions it can do on Home.
- Sending /recipes to Home so the menu becomes the home screen (Menu First). It gives one screen two jobs, puts the same tile on two screens where it does different things (open on one, add to order on the other), and breaks journey-setup-nav.mjs and the people.mjs staff-cost check.
- Sell and Buy tabs that open blank forms instead of the lists (Four Big Buttons). History moves a tap further away, and an accountant on Sell, or kitchen on Buy, lands on a form their role can never save (0015:56-76).
- Four big picture buttons on Home (Four Big Buttons). All four repeat a tab or Reports, which is the same duplication the audit found in today's tiles plus the "+". Home shows her dishes instead.
- Confirming a sale straight from the cart bar with no check step. A helper can easily confirm the wrong order, and a confirmed sale can only be cancelled and reissued. Keep the step and make its main button "Confirm and send receipt".
- Pre-filling last market run's quantities, or carrying a delivery cost forward. Unit cost is what she paid divided by how much she bought, so a stale quantity silently gives a wrong dish cost. Copy items, units, names and charges only.
- Renaming three tabs at once (Menu, Market, Sell) before any owner has seen them. Only Recipes becomes Dishes now; the rest goes to the sessions.
- Removing the floating "+" in Phase 1. It is cheap to keep, and bottom padding fixes it covering cards.
- A pop-up dish sheet as a second place to edit prices beside the dish page. Two places to change one price; Home's Use button plus the price card at the top of the dish covers it.
- Deleting a "duplicate" price block on the dish page. It is one section drawn in one of two places depending on whether a price exists; the fix is to draw it once at the top.
- Tile colours outside the palette (adire indigo, palm brown, tomato) or ones that look like status (Gold Soft is the warning background, Mint the badge fill).
- Stock or AI food photos in any dish slot, photos on ingredients, purchases or reports, and reading numbers off a photo.
- Building the 32 mockups screen by screen. They have no food photos, keep navigation as crowded as today, and none has been tried by an owner. Use them as reference only, and never as screenshots of the product.
- Claiming tap savings the code does not support: the walk-in sale is already 9 taps from Home's "New sale" tile, and Kemi's cake does not reach about 40 taps without a new ingredient picker.

## 13. Sources (comparable apps)

- https://help.chowdeck.com/en/articles/16875508-how-do-i-create-menu-items-on-chowdeck
- https://help.chowdeck.com/en/articles/16832271-how-do-i-navigate-the-vendor-dashboard
- https://help.loyverse.com/help/how-add-items-loyverse-back-office
- https://developer.squareup.com/reference/square/objects/CatalogItem
- https://square.com/us/en/photo-studio/app
- https://changelog.shopify.com/posts/new-navigation-menu-bar
- https://support.toasttab.com/en/article/Get-Started-with-the-Toast-Now-App
- https://getmeez.com/costing
- https://MarketMan.com/platform/marketman-snap-expense-tracking
- https://merchants.doordash.com/en-us/learning-center/menu-quality-tips-to-improve-restaurant-ranking
- https://merchants.ubereats.com/us/en/restaurant-submitted-photos/
- https://developers.googleblog.com/2016/07/building-for-billions.html
- https://chakrahq.com/article/create-and-manage-catalog-on-whatsapp-business/
- https://support.paystack.com/hc/en-us/articles/360017856000-How-do-I-set-up-a-Storefront

## 14. How this was produced

Audits: plan vs build, imagery, navigation, comparable apps. Paths: incremental, menu-first, task-first. Judges: owners' view and engineering view; both chose the incremental path and grafted ideas from the other two. Raw results of every agent: the session workflow journal for run wf_c6da91a0-0ea. Three claims were re-checked by hand on 16 October: sales and kitchen roles cannot read selling prices (migrations/0004_integrity_and_security_fixes.sql:48-53); the dish page draws its price section in one of two places (recipes/[id]/page.tsx:743-745 and 1186-1188); 69 exact `.00` money checks sit in web/e2e.
