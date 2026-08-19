# Deployment

Two services plus a database. The web app is a natural fit for Vercel; the
API needs a home that suits a long-running server (see "Choosing a host").

```
GitHub (vectorshift69/Dastaan)  ──►  Vercel  ──►  dastaan-web
                            └──►  <API host>  ──►  dastaan-api  ──►  Supabase Postgres
```

---

## 1. Push the code to GitHub (vectorshift69)

Done — the code is on `vectorshift69/Dastaan`, branch `main`. Subsequent
changes go up the usual way, from **your machine** (the assistant's sandbox
can't complete a commit because it can't remove `.git/index.lock`):

```bash
cd ~/Documents/Dastaan
git add -A
git commit -m "<what changed>"
git push
```

Check before pushing that `git ls-files | grep -E '\.env$|\.db$'` prints
nothing. `.env`, the local database, and the client's Fresha video are all
gitignored.

### Portfolio repo + a different Vercel account

These are independent, so **yes, this works**: the code lives on
`vectorshift69` (the VectorShift business account) while the Vercel project sits
under the VectorShift account. When you connect the project, Vercel asks to
install its GitHub App — install it on the `vectorshift69` account and grant
access to the `Dastaan` repo. Vercel then builds from that repo regardless
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

- **New Project** → import `vectorshift69/Dastaan`
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

1. Render → **New** → **Blueprint**, pick the `vectorshift69/Dastaan` repo.
   It reads `dastaan-api/render.yaml`.
2. Set the secrets it asks for: `DATABASE_URL` (Supabase), `CODE_PEPPER`,
   `WEB_ORIGINS` (your Vercel URL), `REVIEW_URL`, `GOOGLE_REVIEW_URL`.

   > **It won't ask for `JWT_SECRET` — that's correct, not a bug.** In
   > `render.yaml` that one is `generateValue: true`, so Render mints a
   > strong random value itself and never shows a field for it. It only
   > signs session cookies, so it never needs to leave Render. The ones it
   > *does* prompt for are marked `sync: false`, because only you know them.
   > Never repurpose another variable's slot for it — you'd lose that
   > variable and gain a duplicate secret. To see or rotate the generated
   > value: service → **Environment**.
   >
   > **`CODE_PEPPER` must match your local `.env` exactly.** It peppers the
   > HMAC of the 4-digit staff codes, and (see step 3) the seed runs from
   > your machine — a code hashed with a different pepper will never verify
   > on the server. Changing it later invalidates every existing staff code.
   >
   > `GOOGLE_REVIEW_URL` is the salon's "write a review" link from its
   > Google Business profile. A placeholder is fine for now; the app only
   > uses it on the thank-you screen after a 4- or 5-star rating.
3. Seed the database **from your machine**:

   ```bash
   cd dastaan-api        # .env already points DATABASE_URL at Supabase
   npm run seed          # first time
   npm run seed:reset    # clear and rebuild, any time after that
   ```

   Both run as a single transaction, so an interrupted run rolls back
   completely rather than leaving a half-built database behind. It writes
   ~1,500 rows over the pooler and prints a dot per day — give it a couple
   of minutes.

   > Render's Free instances have **no shell and no one-off jobs**, so
   > `npm run seed:built` on the server isn't an option until you're on a
   > paid instance. Seeding locally is equivalent — it's the same script
   > against the same Supabase database. `seed:built` exists for when you do
   > upgrade (on the server the TypeScript is compiled to `dist/`, so `tsx`
   > isn't available).
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

# Sign in with Google — clients only. Unset = feature off, button hidden.
GOOGLE_CLIENT_ID=<from Google Cloud console>
GOOGLE_CLIENT_SECRET=<from Google Cloud console>
GOOGLE_REDIRECT_URI=https://dastaan-api.onrender.com/auth/google/callback

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
