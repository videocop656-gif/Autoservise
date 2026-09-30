-- Prompt 50 — Service Capacity & Available Slots Foundation.
--
-- Purely additive and backward-compatible: one new NOT NULL column with a
-- constant default on "businesses". Every existing business gets 1 (one
-- vehicle at a time); on PostgreSQL 11+ this is a metadata-only change — no
-- table rewrite, no row touched. No existing appointment is changed: the
-- capacity rule applies to new bookings and reschedules only.
--
-- Hand-written (same approach as 20260929120000_service_follow_up_retention_loop):
-- the shadow-database replay used by `prisma migrate dev` fails on a
-- pre-existing, unrelated migration-ordering defect (see final-report-44).
-- Applied with `npx prisma migrate deploy`.

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN "serviceBayCapacity" INTEGER NOT NULL DEFAULT 1;

-- At least one post. Mirrors business.schemas.ts so a bad value can never
-- reach the table through any other path.
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_serviceBayCapacity_positive" CHECK ("serviceBayCapacity" >= 1);
