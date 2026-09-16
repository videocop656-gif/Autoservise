-- Prompt 44 — Lead vs CustomerRequest Domain Consolidation.
--
-- Retires the `Lead` model. It was the original pre-Prompt-07 "customer
-- inquiry" concept (added in Prompt 04); `CustomerRequest` (Prompt 07) was
-- purpose-built to supersede it as the sole intake entity a future AI
-- administrator works through — richer status lifecycle, a full
-- CustomerRequestStatusHistory audit trail, and direct Appointment
-- conversion. `Lead` was never wired into any later feature (Conversations,
-- Operations, Dashboard/analytics, AI tools) and held zero rows in the live
-- database at the time of this migration (verified before writing this
-- file) — safe to drop outright, no data migration required.
--
-- DropForeignKey
ALTER TABLE "leads" DROP CONSTRAINT "leads_tenantId_fkey";
ALTER TABLE "leads" DROP CONSTRAINT "leads_businessId_fkey";
ALTER TABLE "leads" DROP CONSTRAINT "leads_customerId_fkey";
ALTER TABLE "leads" DROP CONSTRAINT "leads_vehicleId_fkey";
ALTER TABLE "leads" DROP CONSTRAINT "leads_serviceId_fkey";

-- DropTable
DROP TABLE "leads";

-- DropEnum
DROP TYPE "LeadStatus";

-- DropEnum
DROP TYPE "LeadSource";
