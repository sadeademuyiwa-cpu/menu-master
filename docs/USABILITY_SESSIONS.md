# Watching three owners use Menu Master

The gate in `branding/09-uiux/04-simplify-plan.md` (section 7, "Gate: watch
three owners use it"), first planned as Phase 4 of `docs/PLAN_NATURAL_UX.md`.
Three sessions, one person each: a buka or rice seller, a caterer, a baker.
Each does five tasks on their own phone while you watch and keep quiet, then
three short comparisons of ideas we held back. The point is not to teach
them; it is to find the places where a real owner stalls. About an hour each.

## The names in this build

The app changed its names in October 2026. Use these words when you read a
task aloud, and never the old ones, or you will be testing your own words
instead of the app's.

| Say | Not | Where it is |
|---|---|---|
| Dishes | Recipes, Products | The fourth tab. Each dish has its own page. |
| Settings | "Wages & running costs" | More → Settings: kinds of work and their rates, monthly bills, your target |
| Customers | | Under Sales (a button on the Sales page) |
| Price per head | Quote | Under Sales; for a caterer it comes first |
| Ingredients, Suppliers | | Under Purchases (buttons on the Purchases page) |
| Sizes, Prices | Formats | Under Dishes (buttons on the Dishes page) |
| Size | Format | "6-inch", "Big plate" |

The five tabs are Home, Sales, Purchases, Dishes and More, the same for
every role. More has Settings, People, Reports, Plans & billing, Account and
Setup guide. Until 15 December 2026, a "Moved:" line on More links to the
pages that moved out of it.

---

## Before the first session (once)

1. **Ship the build.** Production is at 0062. Apply 0063 (dish photos), then
   0064 (staff see selling prices), then deploy the app: in that order,
   because the app reads the photo column that 0063 adds. Follow
   `deploy/runbook/DEPLOY_0063.md`, then `deploy/runbook/DEPLOY_0064.md`
   (PRE → psql → POST for each). Then push `launch/2026-10-02` so Vercel
   builds it. Check `menumasterng.com` loads, you can sign in, and a dish
   photo you add shows on Home.
2. **Open the app on your own phone** and walk through every task below once
   yourself, on a fresh trial account. The screens were rebuilt in October;
   if a button word quoted in "What to watch" has changed, correct it here
   first. If you stall anywhere, fix that first; do not waste a participant
   on something you already know.
3. **Find three people.** Not friends who will be kind. A buka owner you buy
   from, a caterer from a WhatsApp group, a baker from Instagram. Say: "I am
   building an app that works out what your food really costs you. Can I sit
   with you for an hour while you try it? I will pay for your time."
   ₦5,000–₦10,000 airtime or cash is normal. Book a time when their shop is
   quiet.
4. **Prepare, for each person:**
   - Their phone, with data. Not yours: you want to see their screen size,
     their keyboard, their network.
   - A second phone to film their screen over their shoulder (ask first), or
     screen-recording on their phone if they are comfortable.
   - This document, printed or on your laptop, with the score sheet at the end.
   - Their own figures ready: one dish they actually make, what they paid
     for its ingredients at the last market run (receipt or memory), what
     they charge for a plate. Real numbers make them care; invented ones
     make them polite.
   - A photo of that dish on their phone if they have one (many have sent
     one on WhatsApp). Do not mention it; just know whether it is there.
   - The four printed pictures for the comparisons (see "Three ideas we held
     back" below).
5. **Do not pre-create their account.** Signing up is task one.

## During a session

- Sit beside them, not across. Hold the script; they hold the phone.
- Read each task aloud exactly as written, then **say nothing for 60
  seconds** however much they struggle. Count in your head. Only after that
  may you ask "what are you looking for?" (not "tap the green button").
- When they say "I don't understand this" or "what does this mean?", write
  down the exact word on the screen they are pointing at.
- When they tap something and nothing happens, or they tap the wrong thing,
  write down what they tapped and what they expected.
- Write the time each task took. Your phone's stopwatch is enough.
- Never say "you were supposed to…". If they fail a task, say "that's useful,
  thank you" and move on. A failed task is the best result the session can
  give you.
- If the app breaks (an error, a blank page), note it, take a screenshot,
  and give them the next task.
- Never mention photos until the photo task. Whether they add one without
  being asked is one of the things we are measuring.

## After each session

Ask these five questions and write the answers down word for word:

1. "If this cost ₦7,500 a month, would you pay? Why or why not?"
2. "What would you use it for tomorrow morning?"
3. "What was the most confusing moment?"
4. "What did you expect it to do that it didn't?"
5. "Would you put a photo on every dish you sell? Why or why not?"

Then thank them, pay them, and within an hour, while it is fresh, fill in
the score sheet.

---

## The tasks

Read these aloud exactly. Each person gets the five for their kind of
business, then the three comparisons that everyone does. A task "passes" if
they reach the end without you helping.

### Buka / rice seller

| # | Say this | Done when | What to watch |
|---|---|---|---|
| 1 | "Sign up and set up your business with the dish you cook most. Use what you really paid at the market." | They reach the dish's page and it shows a cost per plate from their own purchase | Where do they stop in setup? Do they understand "one pot makes N plates"? Do they know what to put for ingredients they buy by paint or derica? Do they tap "Add a photo" on the dish without being asked? |
| 2 | "You went to the market this morning. Record what you bought." | A purchase is recorded and the dish's cost has changed | Do they use Home's "Record a purchase", the Purchases tab or the green "+"? Do they get stuck on units (bag, kg, paint)? What do they call this job out loud: market, shopping, buying? |
| 3 | "What does one plate cost you now, and what should you charge to keep 40%?" | They say both numbers aloud from the screen, or tap "Use ₦…" and confirm | Do they find it on Home ("Needs you", with its "Use ₦…" button) or on the dish? Do they trust "Use ₦…", or want to type their own? Do they understand "you keep"? Do they try "Try a price"? |
| 4 | "You typed 4 kg of rice but it was 4 paint. Fix it." | The line reads 4 paint and the cost has moved | Do they tap the ingredient line on the dish, or try to remove it and add it again? Do they see the "Ingredient updated" message? |
| 5 | "Record three plates you sold today, then tell me what you kept this week." | Three sales recorded; they read the "This week you kept" figure on Home | Do they use Home's "Record a sale", the green "+" or the Sales tab? Do they find the dish by its picture or by its name? Do they press "Confirm and send receipt" or "Confirm sale", or save for later by mistake? Do they read the week's bars? |

### Caterer

| # | Say this | Done when | What to watch |
|---|---|---|---|
| 1 | "Sign up and set up your business with one dish from your last event, with what you paid." | Dish page shows a cost per portion | Same as buka task 1 |
| 2 | "Your jollof uses the stew you make separately. Add the stew as a dish, then make the jollof from it." | The jollof's ingredient list shows the stew with "Made from another dish" | Do they find "Add a dish you make"? Do they pick a unit of the right kind (litres of stew)? Does the stew under Dishes make sense to them, or do they expect it somewhere else because they never sell it on its own? |
| 3 | "A client wants that jollof for 100 guests. What does the food cost you per head, and what should you charge?" | They read both figures from Price per head | Do they find Price per head on the Sales page? Do they look in More first, where it used to be? Do they understand "per guest"? |
| 4 | "Take the order: 100 plates of jollof, plus delivery which you charge ₦5,000 for and costs you ₦3,000. Save it and send them a quote on WhatsApp." | A draft exists; the quote text is on screen or WhatsApp opens | Do they find "Something not on the menu"? Do they see "What one costs you"? Do they find "Save for later" and then "Send as a quote"? Do the amounts in the WhatsApp text look like the app's (₦5,000, not ₦5,000.00)? |
| 5 | "The rice on that purchase was ₦95,000, not ₦85,000. Correct it." | The purchase page says "This purchase was corrected" and the new one shows ₦95,000 | Do they find "Correct this purchase" or go for Cancel? Do they understand the earlier one is cancelled, not lost? |

### Baker

| # | Say this | Done when | What to watch |
|---|---|---|---|
| 1 | "Sign up and set up your business with one cake you bake, with what you paid for its ingredients." | Cake page shows a cost | Same as buka task 1; watch for grams versus cups |
| 2 | "You pay someone ₦2,000 an hour to decorate, and one cake takes 2 hours. Add that to the cost." | "Time it takes" shows 2 hours at ₦2,000 and the cost per portion has risen | Do they start on the cake page under "Time it takes", or go to More → Settings → Kinds of work? Do they understand the rate lives in Settings and the hours live on the cake? |
| 3 | "You sell this cake in 6-inch and 8-inch. Set those up and price them." | Both sizes show a cost and a price on the cake page | Do they go to Dishes → Sizes, or use "Sizes you sell this in" on the cake? Do they understand each size has its own price? If both sizes are below target, do they use "Use suggested prices for both sizes"? |
| 4 | "You have a big order: make a batch four times the size." | Batch size shows ×4 and every quantity has scaled | Do they find "Scale everything" under "About this dish", or start multiplying by hand? |
| 5 | "You spelled the cake's name wrong. Fix it. Then there's a test cake you don't bake any more — get rid of it." | Name changed; the test cake is put away and gone from the Dishes list | Do they find "Edit this dish" under "About this dish"? For the second part, do they look for "delete"? Does "put away" make sense to them? |

---

## Three ideas we held back

Three changes were left out of this build on purpose, so that real owners
decide them, not us (`04-simplify-plan.md`, sections 5 and 11). Everyone
does all three, after their five tasks. Ten minutes in total.

**Make four printed pictures before the first session.** Take a screenshot
of Home from the live build on a phone, then make three edited copies (the
person who builds the app can do this in a few minutes in the browser's
developer tools). Do not build these into the app.

- **A:** Home as it is: the bottom bar with Home, Sales, Purchases, Dishes,
  More, and the green "+" above it.
- **B:** the same, but no "+", and a raised green "Sell" button in the middle
  of the bar.
- **C:** the same as A, with "Purchases" in the bar renamed "Market".
- **D:** the same as A (used as the "Purchases" picture for comparison 2, so
  both pictures in a pair look equally finished).

Alternate which picture of a pair you show first: person one sees A before
B, person two B before A, person three A before B.

### 1. A raised "Sell" button, or the "+"

Show picture A, then B (or B, then A). For each, say:

> "A customer just bought two plates. Where would you tap to write that down?"

Write down where their finger goes first and how long it takes. Then show
both together and ask: "Which one would you rather have? Why?"

Also use what you saw in buka task 5 (or the caterer's order): did they use
the "+" at all, or Home's "Record a sale", or the Sales tab? Someone who
never touched the "+" in the live app tells you more than anything they say
about a picture.

### 2. "Market" or "Purchases"

Show picture D, then C (or C, then D). For each, say:

> "Where would you go to write down what you bought at the market this
> morning?"

and then:

> "Where would you look to see what you spent on tomatoes last week?"

Write down the first tap and any pause longer than three seconds. Then ask:
"What would you call that part of the app?" and write their word exactly.
Add the words they used for buying in buka task 2.

### 3. Do owners add dish photos?

This one starts before you ask anything. Through tasks 1 to 5, note whether
they added a photo on their own: the "Add a photo" button on the dish page,
or the "Add photos of your best sellers" card on Home. Then say:

> "Put a picture of your [their dish] on it, so it shows when you sell it."

| Done when | What to watch |
|---|---|
| Their own photo shows on the dish page, and on Home and the New sale tiles | Do they find "Add a photo" on the dish? Camera or gallery? Do they pick a photo they already sent on WhatsApp? Did they read the tip ("Daylight from a window, shoot from above, right after dishing")? How long from tap to photo showing? Do they ask about data, or about who can see the photo? Do they find the photo on the sale screen afterwards? |

If they ask who can see it, the honest answer is: anyone who has the exact
link, which is a long random name nobody can guess; it is not listed
anywhere. Write down how they react. Do not show them "Hide photos to save
data" (under Account) unless they ask how to save data, and note it if they
do.

A week later, send each person one WhatsApp message: "Did you add photos to
any more of your dishes?" Write down the answer.

---

## Score sheet (one per person)

Fill in straight after the session.

```
Name / business kind: ______________________   Date: ________   Phone: ________________

Task   Passed?   Minutes   Stalled at (screen + the word they pointed at)   What they said
1      Y / N     ____      ______________________________________________   ______________
2      Y / N     ____      ______________________________________________   ______________
3      Y / N     ____      ______________________________________________   ______________
4      Y / N     ____      ______________________________________________   ______________
5      Y / N     ____      ______________________________________________   ______________

To record a sale in the live app they used:   Home "Record a sale" / "+" / Sales tab / other: ____
Sell vs "+":    shown first: A / B    first tap on A: ____________  on B: ____________
                seconds on A: ____  on B: ____    prefers: A / B    because: ______________
Market vs Purchases:   shown first: C / D
                "bought this morning" first tap on D: __________  on C: __________
                "tomatoes last week"  first tap on D: __________  on C: __________
                their own word for that part of the app: _____________________________
Photos:         added one before being asked?  Y / N   (where: dish page / Home card)
                photo task passed?  Y / N   minutes: ____   camera / gallery / WhatsApp photo
                asked about data or privacy?  ___________________________________________
                a week later, more dishes with photos?  ______________________________

Words they used that the app does not:  ________________________________________________
Words on the screen they did not understand:  __________________________________________
Taps that did nothing / went somewhere unexpected:  _____________________________________
Errors or blank pages (screenshot filename):  ___________________________________________

Would pay ₦7,500/month?  Y / N   Because: _______________________________________________
Would use tomorrow for: _________________________________________________________________
Most confusing moment: __________________________________________________________________
Expected but missing: ___________________________________________________________________
Photo on every dish?  Y / N   Because: __________________________________________________
```

## Turning it into fixes

After the third session, put the three sheets side by side and list every
stall. Then:

1. **Anything two or more people stalled on is a bug in the app, not in the
   person.** Fix those first, before any new feature. Most will be words
   (rename to what they said) or a thing they could not find (put it where
   they looked).
2. **Anything one person stalled on** goes in a list; fix it if it is cheap.
3. **Anything that broke** (error, blank page) is fixed before anything else.
4. The "would you pay" answers tell you more than the tasks. Three noes with
   the same reason is the next phase of the plan.

For the three held-back ideas, decide like this:

- **Sell button.** Build the raised "Sell" button only if at least two of the
  three found the sale faster on picture B *and* at least two ignored or
  missed the "+" in the live app. Otherwise keep the "+" and Home's "Record a
  sale" as they are.
- **Market.** Rename the tab only if at least two of the three went to
  "Market" first and paused on "Purchases", or called that part "market"
  themselves. A rename changes the label only; the address stays
  `/purchases`, as Dishes kept `/recipes`.
- **Photos.** If at least two of the three added a photo, with or without
  being asked, and would put one on every dish, keep the Home card and the
  setup prompt. If two or more skipped it or said "no", leave the tiles as the
  normal look and ask less often. Either way, a dish never gets a stock photo.

Write the stalls and the three decisions into a new section of
`docs/PLAN_NATURAL_UX.md` headed "What three owners stalled on, <date>", one
line each, and start from there.

## If a session goes badly

It will. One person will not get past signup because their email went to
spam, or the network will drop in the middle of a purchase. Note what
happened, keep going with the next task, and treat it as a finding: that is
what will happen to a paying customer too.
