#!/bin/bash
cd "$(dirname "$0")"

# Remove stale git lock file if it exists
rm -f .git/index.lock

# Stage all changes
git add -A

# Commit
git commit -m "fix: auth nav state, returnTo redirect, past time slots, booking deep-links

- Nav shows avatar/dropdown with My Bookings, My Orders, Log out when signed in
- Login uses returnTo param (backward-compatible with next); default redirect to /
- Google OAuth also supports returnTo param
- Booking wizard filters past time slots for today
- Booking wizard clears stale confirmed/past sessionStorage draft on mount
- Booking wizard reads ?branchId and ?serviceId URL params to pre-select
- /admin and /admin/orders pages scaffolded with role-based auth guard
- CartDrawer: useEffect added for address pre-fill, scrollable Stripe form
- CartDrawer: PAY NOW address threshold lowered to 5 chars
- Cart button moved to bottom-left to avoid Stripe dev badge
- Store product images via placehold.co fallback; image_url passed through cart
- Booking status set to Confirmed (not Started) after payment
- Nearest branch badge using Haversine formula in Step 1
- Branch coordinates added to data.ts"

# Push
git push origin main

echo ""
echo "Done! All fixes pushed to main."
