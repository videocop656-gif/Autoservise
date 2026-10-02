-- MCR-3 — Pricing & Business Location Foundation.
--
-- Purely additive: three new columns with safe defaults (NULL / false), so
-- every existing service keeps its current price meaning and no existing
-- business changes. Plus CHECK constraints that pin, at the database level,
-- the rules the API already validates (src/server/validation/*.schemas.ts):
--   * a price range never runs backwards and "priceTo" never exists alone
--     (canonical semantics in src/server/domain/pricing.ts) — every existing
--     row already satisfies it (verified before applying: 7 services, all
--     well-formed ranges);
--   * priceNote is short plain text;
--   * locationUrl is an http(s) link of reasonable length.
--
-- Hand-written (same approach as 20261003120000_missed_call_intake_foundation):
-- the shadow-database replay used by `prisma migrate dev` fails on a
-- pre-existing, unrelated migration-ordering defect (see final-report-44).
-- Applied with `npx prisma migrate deploy`.

-- AlterTable
ALTER TABLE "businesses" ADD COLUMN "locationUrl" TEXT;

-- AlterTable
ALTER TABLE "services" ADD COLUMN "priceNote" TEXT,
ADD COLUMN "requiresInspection" BOOLEAN NOT NULL DEFAULT false;

-- Pricing shape: FIXED (to = from), FROM (to NULL), RANGE (to > from) or no price.
ALTER TABLE "services" ADD CONSTRAINT "services_price_shape" CHECK (
  ("priceTo" IS NULL) OR ("priceFrom" IS NOT NULL AND "priceTo" >= "priceFrom")
);

ALTER TABLE "services" ADD CONSTRAINT "services_priceNote_length" CHECK ("priceNote" IS NULL OR char_length("priceNote") <= 300);

ALTER TABLE "businesses" ADD CONSTRAINT "businesses_locationUrl_format" CHECK (
  "locationUrl" IS NULL OR ("locationUrl" ~* '^https?://[^[:space:]]+$' AND char_length("locationUrl") <= 2000)
);
