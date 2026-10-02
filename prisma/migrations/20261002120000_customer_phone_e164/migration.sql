-- MCR-1 — Phone Identity Foundation: the customer's canonical phone.
--
-- Purely additive: one nullable column + one non-unique, tenant/business-
-- scoped index on "customers". Customer.phone (as entered) is untouched.
-- Deliberately NOT unique: families share numbers, legacy duplicates exist,
-- and one person can be a customer of several businesses.
--
-- No SQL normalization here: phone parsing (libphonenumber, per-business
-- default region) is application code. The column is filled by the explicit,
-- idempotent backfill `npm run backfill:customer-phones`
-- (prisma/backfill-customer-phones.ts), run after `prisma migrate deploy`;
-- afterwards customerService keeps it current on every create/phone change.
-- Until the backfill runs, phoneE164 is NULL and phone lookups simply find no
-- match (never a wrong one).
--
-- Hand-written (same approach as 20260930120000_add_business_service_capacity):
-- the shadow-database replay used by `prisma migrate dev` fails on a
-- pre-existing, unrelated migration-ordering defect (see final-report-44).
-- Applied with `npx prisma migrate deploy`.

-- AlterTable
ALTER TABLE "customers" ADD COLUMN "phoneE164" TEXT;

-- CreateIndex
CREATE INDEX "customers_tenantId_businessId_phoneE164_idx" ON "customers"("tenantId", "businessId", "phoneE164");
