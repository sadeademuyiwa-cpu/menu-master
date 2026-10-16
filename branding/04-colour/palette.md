# Colour

The palette comes from the logo: a forest green bowl and three harvest-gold
bars. The product already runs on a slightly lighter green (`#1F7A52`) for
buttons and links; it stays, because it has better contrast as a UI colour
and it sits naturally inside the logo's green. Contrast ratios below were
computed (WCAG 2.1); AA for normal text is 4.5, for large text and UI
components 3.0.

## Core palette

| Name | Role | HEX | RGB | CMYK (approx.) | On white | White on it |
|---|---|---|---|---|---|---|
| **Forest Green** | The logo green. Dark backgrounds, headings on white, marketing blocks, the app's pressed/hover state | `#0F5E3C` | 15 94 60 | 84 0 36 63 | 7.82 AAA | 7.82 AAA |
| **Kitchen Green** | Primary UI colour. Buttons, links, active nav, "costed" badges | `#1F7A52` | 31 122 82 | 75 0 33 52 | 5.30 AA | 5.30 AA |
| **Mint** | Soft green fill: badges, selected rows, callouts | `#E8F5EE` | 232 245 238 | 5 0 3 4 | — | Ink on it 15.5 |
| **Harvest Gold** | The logo gold. "NG", the rising bars, one highlight per page, the founding-price badge, chart second series | `#D4A020` | 212 160 32 | 0 25 85 17 | 2.37 (fills and display only) | Ink on it 7.33 |
| **Gold Text** | Harvest Gold darkened for body-size text on white | `#8A6A0E` | 138 106 14 | 0 23 90 46 | 5.06 AA | 5.06 AA |
| **Gold Soft** | Warm fill behind a gold accent; also the warning background | `#FBF3DC` | 251 243 220 | 0 3 12 2 | — | Forest on it 7.06 |

## Functional colours (unchanged from the app)

| Name | Role | HEX | On white |
|---|---|---|---|
| Amber | Warning text: "below your target", "price is stale" | `#A06300` | 4.91 AA |
| Pepper | Error / loss text: "selling below cost" | `#B42318` | 6.57 AA |
| Pepper Soft | Error background | `#FDECEA` | — |

## Neutrals

| Name | Role | HEX |
|---|---|---|
| Ink | Text | `#171B18` |
| Stone | Secondary text, placeholders (5.13 on white, AA) | `#66706A` |
| Line | Borders, dividers | `#DDE3DE` |
| Surface | Cards | `#FFFFFF` |
| Surface 2 | Inset panels, table header | `#F0F3F0` |
| Canvas | Page background | `#F7F8F6` |

## Dark mode (already shipped in `globals.css`)

Canvas `#101411`, surface `#171D19`, text `#F2F6F3`, line `#29322C`,
accent **Leaf** `#5AC58F` (8.14 on dark canvas), warn `#E3B14E`, bad
`#F08C7D`. Harvest Gold stays `#D4A020` on dark (7.3 on the dark canvas),
so the logo needs no dark variant beyond the reversed lockup.

## Proportions

Think of the logo: a lot of white, a solid green, three bars of gold.

- 60 % Canvas / Surface (white space is the brand's calm)
- 25 % Ink and Stone (text)
- 10 % Forest and Kitchen Green
- 5 % Harvest Gold

Gold is an accent, never a surface. One gold thing per screen: the "NG",
a badge, the emphasised word in a headline, or the second series in a
chart. Gold next to Amber warnings looks like two warnings; on a screen
with a warning, drop the gold accent.

## Approved pairs

| Text | Background | Ratio | Use |
|---|---|---|---|
| Ink | White, Canvas, Mint, Gold Soft | ≥ 14 | Body |
| White | Forest Green, Kitchen Green, Pepper | ≥ 5.3 | Buttons, badges, reversed lockup |
| Harvest Gold | Forest Green | 3.29 | Large text and the "NG" on green only (24 px+ or bold 19 px+) |
| Kitchen Green | White, Mint, Gold Soft | 5.30 / 4.72 / 4.78 | Links, active nav, costed badge |
| Forest Green | White, Gold Soft | 7.82 / 7.06 | Headings |
| Gold Text | White | 5.06 | Small gold text (meta, "founding price") |
| Ink | Harvest Gold | 7.33 | Text on a gold badge |

Do not use: Harvest Gold for body text on white, white text on gold, green
text on gold, gold on Mint.

The one exception is the logo itself: the gold "NG" in the lockup is 2.4:1
on white. WCAG 1.4.3 exempts logotypes, and the words "Menu Master" beside
it carry the name at 7.8:1, so nothing is lost if the "NG" is faint. Never
extend that exemption to any other gold text.

## Files

- `tokens.css` — CSS custom properties; the brand additions are prefixed the same way as the app's (`--mm-`)
- `tokens.json` — the same for Figma Tokens / Style Dictionary
