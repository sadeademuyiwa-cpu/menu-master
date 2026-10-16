# Information architecture

Five destinations an owner taps daily, and everything else reachable
from the one it belongs to. This is how the app ships today (`web/src/lib/nav.ts`),
kept because the usability reasoning behind it is sound: ten equal items
did not fit a 360 px phone.

```
Public
├── /                      Landing (marketing)         ─ signed-in users are sent to /dashboard
├── /signup · /login · /forgot-password · /reset-password · /verify-email
├── /terms · /privacy · /refunds
└── /checkout              Paystack hand-off and return

Setup (once, owners and managers, until one dish is costed and priced)
├── /onboarding            Business name, kind, place, WhatsApp
└── /start                 Guided first dish: pot → cost → price

App (signed in, inside a business)
├── Home        /dashboard             This week · Needs attention · Quick actions · Ready to sell
│                                      (first day: the four setup steps instead of "this week")
├── Sales       /sales                 Today's sales, totals, unpaid
│   ├── /sales/new                     Take an order (Costing + Sales only; locked panel otherwise)
│   ├── /sales/[id]                    Lines, cost at sale, receipt, cancel-and-reissue
│   └── Customers  /customers · /customers/[id]
├── Purchases   /purchases             Recent purchases grouped by day; by item; by supplier
│   ├── /purchases/new                 Lines as bought, receipt photo
│   ├── /purchases/[id] · /[id]/correct
│   ├── Ingredients /ingredients · /ingredients/[id]
│   └── Suppliers   /suppliers
├── Recipes     /recipes               Every dish with its state
│   ├── /recipes/new                   Name, batch size, how it is sold, time
│   ├── /recipes/[id]                  Cost → price → keep; try a price; what goes in; how you sell it
│   ├── Sizes      /formats · /formats/[id]
│   └── Prices     /pricing            Table of every size: cost, price, keep
└── More        /more
    ├── Price per head  /quote         Event / party quote from costed dishes
    ├── Reports         /reports       Period, by dish, by day, cancelled
    ├── Wages & running costs /settings
    ├── People          /settings/people
    ├── Plans & billing /subscribe
    ├── Account         /account       Login, businesses, appearance, help, log out
    ├── Setup guide     /start
    └── Administration  /admin (platform owner only) · /admin/signups · /subscriptions · /billing · /alerts · /site
```

## Which nav item lights up

| URL starts with | Active item |
|---|---|
| /dashboard | Home |
| /sales, /customers | Sales (customers are reached from Sales) |
| /purchases, /suppliers | Purchases |
| /recipes, /formats, /pricing | Recipes |
| /more, /ingredients, /quote, /reports, /settings, /subscribe, /account, /admin | More |

Ingredients are listed under More (as today) but are also linked from
every purchase line and every recipe line, which is where owners actually
reach them.

## Roles and what they see

| Role | Sees costs | Records sales | Edits dishes & purchases | Settings, people, billing |
|---|---|---|---|---|
| Owner | yes | yes | yes | yes |
| Manager | yes | yes | yes | settings only |
| Kitchen | yes | no | yes | no |
| Sales | **no** | yes | no | no |
| Accountant | yes | no | no | read-only reports |

A role that cannot do something does not see the button. The database
refuses it anyway; the screen just avoids promising it.

## Plans and what is locked

- **Costing:** everything under Home, Purchases, Recipes, Sizes, Prices, Price per head, Ingredients, Suppliers, Settings, People. Sales, Customers and Reports show the lock panel (`29-sales-locked`).
- **Costing + Sales:** everything.
- **Trial:** everything, 14 days, with the gold trial notice on Home and Plans.
- **Trial ended / lapsed:** everything readable, every add/edit button leads to Plans.
