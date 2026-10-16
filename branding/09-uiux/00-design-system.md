# Design system

The product's visual language, written down so a new screen looks like
the old ones. The live source of truth for tokens is
`web/src/app/globals.css`; this document names them, adds the brand
layer (fonts, logo, gold) and lists the components with their rules.
The CSS that implements all of it for the mockups is `screens/_app.css`.

## 1. Principles

1. **Phone first, worst phone first.** Design at 360–390 px, one column, thumb reach. Desktop gets a sidebar and two columns, nothing more.
2. **One primary action per screen.** Green button, bottom of the content, sticky on phones. Everything else is secondary (outlined) or a text link.
3. **Numbers are the product.** Tabular figures, ₦ tight to the number, two decimals only where kobo matter, a missing number is a word.
4. **States are the design.** Every list has an empty state; every submit has a busy state and a toast; every irreversible act has a confirm sheet.
5. **Say it in the owner's words.** Dish, plate, pot, paint, what you keep. The label is part of the design.
6. **Calm.** White space, one accent, no decoration. Gold appears once per screen at most.

## 2. Tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `--mm-bg` | `#F7F8F6` | `#101411` | Page |
| `--mm-surface` | `#FFFFFF` | `#171D19` | Cards, inputs |
| `--mm-surface-2` | `#F0F3F0` | `#1D251F` | Inset panels, table heads, segmented control |
| `--mm-fg` | `#171B18` | `#F2F6F3` | Text |
| `--mm-muted` | `#66706A` | `#98A39D` | Secondary text |
| `--mm-line` | `#DDE3DE` | `#29322C` | Borders |
| `--mm-accent` | `#1F7A52` | `#5AC58F` | Primary action, links, active nav, "good" |
| `--mm-accent-strong` | `#0F5E3C` (was `#17633F`) | `#70D8A4` | Hover, pressed, headings on mint |
| `--mm-accent-soft` | `#E8F5EE` | `#173426` | Selected, badge "good", icon tiles |
| `--mm-warn` / `-soft` | `#A06300` / `#FFF6DF` | `#E3B14E` / `#33290F` | Below target, stale, unpaid |
| `--mm-bad` / `-soft` | `#B42318` / `#FDECEA` | `#F08C7D` / `#3B1512` | Missing price, below cost, errors |
| `--mm-forest` | `#0F5E3C` | same | Logo green, marketing blocks |
| `--mm-gold` / `--mm-gold-text` / `-soft` | `#D4A020` / `#8A6A0E` / `#FBF3DC` | `#D4A020` / `#E6B94A` / `#2E2510` | Founding price, trial notice, "top customer", one highlight |
| `--mm-radius` / `-sm` | 16 px / 11 px | | Cards / controls |
| `--mm-touch` | 46 px | | Minimum height of anything tappable |
| `--mm-motion-fast` / `--mm-motion` | 120 ms / 220 ms, `cubic-bezier(.2,0,0,1)` | | Hover, sheets; 0 under reduced motion |
| Shadows | `0 10px 30px -20px rgb(24 38 29/.45)` and a 2 px soft | | Sheets, FAB; cards use the soft one |

Spacing scale: 4, 8, 12, 16, 18, 24, 32. Page gutter 16 px on phones, 32 px on desktop. Content max-width 1040 px.

## 3. Type

Inter for everything in the app; Plus Jakarta Sans 700 for page titles and section headings. Full scale in `05-typography/typography.md`. In the app:

- Page title 26 / 1.1 Jakarta 700. Section heading 18 Jakarta 700. Card title 16 Inter 600.
- Body 15–16 / 1.5. Hints 13 / 1.45 muted. Eyebrow 11 / caps / +0.06 em / 600.
- Hero number 34 Inter 700 tabular. Stat 22. Row amount 16 Inter 700.

## 4. Layout and navigation

- **Phone (< 768):** sticky header (business name + account chip), content, bottom bar with the five destinations (Home, Sales, Purchases, Recipes, More), a green "+" quick-add above it on list pages.
- **Tablet (768–1023):** same, the five destinations move into the header as pills.
- **Desktop (≥ 1024):** 248 px sidebar (brand, five destinations, Settings and Account at the bottom), header carries the "New sale" button, content in one or two columns.
- Every page not in the five is a child of one of them and shows a back link to its parent at the top left (Ingredients → More, Customers → Sales, Sizes → More…).
- A page is never without an active nav item.

## 5. Components

| Component | Rule |
|---|---|
| **Page header** | Title + one-sentence subtitle in muted. Subtitle says what the page is for or what period it shows. |
| **Section heading** | Title, optional subtitle, optional right-aligned link ("All dishes ›"). |
| **Card** | White, 1 px line, 16 px radius, 16 px padding. Lists use `pad-0` and rows. |
| **Row** | Title (with up to one badge), meta line, right-aligned amount with a small caption. 60 px min. Whole row tappable. |
| **Tile** | Icon tile + label + hint; 2-up on phones, 4-up on desktop. For navigation, never for data. |
| **Stat** | Eyebrow, big tabular number, caption. Colour only when it carries meaning (good/warn/bad). |
| **Hero stat trio** (dish page) | Cost → price → keep, in that order, always. |
| **Badge** | 12 px, pill. good / warn / bad / neutral / gold / outline. One per row. Text is a plain phrase: "Below target", "No price for pepper". |
| **Notice** | info / warn / bad / gold. Icon, bold lead, one sentence, optional link. Never stacks more than two. |
| **Empty state** | Icon tile, 17 px title, one sentence, the primary action. Shown on first visit of every list. |
| **Button** | primary (green, white), secondary (white, line), ghost (green text), danger (white, red text and line), gold (founding/upgrade only), wa (WhatsApp green, only for sending to WhatsApp). 46 px. Sentence case. One primary per screen. Busy state: spinner + label change + disabled. |
| **Sticky CTA** | On phones the primary action sits above the bottom bar; on desktop it is static at the end of the column. |
| **Input** | 46 px, 11 px radius, 16 px text (prevents iOS zoom), ₦ or unit as a prefix/suffix inside the field. Focus: green ring. Error: red line + message under. |
| **Segmented control** | For 2–4 mutually exclusive options that change the view (Today / Week / Month, Cash / Transfer / POS / Later). |
| **Tabs** | For filtered views of the same list, with counts ("Needs attention · 3"). |
| **Key-value list** | Label left muted, value right bold tabular, total row bold. Used for summaries and receipts. |
| **Table** | Desktop and dense phone data (Prices, Reports). Right-aligned numbers, uppercase 11 px headers. |
| **Progress** | 6 px bar + "Step 1 of 3" or "1 of 4 done". |
| **Steps list** | Numbered circles: done (green tick), next (green ring), later (grey). |
| **Bottom sheet** | For confirms and quick edits on phones; dialog on desktop. Title, one sentence, optional field, two buttons (Keep / Do it). |
| **Toast** | Dark, bottom, 4 s, icon + bold lead + sentence. On every outcome: saved, refused, failed. |
| **Skeleton** | Grey bars in the shape of the content while a read-only page loads. |
| **Lock panel** | Gold-soft card for a feature outside the plan: lock icon, what it is, the upgrade button, "what's included". Never a dead button. |
| **Receipt** | White, 12 px radius, mark + business name, lines, dashed total rule, "Thank you!". What the WhatsApp text mirrors. |

## 5a. Brand components in the code

- `BrandMark` (`web/src/components/brand-mark.tsx`): the Rising Bowl as inline SVG; `size` is its height. Bowl colour `--mm-brand-bowl` (Forest, white in dark mode), bars `--mm-brand-gold`.
- `BrandLockup`: mark + "Menu Master" in the display face at 800 + gold "NG", as real text. Landing header, sign-in, setup. Inside the app the header shows the mark beside the business's own name, never the lockup.
- Fonts come from `next/font/local` in `app/layout.tsx` as `--font-ui` (Inter) and `--font-display` (Plus Jakarta Sans); `h1`, `h2` and `.mm-display` take the display face.

## 6. Icons

Lucide-style line icons, 24 grid, 1.75 px stroke, round caps. Sizes 18 (inline), 20 (nav, rows), 22 (bottom bar), 30 (empty states). The set the shell uses is in `screens/_shell.js`. The bowl mark is never used as an icon inside the UI except in the header and on receipts.

## 7. Copy rules in components

- Labels are questions or plain nouns: "One pot makes", "You paid", "What kind of work?".
- Hints explain the consequence, not the field: "Leave blank if nobody is paid for this: the dish is reported as incomplete, never as if the work were free."
- Badges are the owner's diagnosis: "No price for pepper", not "COST_BLOCKED".
- Money: ₦ tight, thousands separated. "₦1,450 a plate". Negative is a sentence.
- Missing: "not known yet", "no price yet", "set a price", "cost unknown". Never 0, never N/A.

## 8. Accessibility

- All text ≥ 4.5:1 on its background (see `04-colour/palette.md`). Gold is never body text.
- Touch targets ≥ 46 px. Bottom bar items ≥ 66 px tall.
- Focus ring on every control (green, 3 px soft).
- Colour never carries meaning alone: every badge has words, every stat has a caption.
- Reduced motion honoured. Dark mode follows the phone.
- Labels are real `<label>`s; icons have `aria-hidden`; the current nav item has `aria-current="page"`.
