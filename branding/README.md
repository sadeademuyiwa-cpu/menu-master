# Menu Master NG — Brand & Product Design Folder

Everything a designer, developer, marketer or printer needs to make something
that looks and sounds like Menu Master NG. Built 12 October 2026 from the
live product (`web/`), its route map, its existing CSS tokens and the
usability-session script in `docs/USABILITY_SESSIONS.md`.

Open `08-brand-guidelines/brand-guidelines.html` in a browser for the
one-page visual summary. Open `09-uiux/renders/index.html` for every screen.

| Folder | What is in it |
|---|---|
| `01-research/` | How professionals brand a business and design a product, with sources, and how that method was applied here |
| `02-brand-strategy/` | Purpose, positioning, audience, personality, messaging, voice and tone, rollout checklist |
| `03-logo/` | The logo system as SVG (and PNG renders): primary lockup, stacked, mark, mono, reversed, app icon, favicon. Logo keywords for briefs, searches and AI prompts |
| `04-colour/` | Palette with HEX / RGB / CMYK, usage ratios, accessibility pairs, CSS and JSON tokens |
| `05-typography/` | Type system on free Google Fonts, scale, Naira and number rules |
| `06-imagery/` | Photo direction, verified free photo links (Pexels, Unsplash), illustration and icon sources, licences, search keywords, eight sample photos already downloaded |
| `07-templates/` | Ready-to-edit HTML templates: Instagram post, WhatsApp status, OG image, business card, flyer, email signature, deck cover, letterhead, plus PNG renders |
| `08-brand-guidelines/` | One-page brand guidelines (HTML) |
| `09-uiux/` | `04-simplify-plan.md` (16 Oct: the recommended path to a simpler, photo-led food app; read this before the older files), `00-design-system.md`, `01-information-architecture.md`, `02-user-flows.md`, `03-screen-specs.md`, hi-fi mockups of every screen in `screens/` (HTML) and `renders/` (PNG at 390 px and, for key screens, 1280 px; open `renders/index.html`) |

## How to regenerate the PNGs

```powershell
# from the repo root; uses the Playwright already installed under web/
C:\laragon\bin\nodejs\node-v22\node.exe branding\render.mjs
```

## Rules of the folder

- Nothing here guesses a number. Every figure in a mockup is an example and is labelled as such.
- Fonts, photos, icons and illustrations are all free for commercial use; the licence of each is recorded in `06-imagery/free-image-sources.md`.
- The app's live CSS tokens in `web/src/app/globals.css` are the source of truth for colour in the product. `04-colour/` extends them for marketing; it does not replace them.
