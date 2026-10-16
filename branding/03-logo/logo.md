# Logo: the Rising Bowl

The logo was supplied by the owner on 12 October 2026 and rebuilt here as
clean vector artwork so it scales to a 16 px favicon and a shop sign
without loss. Every variant in `svg/` and `png/` is generated from the
same geometry; nothing was redrawn by hand.

## What it says

A bowl whose inside is the letter **M**, standing on a small plinth, with
three bars rising out of it from left to right. The bowl is the food; the
bars are the money going up. Forest green for the bowl (trust, growth,
Nigeria), harvest gold for the bars (profit, harvest, "NG").

## Construction (mark units)

- Grid: the mark occupies 620 × 520 units (x 230–850, y 218–738 of the original 1080 canvas).
- Bowl: a flat lip 620 wide and 27 deep, over a half-ellipse (rx 310, ry 290). Two windows (rx 250, ry 232 inner wall) are cut either side of the M.
- M: 240 wide, legs 75, standing from the lip (y 405) to the bowl floor (y 690). Top notch and inner V at 45:80 slope.
- Bars: 80 wide, 14-unit rounded tops, at heights 94, 142 and 192 above the lip, 20 apart. The middle bar ends in a V that echoes the M's notch, with a 30-unit gap.
- Plinth: 290 × 38, radius 14, 10 units under the bowl.
- Wordmark: "Menu Master" in Plus Jakarta Sans 800, tracking −0.02 em, Forest Green; "NG" at 82 % size in Harvest Gold, separated by a narrow space.

## Clear space and minimum size

- Clear space: the height of the plinth-to-lip distance (≈ ⅔ of the mark height) on every side. Nothing else inside it.
- Minimum: mark 24 px tall on screen, 8 mm in print; horizontal lockup 140 px wide; stacked lockup 96 px wide. Below 24 px use `favicon.svg`, the green tile with the white bowl, which reads at 16 px where the bare mark does not.

## Files

| File | Use |
|---|---|
| `svg/lockup-stacked.svg` | **Primary.** Mark over wordmark, as supplied. Social avatars, print, the landing hero, deck covers |
| `svg/lockup-horizontal.svg` | App header, website header, email, letterhead, anything wide and short |
| `svg/mark.svg` | Mark alone, colour. Stickers, stamps, pattern |
| `svg/wordmark.svg` | Text alone, for places that already show the mark (e.g. beside the app icon) |
| `*-reversed.svg` | White bowl, gold bars, white wordmark, gold NG, on Forest Green. For green backgrounds and photo overlays |
| `*-mono.svg` | All Ink. Receipts, one-colour print, embossing, faxes |
| `lockup-horizontal-white.svg`, `mark-reversed-mono.svg` | All white. For photographs and dark backgrounds where gold would clash |
| `svg/app-icon.svg` | 1024 grid, Forest Green rounded square (22 % radius), white bowl, gold bars. Android, WhatsApp Business, PWA, the browser tab (`web/src/app/icon.svg`). Not for iOS: its corners are transparent and iOS paints them black |
| `svg/app-icon-square.svg` | The same artwork on a full-bleed square with no transparency. Source of the iOS home-screen icon (`web/src/app/apple-icon.png`, 180 px); iOS rounds the corners itself |
| `svg/app-icon-light.svg` | White tile version for places that force a light icon |
| `svg/app-icon-maskable.svg` | Full-bleed green square for Android's maskable icons (the mark sits inside the 80 % safe zone) |
| `svg/favicon.svg` | The tile at 32 px (green square, white bowl, gold bars), for browser tabs |

PNG renders of all of the above are in `png/` (the number is the pixel width;
app icons at 1024, 512, 192, 180; square at 180; maskable at 512, 192; favicons at 64, 48, 32, 16). For a refresh, copy `app-icon-square-180.png`, not `app-icon-180.png`, to `apple-icon.png`; `web/src/app/favicon.ico` packs the 48, 32 and 16 px favicons.

In the product these live as `web/src/app/icon.svg`, `apple-icon.png`, `manifest.ts` and `web/public/brand/`; the inline React version of the mark is `web/src/components/brand-mark.tsx`.

## Do and don't

- Do use the stacked lockup wherever there is room; it is the version people have seen.
- Do keep the bars gold and the bowl green. On a green background the bowl turns white and the bars stay gold.
- Do use the mono version on receipts and anything printed in one colour.
- Don't change the bar heights or add a fourth bar.
- Don't put the colour lockup on a photo; use the reversed lockup on a Forest Green tint.
- Don't add a fork, a chef's hat, a Naira sign, a shadow, a gradient or an outline.
- Don't set the wordmark in another typeface or in all caps.
- Don't use the original black-background PNG as a logo file; the black is a background, not part of the mark.

## Keywords

For briefing a designer, searching references, or prompting an image model
for campaign art in the same family:

**Concept:** rising bowl, bowl shaped like the letter M, three ascending bars, growth out of the pot, food and money, kitchen ledger, Nigerian food business, buka, caterer, baker, phone-first.

**Style:** flat vector, geometric, bold, two colours, solid fills, no gradient, no 3D, no outline, generous white space, rounded square app icon, friendly fintech.

**Colour words:** forest green `#0F5E3C`, harvest gold `#D4A020`, white, ink.

**Type words:** Plus Jakarta Sans ExtraBold, Inter, bold geometric sans, sentence case, tight tracking.

**Negative keywords:** chef hat, crossed fork and knife, cloche, tomato mascot, cartoon, gradient, neon, 3D, Africa map, kente pattern, shield, coin stack, dollar sign, black background.

**Example prompt (for supporting art, not the logo itself):** "Flat vector illustration in the style of a forest green (#0F5E3C) and harvest gold (#D4A020) brand: a large aluminium cooking pot of jollof rice seen from the side, three gold bars rising from it like a bar chart, white background, no text, no gradients, bold geometric shapes."

## Trademark note

Search the Nigerian Trademarks Registry (Class 9 software, Class 35
business services, Class 42 SaaS) for "Menu Master" before printing at
scale. The mark (the bowl-M) is more defensible than the name.
