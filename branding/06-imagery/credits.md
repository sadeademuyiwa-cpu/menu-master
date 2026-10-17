# Photo credits

Every photo that leaves this folder, where it is used, and what its licence
allows. Add a row before a new photo goes on the website, in the app's link
preview, or into a template. The app's own dish photos are not here: each
business takes and owns its own, and no stock photo ever goes in a dish slot
(`09-uiux/04-simplify-plan.md`, section 6).

## The licence, as read on 17 October 2026

All five photos below are on Pexels and are marked **Free** under the
[Pexels License](https://www.pexels.com/license/). None is marked editorial
only. The licence page shows no "last updated" date; its terms were the same
as the summary in `free-image-sources.md` (12 October 2026).

Allowed, in Pexels' words:

- "All photos and videos on Pexels are free to use."
- "Attribution is not required. Giving credit to the photographer or Pexels is not necessary but always appreciated."
- "You can modify the photos and videos from Pexels."

Not allowed, in Pexels' words:

- "Identifiable people may not appear in a bad light or in a way that is offensive."
- "Don't sell unaltered copies of a photo or video, e.g. as a poster, print or on a physical product without modifying it first."
- "Don't imply endorsement of your product by people or brands on the imagery."
- "Don't redistribute or sell the photos and videos on other stock photo or wallpaper platforms."
- "Don't use the photos or videos as part of your trade-mark, design-mark, trade-name, business name or service mark."

We credit anyway: by name under the photo band on the website, and here.

## Photos in use

| Photo | Photographer | Pexels page | Location (as Pexels gives it) | Licence | Checked |
|---|---|---|---|---|---|
| Pot of jollof rice, `samples/pexels-36707708.jpg` | Jagaba Denis, [pexels.com/@jagaba](https://www.pexels.com/@jagaba/) | [Traditional Jollof Rice Cooking in Nigerian Setting](https://www.pexels.com/photo/traditional-jollof-rice-cooking-in-nigerian-setting-36707708/) | Jos, Plateau, Nigeria | Pexels License, Free | 17 Oct 2026 |
| Lagos produce stall, `samples/pexels-23490764.jpg` | Godiva Omoruyi, [pexels.com/@godiva-omoruyi-207147579](https://www.pexels.com/@godiva-omoruyi-207147579/) | [Street Food Market Stand with Vegetables and Fruit next to Busy Street](https://www.pexels.com/photo/street-food-market-stand-with-vegetables-and-fruit-next-to-busy-street-23490764/) | Lagos, Nigeria | Pexels License, Free | 17 Oct 2026 |
| Street cook, `samples/pexels-34772940.jpg` | Jboy Designer, [pexels.com/@jboy-designer-604448838](https://www.pexels.com/@jboy-designer-604448838/) | [Street Vendor Cooking Traditional Jollof Rice](https://www.pexels.com/photo/street-vendor-cooking-traditional-jollof-rice-34772940/) | Lagos, Nigeria | Pexels License, Free | 17 Oct 2026 |
| Jollof with fried plantain, `samples/pexels-17952748.jpg` | Studio Saiz, [pexels.com/@saizstudio](https://www.pexels.com/@saizstudio/) | [Fried Cubes and Rice on White Plate](https://www.pexels.com/photo/fried-cubes-and-rice-on-white-plate-17952748/) | Not given | Pexels License, Free | 17 Oct 2026 |

### Where each one is used

**Pot of jollof (36707708).**
- Website, "Sound familiar?" band, beside "Pricing by guesswork": `web/public/photos/jollof-pot-jos.webp`. Cropped to the pot only (box 0,540 to 1200,1440 of the 1200 px sample), so the seated woman behind it is out of frame. 800 × 600 WebP, 86 KB.
- WhatsApp status template, `07-templates/src/whatsapp-status.html`. Shows the seated woman's body from the shoulders down, no face. Fine as it is.
- Brand guidelines, `08-brand-guidelines/brand-guidelines.html` (logo-on-photo box and the imagery strip). Internal document.

**Lagos produce stall (23490764).**
- Website, "Sound familiar?" band, beside "Market prices moved again": `web/public/photos/market-stall-lagos.webp`. Cropped from the 2400 px download (box 820,680 to 2093,1635) to the trays of tomatoes and peppers and the seller's hands. Her face, the danfo and its number plate are out of frame. 800 × 600 WebP, 87 KB.
- Instagram post template, `07-templates/src/instagram-post.html`. See "Before printing or posting" below.
- Brand guidelines imagery strip. Internal document.

**Street cook (34772940).**
- Website, "Sound familiar?" band, beside "Busy, but where is the profit?": `web/public/photos/street-cook-lagos.webp`. Cropped from the 2400 px download (box 1370,800 to 2370,1550) to the gloved hand and the tray of meat and onions. His face and the logo on his apron are out of frame. 800 × 600 WebP, 60 KB.
- A5 flyer template, `07-templates/src/flyer-a5.html`. See "Before printing or posting" below.
- Brand guidelines imagery strip. Internal document.
- The Pexels title says jollof, but the photo shows meat and sliced onions on a tray. The website's alt text describes what is in the picture, not the title.

**Jollof with fried plantain (17952748).**
- Live link preview: `web/src/app/opengraph-image.jpg` and `web/src/app/twitter-image.jpg` (the same 1200 × 630 file), built from `07-templates/src/og-image.html`. No people and no brands in it. The figure on it (₦1,160) is labelled "Example figures".
- Brand guidelines imagery strip. Internal document.
- The Pexels title says "fried cubes", but its description says jollof with fried plantain, which is what the photo shows.

The three website files keep only the pixels: no camera data (EXIF), no
XMP and no colour profile travel with them. They are .webp because the
sign-in check in `web/src/middleware.ts` lets only .svg, .png, .jpg and
.webp files through without a session; a .jpeg would send visitors to the
log-in page instead of the picture. The page shows them with the Forest
overlay from `photo-direction.md`, `loading="lazy"`, and hides them when a
phone has chosen "Hide photos to save data".

## Before printing or posting (found on 17 October 2026)

None of these changes the licence. They are about how two templates use
people who can be recognised, which the licence restricts ("in a bad light",
"imply endorsement"). Fix them in `07-templates/src/` before these files go
to a printer or a social account.

1. **A5 flyer, street cook (34772940).** His face is clear, beside the Menu
   Master logo and the headline "What does one plate really cost you?". That
   reads as if he uses or recommends Menu Master. The apron also shows part
   of another brand's logo ("VO…"). Re-crop to the hands and the tray, as the
   website does, or choose a photo with no face.
2. **Instagram post, Lagos produce stall (23490764).** The seller is in
   profile, looking down, under "Tomatoes went up. Did your price?". That is
   close to the line; a crop to the stall is safer. The danfo's number plate
   is readable: crop or blur it.

The WhatsApp status (no face), the link preview (no people) and the website
band (cropped to food and hands) need nothing.

## How to re-check

Before every print run, before a photo is used somewhere new, and at least
every six months:

1. Open each Pexels page above. Confirm it still says Free, links to the
   Pexels License, and is not marked editorial. If a page has gone, stop
   using that photo and replace it.
2. Open https://www.pexels.com/license/ and compare its lists with the
   quotes above. Note any change here.
3. Look at every place the photo is used for a recognisable face beside a
   claim about the product, a brand logo, or a readable number plate.
4. Update the "Checked" date in the table.
