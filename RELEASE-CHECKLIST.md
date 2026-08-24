# Finish the deployment — exact steps

Where things stand:

| | Status |
|---|---|
| Render API | **Live and healthy** on the compiled build. `/health` and `/config` OK, staff login works. |
| Supabase | **Half-seeded.** Invoices stop at 2026-08-11 — the run died about 85% through. Today's calendar, store orders, loyalty totals and timeline snapshots were never written. |
| Vercel web | **Old build (`855cc8e`).** Still says "Unisex Salon", still the text wordmark. The gents/logo commit was Blocked. |
| GitHub repo | Now public — which unblocks Vercel. |

Do these in order. Steps 1–3 are the whole job.

---

## 1. Commit and push

The seed fix isn't committed yet. From your machine:

```bash
cd ~/Documents/Dastaan
git add -A
git commit -m "Seed runs in one transaction with --reset; atomic so a dropped connection can't half-write"
git push
```

Nothing secret should go up — this must print nothing:

```bash
git ls-files | grep -E '\.env$|\.db$|^dastaan-api/dist/'
```

---

## 2. Re-seed Supabase — one command

Now that the repo is public, Vercel will build on the push above. Meanwhile fix
the database. **No SQL Editor needed any more:**

```bash
cd ~/Documents/Dastaan/dastaan-api
npm run seed:reset
```

That's it. `--reset` clears every app table and rebuilds, all inside a single
transaction. Expect roughly:

```
Reset: cleared all app tables.
Writing 42 days of history ·············································· done
Seeded a demo-ready salon:
  · 42 days of history · 445 invoices · AED 100,265 revenue
  · 240 ratings · 9 registered clients · 14 archived timeline days
```

The dots are one per day, so you can see it moving — it writes ~1,500 rows over
the Supabase pooler and takes a couple of minutes. **Let it finish.**

If it dies or you interrupt it, the whole thing rolls back and you're left with
whatever you had before, not a half-built database. Just run it again. (That
was the bug: without a transaction every insert auto-committed on its own, so
the interrupted run left 391 invoices behind and the "already seeded" guard
then reported the database as fine.)

Verify:

```bash
curl -s "https://dastaan-api.onrender.com/health"
```

then sign in at `/team` with `9999` and check Reports → **Today** shows sales
and the calendar has appointments. The last-7-days figure being non-zero is the
tell that it completed.

> `npm run seed` (no reset) still refuses to touch a database that has data —
> that guard is deliberate. `seed:reset` is the one that rebuilds.

---

## 3. Confirm Vercel deployed

The Blocked deployment was rejected because commit author `Arbaaz234` wasn't a
contributor on a VectorShift-owned project, and Hobby doesn't allow
collaborators **on private repos**. Public repo removes that restriction, so the
push in step 1 should build.

1. Vercel → project `dastaan` → **Deployments**. The newest should go
   Building → Ready, not Blocked.
2. If it's still Blocked: open it and click **Redeploy** — a redeploy initiated
   by you as the project owner isn't subject to the author check.
3. Check `API_URL` under Settings → Environment Variables is
   `https://dastaan-api.onrender.com` (it is, already confirmed).

Live site: **https://dastaan-uae.vercel.app**

---

## 4. Smoke test

| Check | Where | Expect |
|---|---|---|
| New build shipped | `/` | "Gentlemen's Grooming", not "Unisex Salon" |
| Logo, dark | `/` | D mark + wordmark in ivory, top-left |
| Logo, light | `/console` | Same mark in ink on the light chrome |
| Favicon | browser tab | Ivory D on a dark rounded square |
| Staff login | `/team` → `9999` | Imtiaz Dastaan, Owner |
| Calendar | console → Calendar | 9 barber columns, ~16 appointments today |
| Reports | Reports → 7 days | Non-zero. **If this is 0, step 2 didn't finish.** |
| Clients | console → Clients | ~146 clients, 2–9 visits each |
| Reviews | console → Reviews | Ratings across all barbers |
| Inventory | console → Inventory | Two lines flagged below reorder |
| Client login | `/login` → `demo` / `demo1234` | Loyalty card, Gold tier |
| Invoice PDF | a past paid booking | A5 branded PDF downloads |
| Payments off | `/store` cart | "Place order", not "Pay now" |
| Store stock | `/store` | Sold-out lines dimmed and unbuyable; "3 left" where scarce |
| Delivery only | `/store` cart | Asks for an address; no branch picker anywhere |
| TRN on invoice | invoice PDF | `TRN 104235451200003` in the header **and** footer |
| Team tab | console → Team | Everyone who can sign in; owner marked "You" |
| Shop back office | `/shop` → `shop` / `shop1234` | Warehouse stock, one national figure |
| Shop is separate | `/shop` as reception | Sign-in form, not the warehouse |
| Forgot password | `/login` → Forgot password? | Reaches `/forgot`, not a dead `#` |

First request after idle takes ~1 minute — Render Free spins down after 15.

---

## Optional

- **Keep-warm ping**: cron-job.org hitting `https://dastaan-api.onrender.com/health`
  every 10 minutes. Stops Render sleeping and stops Supabase pausing at 7 days idle.

## After deploying to a database that is not re-seeded

The seed creates the shop manager and stocks the warehouse. A live database
that keeps its data has neither, so:

1. Console → **Team** → add a shop manager and set their first password.
2. Sign in at `/shop` → **Receive** stock for each product.

Until step 2 the storefront shows everything sold out. That is correct: the
website can only sell what has been put into the warehouse.

## Still open (not blocking the demo)

- `dastaan-payments` is built and tested in isolation, but this API's
  `/payments/*` boundary is not wired to it and the booking wizard has no
  pay-now step. `PAYMENTS_ENABLED=0` until both are done
- Email is unconfigured (`EMAIL_PROVIDER` unset), so reset links only print to
  the Render log
- GPS attendance — day-2 requirement, not started
- WhatsApp/SMS provider — `SMS_PROVIDER=console`, so notifications only print to the Render log
- **Rotate the Supabase password (`Dastaan@123`) and `CODE_PEPPER`** before go-live — both have been in a chat transcript. Changing `CODE_PEPPER` invalidates every staff code, so re-seed after
- **The repo is public now** — good for the portfolio, but it also means anyone can read `render.yaml`, the schema and the demo codes. Nothing secret is committed, but keep it that way
- Vercel free tier is non-commercial; move to Pro before real bookings
- Replace demo branches, services, staff and codes with the salon's real details; import clients from Fresha's CSV export
