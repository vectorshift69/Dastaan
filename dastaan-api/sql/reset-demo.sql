-- ------------------------------------------------------------------
-- Wipe the demo database so `npm run seed` can build it again.
--
-- YOU PROBABLY DON'T NEED THIS. `npm run seed:reset` clears and rebuilds
-- in one atomic transaction, which is safer — if it fails halfway, the
-- wipe rolls back too. Keep this file for the case where the schema
-- itself has changed and the tables need dropping, not just emptying.
--
-- Run in Supabase → SQL Editor, then run `npm run seed`.
--
-- This drops every table the app owns, in dependency order. It does NOT
-- touch anything else in the database. Obviously: never run this against
-- a database that holds the salon's real bookings.
-- ------------------------------------------------------------------

DROP TABLE IF EXISTS points_transactions   CASCADE;
DROP TABLE IF EXISTS loyalty_accounts      CASCADE;
DROP TABLE IF EXISTS day_snapshots         CASCADE;
DROP TABLE IF EXISTS reviews               CASCADE;
DROP TABLE IF EXISTS orders                CASCADE;
DROP TABLE IF EXISTS coupon_redemptions    CASCADE;
DROP TABLE IF EXISTS coupons               CASCADE;
DROP TABLE IF EXISTS stock_movements       CASCADE;
DROP TABLE IF EXISTS stock_levels          CASCADE;
DROP TABLE IF EXISTS products              CASCADE;
DROP TABLE IF EXISTS invoices              CASCADE;
DROP TABLE IF EXISTS notifications         CASCADE;
DROP TABLE IF EXISTS booking_events        CASCADE;
DROP TABLE IF EXISTS bookings              CASCADE;
DROP TABLE IF EXISTS login_attempts        CASCADE;
DROP TABLE IF EXISTS audit_log             CASCADE;
DROP TABLE IF EXISTS counters              CASCADE;
DROP TABLE IF EXISTS users                 CASCADE;
DROP TABLE IF EXISTS services              CASCADE;
DROP TABLE IF EXISTS branches              CASCADE;

-- Confirm nothing of ours is left:
--   SELECT tablename FROM pg_tables WHERE schemaname = 'public';
