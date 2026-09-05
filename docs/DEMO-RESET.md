# Re-seeding for a demo

Run this shortly before a walkthrough. It wipes the database and rebuilds it,
so everything below is current relative to the day you run it — including a
full calendar today and thirty days of forward bookings.

---

## 1. Set the demo email locally

In `dastaan-api/.env` (gitignored, never committed):

```bash
DEMO_EMAIL=arbaaz.ghameria@spit.ac.in
```

That address becomes the `demo` client's email, so a password reset opened
during the demo arrives in a real inbox. Every other client stays on
`@dastaan.test`, which is reserved and cannot reach anyone.

## 2. Re-seed Supabase

From `dastaan-api`, with `DATABASE_URL` pointing at Supabase:

```bash
npm run seed:reset
```

It runs in one transaction — a dropped connection leaves the database exactly
as it was rather than half-written. Expect a couple of minutes over a hosted
connection.

## 3. Put back what the seed does not know about

The seed rebuilds from scratch, so anything created through the UI is gone.
After every re-seed:

| What | Where | Why it is not in the seed |
|---|---|---|
| Online shop manager | Console → **Team** → *Add a manager* | The seed does create `shop` / `shop1234` — only re-add if you had made a different one |
| Warehouse stock | `/shop` → **Receive** | The seed stocks it; only needed if you want different numbers |

In practice a plain `seed:reset` leaves you with both already in place. The
table above matters only if you had customised them by hand.

---

## What you get

| | |
|---|---|
| History | 42 days · ~450 invoices · ~AED 97,000 revenue |
| Today | 21 appointments across both branches, in every status |
| Ahead | ~180 appointments over 30 days, thinning with distance |
| Clients | 9 registered (loyalty cards, visit history) + ~150 walk-ins |
| Reviews | ~240 ratings spread across every barber |
| Branch stock | Both branches, two lines below their reorder point |
| Online warehouse | 6 retail lines, one deliberately low |
| Store orders | One in each state: placed, paid, shipped, cancelled |
| Coupons | `WELCOME10`, `GROOM25`, and `SUMMER15` (expired, to show that state) |

## Logins

| Where | Credential |
|---|---|
| `/team` | `9999` owner · `1111` reception (Marina) · `1212` reception (City Centre) · `2222`–`7777`, `6161`–`6363` barbers |
| `/login` | `demo` / `demo1234` — Gold tier, ~5,000 points, 5 upcoming appointments |
| `/shop` | `shop` / `shop1234` |

---

## Before you demo the password reset

The reset link only **arrives** if email is configured on Render. Without it
the API writes the link to its log and the inbox stays empty — which looks like
a broken feature in front of a client.

```bash
EMAIL_PROVIDER=resend
RESEND_API_KEY=...
EMAIL_FROM="Dastaan <no-reply@yourdomain.ae>"
APP_URL=https://dastaan-uae.vercel.app
```

`APP_URL` matters just as much: every link in every reset email points at it,
so if it is wrong or missing the emails arrive with links to `localhost`.

**If email is not set up**, demo the reset from the console instead — Team →
Clients → *Send reset link* shows the confirmation without needing the inbox —
or skip it. Do not click it live and hope.

## A note on timing

The data is generated relative to the day the seed runs. Seed it the day
before a demo and "today" is still today. Seed it a week before and the
calendar's busiest day is in the past, which is what you saw on 24 August with
data from the 19th.
