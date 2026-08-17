# Pending steps to finish the deployment

Live now: Supabase `dastaan` (Frankfurt, VectorShift), Vercel project `dastaan`,
Render service `dastaan-api` — but Render is still running commit `855cc8e`,
which crash-loops on `tsx: not found`. Everything below fixes that and gets the
new demo data and branding onto both hosts.

Work top to bottom; each step depends on the one before it.

---

## 1. Commit and push (one push covers both hosts)

Everything is uncommitted in the working tree. Three commits keep the history
readable; one commit is fine if you'd rather.

```bash
cd ~/Documents/Dastaan

# a) the deploy fix — this is the one that unbreaks Render
git add dastaan-api/package.json dastaan-api/tsconfig.json \
        dastaan-api/tsconfig.build.json dastaan-api/render.yaml \
        dastaan-api/Dockerfile dastaan-api/README.md DEPLOYMENT.md \
        RELEASE-CHECKLIST.md
git commit -m "Build to dist/ and run plain node: tsx is a devDependency and NODE_ENV=production skips it"

# b) brand marks
git add dastaan-web/src/components/Logo.tsx \
        dastaan-web/src/app/icon.svg dastaan-web/src/app/apple-icon.png \
        dastaan-web/src/app/favicon.ico dastaan-web/public/dastaan-*.svg \
        dastaan-web/src/components/Nav.tsx dastaan-web/src/app/page.tsx \
        dastaan-web/src/app/console/page.tsx dastaan-web/src/app/login/page.tsx \
        dastaan-web/src/app/team/page.tsx dastaan-web/src/app/card/page.tsx \
        dastaan-web/src/app/book/page.tsx dastaan-web/src/app/orders/page.tsx \
        dastaan-web/src/app/store/page.tsx dastaan-web/src/app/layout.tsx \
        "dastaan-web/src/app/review/[token]/page.tsx"
git commit -m "Dastaan logo: traced mark + wordmark, currentColor so it inverts on light backgrounds"

# c) gents-only revert + the demo dataset
git add -A
git commit -m "Gents-only services and staff; demo seed with six weeks of trading history"

git push
```

Check nothing secret goes up — this must print nothing:

```bash
git ls-files | grep -E '\.env$|\.db$|^dastaan-api/dist/'
```

---

## 2. Render — add `CODE_PEPPER`, then redeploy

`render.yaml` changed, so Render needs to re-read it.

1. Service → **Environment** → add `CODE_PEPPER`, pasting the **exact value
   from `dastaan-api/.env`**. This has to match, because step 4 seeds from your
   laptop and the 4-digit staff codes are stored as `HMAC(code, pepper)`.
   Leave `JWT_SECRET` alone — Render generated it and that's correct.
2. Confirm **Build command** is `npm ci --include=dev && npm run build` and
   **Start command** is `npm start`. If the dashboard still shows the old
   `npm ci`, click **Sync blueprint** (or edit the two fields by hand).
3. **Manual Deploy → Deploy latest commit.**

Expected log: `tsc -p tsconfig.build.json`, then
`Your service is live 🎉`, then `/health` going green.

```bash
curl https://<your-render-host>/health
# {"ok":true,"service":"dastaan-api"}
```

---

## 3. Wipe the old demo data in Supabase

The database still holds the first seed (unisex-era services, "Owner" with no
name, a single day of bookings). The seed script refuses to touch a non-empty
database, so clear it first.

Supabase → **SQL Editor** → paste and run
[`dastaan-api/sql/reset-demo.sql`](dastaan-api/sql/reset-demo.sql).

Verify it's clean:

```sql
SELECT tablename FROM pg_tables WHERE schemaname = 'public';  -- 0 rows
```

---

## 4. Seed — run this once, from your machine

```bash
cd ~/Documents/Dastaan/dastaan-api
npm run seed
```

Takes a couple of minutes: it writes ~1,500 rows over the Supabase pooler.
It prints a summary when it's done:

```
· 42 days of history · 448 invoices · AED 97,555 revenue
· 239 ratings · 9 registered clients · 14 archived timeline days
```

Re-running it is safe — it detects existing data and stops.

> Render Free instances have no shell, so this can't run on the server. Same
> script, same database, so it makes no difference.

---

## 5. Vercel — point at the real API host and redeploy

1. Project → **Settings → Environment Variables**: `API_URL` must be the actual
   Render host, e.g. `https://dastaan-api.onrender.com`. It was set from a
   guess before the service existed — check the real hostname in Render.
2. **Deployments → Redeploy** (the push in step 1 may already have triggered a
   build; if `API_URL` was wrong, redeploy after fixing it).

---

## 6. Smoke test the live pair

| Check | Where | Expect |
|---|---|---|
| Logo, dark | `/` | Mark + wordmark in ivory, top-left |
| Logo, light | `/console` after signing in | Same mark in ink on the light chrome |
| Favicon | browser tab | Ivory D on a dark rounded square |
| Staff login | `/team` → `9999` | Signs in as Imtiaz Dastaan, Owner |
| Reports | console → Reports | Six weeks of revenue with a weekend curve |
| Clients | console → Clients | ~146 clients, sensible visit counts |
| Reviews | console → Reviews | Ratings and comments across all barbers |
| Inventory | console → Inventory | Two lines flagged below reorder |
| Client login | `/login` → `demo` / `demo1234` | Loyalty card, Gold tier |
| Invoice PDF | console → a past paid booking | A5 branded PDF downloads |
| Payments off | `/store` cart | Says "Place order", not "Pay now" |

First request after idle takes ~1 minute — Render Free spins down after 15
minutes.

---

## 7. Optional, same session

- **Keep-warm ping**: cron-job.org hitting `https://<api>/health` every 10
  minutes. Stops Render sleeping *and* stops Supabase pausing after 7 days idle.

## Still open (not blocking the demo)

- `dastaan-payments` service (Stripe online + Terminal); `PAYMENTS_ENABLED=0`
  until it's live
- WhatsApp/SMS provider — `SMS_PROVIDER=console` for now, so notifications only
  print to the Render log
- **Rotate the Supabase database password** (`Dastaan@123`) and both API secrets
  before go-live — they've been in a chat transcript
- Vercel free tier is non-commercial; move to Pro before real bookings
- Replace demo branches, services, staff and codes (`9999`/`1111`/`1212`/…) with
  the salon's real details, and import the client list from Fresha's CSV export
