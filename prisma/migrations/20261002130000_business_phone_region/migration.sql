-- MCR-1 — Phone Identity Foundation: the business's default phone region.
--
-- Purely additive: one NOT NULL column with a constant default on
-- "businesses" (metadata-only on PostgreSQL 11+, no row rewritten). "KZ" is
-- the explicit product default (launch market). Used only to read phone
-- numbers written without "+"; see src/server/lib/phone.ts.
--
-- Hand-written (same approach as 20260930120000_add_business_service_capacity):
-- the shadow-database replay used by `prisma migrate dev` fails on a
-- pre-existing, unrelated migration-ordering defect (see final-report-44).
-- Applied with `npx prisma migrate deploy`.

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN "phoneRegion" TEXT NOT NULL DEFAULT 'KZ';

-- An ISO 3166-1 alpha-2 shape; business.schemas.ts additionally checks the
-- code is a region libphonenumber supports.
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_phoneRegion_format" CHECK ("phoneRegion" ~ '^[A-Z]{2}$');
