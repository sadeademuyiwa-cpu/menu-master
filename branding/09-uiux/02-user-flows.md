# User flows

The top jobs, as sequences of screens. Screen numbers refer to
`screens/` and `renders/`. Target times are what the usability sessions
should measure (`docs/USABILITY_SESSIONS.md`).

## Flow A · From nothing to a costed, priced plate (first session, ≤ 6 min)

```
00 Landing ─► 01 Sign up ─► (verify email) ─► 03 Onboarding ─► 04 Guided setup: one pot
   │                                                                   │
   │                                              "See my cost" ─► cost of one plate + suggested price
   │                                                                   │
   └────────────────────────────────────────────────────────► 06 Home, first day (2 of 4 done)
```

Decisions designed in:
- Onboarding asks four things, three optional. Nothing about VAT, tax IDs, currencies.
- The first dish is entered as *a pot*, not a recipe: items as bought (a paint, a basket), what was paid, how many plates a pot makes. Units we don't know are accepted and resolved later, never blocking.
- The result screen shows cost per plate, and only if the owner typed a selling price, what they keep. No suggested price appears if any item is missing a price.

## Flow B · "You went to the market this morning" (daily, ≤ 90 s)

```
05 Home ─► "+" or Quick action "New purchase" ─► 12 New purchase ─► Save
                                                                      │
                                              toast "Purchase saved. 4 dishes recosted." ─► 11 Purchases
```
- Lines are entered as bought. Known units show a green conversion badge; a new unit shows a warning badge and a hint, never a blocker.
- The summary column states what saving will do ("recosts 4 dishes") and what it will not ("old sales keep the cost they were sold at").

## Flow C · "What does one plate cost now, and what should I charge?" (≤ 30 s)

```
05 Home (Needs attention row) ─► 08 Dish ─► hero trio: cost · price · keep
                                              ├─ warn notice names the price that reaches the target
                                              └─ Try a price ─► live "you keep" ─► Save as the price ─► toast
```
- The three numbers are always in the same order and position.
- "Try a price" is a sandbox; nothing changes until the save button, whose label contains the price.

## Flow D · Fixing a wrong unit (≤ 40 s)

```
08 Dish ─► line "Ofada rice 4 kg" ─► tap ─► bottom sheet: quantity + unit dropdown ─► Update ─► toast "Ingredient updated" ─► cost moves
```
- Edit in place via a sheet, not a separate page. The dropdown lists the units this ingredient has ever been bought in, plus "another unit…".

## Flow E · Take an order and send the receipt (Costing + Sales, ≤ 45 s)

```
15 Sales ─► New sale ─► 16 tap dishes (qty steppers) ─► customer (optional) ─► paid by ─► Confirm
                                                                                   │
                                      17 Sale detail ─► receipt preview ─► Send on WhatsApp (wa.me text)
```
- The total line shows "you keep about ₦3,240" before confirming: the product's promise, at the moment of sale.
- Dishes with no price show "no price yet" and cannot be added; tapping one offers to set a price.
- "Confirm and send receipt" does both in one tap for the common case.

## Flow F · Correcting a sale (never editing)

```
17 Sale ─► Cancel and reissue ─► sheet: reason (optional) ─► Cancel sale ─► new draft prefilled ─► Confirm ─► both sales on the list (#0226 cancelled → #0227)
```

## Flow G · A caterer quotes 100 guests (≤ 2 min)

```
28 More ─► Price per head ─► 20 guests, target %, dishes with per-guest amounts
                                   ├─ all costed → cost per head, price per head, total for N
                                   └─ one dish incomplete → no price shown; "Remove" or "Cost it"
```

## Flow H · Trial ends

```
any page ─► gold notice "Trial: 3 days left" ─► 26 Plans ─► Paystack checkout ─► return ─► toast "You're on Costing + Sales" ─► founder badge on Account
(lapsed) any add/edit button ─► 26 Plans; reading is never blocked
```

## Flow I · Inviting staff

```
24 Settings ─► People ─► 25 email + role ─► Send invitation ─► invitee signs up with that email ─► lands in the business ─► Sales role sees no costs
```

## Error and edge flows designed for

| Situation | What the owner sees |
|---|---|
| Offline | Warn notice; reads work; saves say "will work again when you're back on data" |
| Slow network | Progress bar on header; skeletons; busy buttons |
| Refusal by the database (role, plan) | Warn toast with the reason in plain words; the button that caused it is hidden next time |
| Missing price, conversion, labour rate | Red/amber badge naming the gap and a one-tap way to fix it; no number shown |
| Duplicate ingredient name | Inline suggestion "You already have Pepper. Use it?" |
| Price below cost | Bad notice "At ₦800 you lose ₦50 a plate" on the dish and the Prices table |
