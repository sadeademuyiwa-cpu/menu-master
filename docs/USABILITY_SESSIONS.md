# Watching three owners use Menu Master

Phase 4 of `docs/PLAN_NATURAL_UX.md`. Three sessions, one person each: a
buka or rice seller, a caterer, a baker. Each does five tasks on their own
phone while you watch and keep quiet. The point is not to teach them; it is
to find the places where a real owner stalls. Forty-five minutes each.

---

## Before the first session (once)

1. **Ship the branch.** Apply 0060, 0061 and 0062 to production in that order
   (`deploy/runbook/DEPLOY_0060.md`, `_0061.md`, `_0062.md`: PRE → psql →
   POST for each), then push `launch/2026-10-02` so Vercel builds it. Check
   `menumasterng.com` loads and you can sign in.
2. **Open the app on your own phone** and walk through all fifteen tasks
   below once yourself, on a fresh trial account. If you stall anywhere,
   fix that first; do not waste a participant on something you already know.
3. **Find three people.** Not friends who will be kind. A buka owner you buy
   from, a caterer from a WhatsApp group, a baker from Instagram. Say: "I am
   building an app that works out what your food really costs you. Can I sit
   with you for 45 minutes while you try it? I will pay for your time."
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

## After each session

Ask these four questions and write the answers down word for word:

1. "If this cost ₦7,500 a month, would you pay? Why or why not?"
2. "What would you use it for tomorrow morning?"
3. "What was the most confusing moment?"
4. "What did you expect it to do that it didn't?"

Then thank them, pay them, and within an hour, while it is fresh, fill in
the score sheet.

---

## The tasks

Read these aloud exactly. Each person gets the five for their kind of
business. A task "passes" if they reach the end without you helping.

### Buka / rice seller

| # | Say this | Done when | What to watch |
|---|---|---|---|
| 1 | "Sign up and set up your business with the dish you cook most. Use what you really paid at the market." | They reach the dish's page and it shows a cost per plate from their own purchase | Where do they stop in setup? Do they understand "one pot makes N plates"? Do they know what to put for ingredients they buy by paint or derica? |
| 2 | "You went to the market this morning. Record what you bought." | A purchase is recorded and the dish's cost has changed | Do they find Purchases? Do they use New purchase or go through an ingredient? Do they get stuck on units (bag, kg, paint)? |
| 3 | "What does one plate cost you now, and what should you charge to keep 40%?" | They say both numbers aloud from the screen | Do they find the cost on Home or on the dish? Do they understand "margin"? |
| 4 | "You typed 4 kg of rice but it was 4 paint. Fix it." | The line reads 4 paint and the cost has moved | Do they find the Unit dropdown on the line, or try to remove and re-add? Do they see "Ingredient updated"? |
| 5 | "Record three plates you sold today, then tell me what you kept this week." | Three sales recorded; they read "You kept this week" on Home | Do they find the + or New sale? Do they confirm or save for later by mistake? Do they find the number on Home or go to Reports? |

### Caterer

| # | Say this | Done when | What to watch |
|---|---|---|---|
| 1 | "Sign up and set up your business with one dish from your last event, with what you paid." | Dish page shows a cost per portion | Same as buka task 1 |
| 2 | "Your jollof uses the stew you make separately. Add the stew as a dish, then make the jollof from it." | The jollof's ingredient list shows the stew with "Made from another dish" | Do they find "Add a dish you make"? Do they pick a unit of the right kind (litres of stew)? |
| 3 | "A client wants that jollof for 100 guests. What does the food cost you per head, and what should you charge?" | They read both figures from Price per head | Do they find Price per head (Sales page or More)? Do they understand "per guest"? |
| 4 | "Take the order: 100 plates of jollof, plus delivery which you charge ₦5,000 for and costs you ₦3,000. Save it and send them a quote on WhatsApp." | A draft exists; the quote text is on screen or WhatsApp opens | Do they find "Something not on the menu"? Do they see "What one costs you"? Do they find "Save for later" and then "Send as a quote"? |
| 5 | "The rice on that purchase was ₦95,000, not ₦85,000. Correct it." | The purchase page says "This purchase was corrected" and the new one shows ₦95,000 | Do they find "Correct this purchase" or go for Cancel? Do they understand the earlier one is cancelled, not lost? |

### Baker

| # | Say this | Done when | What to watch |
|---|---|---|---|
| 1 | "Sign up and set up your business with one cake you bake, with what you paid for its ingredients." | Cake page shows a cost | Same as buka task 1; watch for grams versus cups |
| 2 | "You pay someone ₦2,000 an hour to decorate, and one cake takes 2 hours. Add that to the cost." | "Time it takes" shows 2 hours at ₦2,000 and the cost per portion has risen | Do they find Settings → Kinds of work first, or look on the cake page? Do they understand the rate lives in Settings? |
| 3 | "You sell this cake in 6-inch and 8-inch. Set those up and price them." | Both sizes show a cost and a price on the cake page | Do they find Sizes? Do they attach the size to the dish ("Sell this in a size")? Do they understand each size has its own price? |
| 4 | "You have a big order: make a batch four times the size." | Batch size shows ×4 and every quantity has scaled | Do they find "Scale the batch" under Edit this dish, or start multiplying by hand? |
| 5 | "You spelled the cake's name wrong. Fix it. Then there's a test cake you don't bake any more — get rid of it." | Name changed; the test cake is under "put away" and gone from the list | Do they find Edit this dish? For the second part, do they look for "delete"? Does "put away" make sense to them? |

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

Words they used that the app does not:  ________________________________________________
Words on the screen they did not understand:  __________________________________________
Taps that did nothing / went somewhere unexpected:  _____________________________________
Errors or blank pages (screenshot filename):  ___________________________________________

Would pay ₦7,500/month?  Y / N   Because: _______________________________________________
Would use tomorrow for: _________________________________________________________________
Most confusing moment: __________________________________________________________________
Expected but missing: ___________________________________________________________________
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

Write the stalls into a new section of `docs/PLAN_NATURAL_UX.md` headed
"What three owners stalled on, <date>", one line each, and start from there.

## If a session goes badly

It will. One person will not get past signup because their email went to
spam, or the network will drop in the middle of a purchase. Note what
happened, keep going with the next task, and treat it as a finding: that is
what will happen to a paying customer too.
