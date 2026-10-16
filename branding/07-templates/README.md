# Templates

Each template is one HTML file in `src/`. Open it in a browser, change the
words, and either screenshot it or run `node branding/render.mjs templates`
to regenerate the PNG in `png/`. The `<meta name="render">` tag at the top
of each file sets the output size.

| File | Size | For |
|---|---|---|
| `instagram-post.html` | 1080 × 1080 | Photo + one line. The "Tomatoes went up" series |
| `instagram-number-card.html` | 1080 × 1080 | Cost / price / keep card. Swap the dish and the three numbers; keep "Example figures" unless they are a real customer's with consent |
| `whatsapp-status.html` | 1080 × 1920 | WhatsApp status, Instagram / Facebook story, TikTok still |
| `og-image.html` | 1200 × 630 | Link preview for menumasterng.com (set in the site's `openGraph.images`) |
| `business-card.html` | 85 × 55 mm, front and back | Print at 300 dpi; the PNG is @2, export @3 for press |
| `flyer-a5.html` | A5 portrait | Markets, food fairs, buka counters. Paste a real QR code |
| `email-signature.html` | — | Copy the table into Gmail's signature editor; host the icon PNG first |
| `deck-cover.html` | 1920 × 1080 | First slide of any deck. Inner slides: white background, h1 in Jakarta 800 at 56 px, body Inter 24 px, one Kitchen Green accent per slide |
| `letterhead-a4.html` | A4 | Letters, invoices to partners, quotes |

## Rules that keep them on brand

- One headline, one sentence, one call to action. Never two headlines.
- The photo is tinted Deep Green and the text sits on the dark part, or the layout is white with one green block. Never black gradients, never a drop shadow on text.
- Harvest gold only for the one emphasised word or number.
- Every number is labelled "Example figures" unless it is a real customer's and they agreed in writing.
- Logo: reversed lockup on green or photo; colour lockup on white. Never the colour lockup on a photo.
- Phone numbers and handles are placeholders here; replace before posting.

## Canva

All of this can be rebuilt in Canva with the same fonts (Plus Jakarta Sans
and Inter are in Canva's free library). Set up a Brand Kit with the eight
palette colours from `04-colour/palette.md` and upload the PNG logos from
`03-logo/png/`. The structure of each template above translates directly.
