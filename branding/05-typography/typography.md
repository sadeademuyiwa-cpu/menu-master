# Typography

Two free Google Fonts (SIL Open Font License, free for commercial use,
embedding and print):

| Role | Face | Why |
|---|---|---|
| Display and headings | **Plus Jakarta Sans** (600–800) | Rounded, confident, modern without being techy. Reads as "friendly brand", not "bank". [fonts.google.com/specimen/Plus+Jakarta+Sans](https://fonts.google.com/specimen/Plus+Jakarta+Sans) |
| UI, body and numbers | **Inter** (400–700) | The most legible UI face at small sizes on cheap Android screens; tabular figures; includes the Naira sign (U+20A6). [fonts.google.com/specimen/Inter](https://fonts.google.com/specimen/Inter) |

Fallback stack (what the app uses today, and what to show when the fonts
have not loaded): `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`.

Since 16 October 2026 the product ships both faces self-hosted: Inter for
everything, Plus Jakarta Sans for `h1`/`h2` and the wordmark. The files are
served from menumasterng.com itself, subset to Latin, the Pan-Nigerian
letters (ẹ ọ ṣ ị ụ ǹ ɓ ɗ ƙ ƴ and their combining marks) and the Naira sign,
so a build never reaches Google and a phone on data never waits on a third
host.

## Loading

Web (Next.js, as in `web/src/app/layout.tsx`; the woff2 subsets and their OFL
licences live in `web/src/app/fonts/`):

```ts
import localFont from 'next/font/local'
const inter = localFont({ src: './fonts/Inter-var.woff2', weight: '100 900', variable: '--font-ui', display: 'swap' })
const jakarta = localFont({ src: './fonts/PlusJakartaSans-var.woff2', weight: '200 800', variable: '--font-display', display: 'swap' })
// <html className={`${inter.variable} ${jakarta.variable}`}>
```

To rebuild the subsets from the full fonts in `05-typography/fonts/`:

```
pyftsubset "Inter[opsz,wght].ttf" --unicodes="U+0000-00FF,U+0131,U+0152-0153,U+0181,U+018A,U+0198-0199,U+01B3-01B4,U+01F8-01F9,U+0253,U+0257,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0300-0304,U+0323,U+0331,U+1E0C-1E0D,U+1E44-1E45,U+1E62-1E63,U+1EB8-1EB9,U+1ECA-1ECD,U+1EE4-1EE5,U+2000-206F,U+2074,U+20A6,U+20AC,U+2122,U+2190-2193,U+2212,U+2215,U+2713-2714,U+FEFF,U+FFFD" --layout-features=kern,calt,ccmp,locl,mark,mkmk,case,tnum,pnum,frac,numr,dnom,sups,subs,ordn,zero --flavor=woff2 --output-file=Inter-var.woff2
```

Plain HTML (templates in this folder):

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap" rel="stylesheet">
```

Print and Canva: install the TTFs from Google Fonts (both are on Canva's free font list under the same names).

## Scale

Base 16 px on phones. Line heights are tight for numbers, roomy for prose.

| Token | Size / line | Face, weight | Use |
|---|---|---|---|
| display | 40 / 44 (phone) · 56 / 60 (desktop) | Jakarta 750–800, tracking −0.02 to −0.035em (the live landing hero uses 750 / −0.035em) | Landing hero, deck cover |
| h1 | 28 / 32 | Jakarta 700 | Page title |
| h2 | 20 / 26 | Jakarta 700 | Section heading |
| h3 | 16 / 22 | Inter 600 | Card title |
| body | 16 / 24 | Inter 400 | Prose |
| ui | 15 / 20 | Inter 500 | Buttons, inputs, nav |
| small | 13 / 18 | Inter 400 | Hints, meta |
| caption | 11 / 14 | Inter 600, tracking +0.04em, uppercase | Eyebrows ("COST PER PORTION") |
| stat | 28 / 32 | Inter 700, tabular | Hero numbers (₦850.00) |
| stat-lg | 40 / 44 | Inter 700, tabular | One number the page is about |

## Numbers and the Naira

- Always `font-variant-numeric: tabular-nums` on money and quantities (the app's `.mm-num`).
- The sign is tight to the number: **₦1,450.00**. Never "N1450", never "NGN" in the UI, never a space.
- Thousands separator always. Two decimals in tables and totals; whole naira in headlines and marketing ("₦1,450 a plate").
- Negative money reads as a sentence, not a minus sign: "₦120 below cost".
- A missing number is a word: "not yet", "unknown", "no price yet". Never 0, never —.

## Rules

- Sentence case everywhere. Uppercase only in the caption style.
- Never justify text. Never centre body text on phones.
- Max line length 65 characters for prose.
- Headlines may break on a phone; do not shrink them to avoid it.
- Minimum body size 15 px in the app, 16 px in marketing.
