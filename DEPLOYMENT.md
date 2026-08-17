# Deployment

Two services plus a database. The web app is a natural fit for Vercel; the
API needs a home that suits a long-running server (see "Choosing a host").

```
GitHub (Arbaaz234/dastaan)  ──►  Vercel  ──►  dastaan-web
                            └──►  <API host>  ──►  dastaan-api  ──►  Supabase Postgres
```

---

## 1. Push the code to GitHub (Arbaaz234)

The repo is already staged locally. Finish it from **your machine** (the
assistant's sandbox can't delete files, so it couldn't complete the commit):

```bash
cd ~/Documents/Dastaan
rm -f .git/index.lock          # leftover lock from the staging step
git commit -m "Dastaan salon platform: booking, console, POS, invoicing, loyalty, store"
git branch -M main

# create an empty repo on github.com/Arbaaz234 first (no README/licence),
# then:
git remote add origin https://github.com/Arbaaz234/dastaan.git
git push -u origin main
```

Check before pushing that `git ls-files | grep -E '\.env$|\.db$'` prints
nothing. `.env`, the local database, and the client's Fresha video are all
gitignored.

### Portfolio repo + a different Vercel account

These are independent, so **yes, this works**: the code lives on
`Arbaaz234` (good for your GitHub profile) while the Vercel project sits
under the VectorShift account. When you connect the project, Vercel asks to
install its GitHub App — install it on the `Arbaaz234` account and grant
access to the `dastaan` repo. Vercel then builds from that repo regardless
of which Vercel account owns the project.

---

## 2. Database — Supabase

1. In the VectorShift org, **New project** → name `dastaan`, region closest
   to Dubai (e.g. `eu-central` or `ap-south`), and save the database
   password.
2. Copy the **connection string** (Project Settings → Database → Connection
   string → URI). Use the **pooled** connection (port 6543) if the API runs
   serverless, the direct one (5432) if it's always-on.
3. Set it as `DATABASE_URL` on the API host.

> Free-tier note: a Supabase project **pauses after ~7 days without
> requests**. Fine while building; before the salon goes live either upgrade
> or make sure the cron ping in step 4 keeps it warm.

---

## 3. Web app — Vercel

- **New Project** → import `Arbaaz234/dastaan`
- **Root directory:** `dastaan-web`
- Framework preset: Next.js (auto-detected)
- Environment variable:
  - `API_URL` = the deployed API's base URL (e.g. `https://dastaan-api.onrender.com`)

`next.config.ts` already rewrites `/api/*` to `API_URL`, so the browser
stays same-origin and the session cookie just works — no CORS setup.

---

## 4. API — Render (chosen)

The API is a normal always-on Node service, so its two schedulers (the
2-hour appointment reminders and the nightly calendar snapshot) keep working
with no changes.

1. Render → **New** → **Blueprint**, pick the `Arbaaz234/dastaan` repo.
   It reads `dastaan-api/render.yaml`.
2. Set the secrets it asks for: `DATABASE_URL` (Supabase), `WEB_ORIGINS`
   (your Vercel URL), `REVIEW_URL`, `GOOGLE_REVIEW_URL`. `JWT_SECRET` and
   `CODE_PEPPER` are generated for you.
3. First deploy: open the Render shell and run `npm run seed` once to create
   the branches, services, staff codes and demo data.
4. Copy the service URL into Vercel's `API_URL`, then redeploy the web app.

> Render's free instances sleep after ~15 minutes idle and take a few
> seconds to wake. Bookings and reminders are unaffected in practice, but if
> you want it always warm, either upgrade or have the cron in step 4b ping
> `/health` every 10 minutes (this also keeps Supabase from pausing).

### 4b. Optional: keep-warm ping

Free scheduler (cron-job.org, Runhooks, or a GitHub Action) hitting
`https://<api>/health` every 10 minutes keeps both Render and Supabase awake.

## Appendix — if you ever move the API to Vercel

The API is a persistent Fastify server with two background schedulers: the
notification outbox (booking confirmations, **reminders 2 hours before an
appointment**, feedback requests) and the nightly calendar snapshot.

**Vercel is serverless.** Functions start per request and stop; a
`setInterval` cannot survive. Vercel's own Cron on the free tier is capped
at **once per day**, fired anywhere within the hour — too coarse to send a
reminder two hours before a 3:40pm appointment.

Two workable shapes:

### A. Always-on host (recommended, closest to the current code)
Deploy `dastaan-api` as a normal Node service — Render, Fly.io, Koyeb or a
small VPS. The schedulers keep working untouched. Free tiers exist; note
that Render's free instances sleep after inactivity, which delays reminders
until the next request wakes them.

### B. Serverless on Vercel + external cron
Deploy the API to Vercel too, and replace the in-process schedulers with a
protected endpoint:

```
POST /internal/cron/drain      header: x-cron-token: <CRON_TOKEN>
```

Then have a free scheduler (cron-job.org, Runhooks, GitHub Actions cron)
call it every 5 minutes. Reminder accuracy becomes ±5 minutes, which
comfortably satisfies "at least 2 hours before". This also keeps the
Supabase project awake.

The database is already PostgreSQL — done, see step 2.

---

## 5. Environment variables (API)

```bash
NODE_ENV=production
DATABASE_URL=postgresql://...        # Supabase (unset locally → embedded PGlite)
JWT_SECRET=<48 random bytes hex>     # node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
CODE_PEPPER=<48 random bytes hex>    # different value from JWT_SECRET
WEB_ORIGINS=https://dastaan.vercel.app,https://dastaan.com
TRUST_PROXY=1

# notifications
SMS_PROVIDER=twilio
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM=
REVIEW_URL=https://dastaan.vercel.app/review
GOOGLE_REVIEW_URL=<the salon's Google review link>

# payments — keep OFF until the payments service is live
PAYMENTS_ENABLED=0
```

Never commit these. Rotate anything that has ever been in a chat or a repo.

---

## 6. Go-live checklist

- [ ] `PAYMENTS_ENABLED=1` only once the payments service is deployed and tested
- [ ] Vercel plan: the free tier is **non-commercial**; move the project to Pro
      before the salon takes real bookings and payments
- [ ] Supabase on a plan that doesn't pause, plus automated backups
- [ ] Real `WEB_ORIGINS` (no localhost) and `TRUST_PROXY=1`
- [ ] Seed replaced with the salon's real branches, services, staff and codes —
      **change every demo code (1111 / 2222 / 9999)**
- [ ] Custom domain + TLS
- [ ] Client list imported from Fresha (CSV export)
