-- CreateEnum
CREATE TYPE "KnowledgeCategory" AS ENUM ('FAQ', 'SERVICE_INFO', 'POLICY', 'WARRANTY', 'PAYMENT', 'PREPARATION', 'GENERAL');

-- CreateEnum
CREATE TYPE "BusinessRuleCategory" AS ENUM ('APPOINTMENT', 'SERVICE', 'PAYMENT', 'WARRANTY', 'CUSTOMER', 'OPERATIONS', 'GENERAL');

-- CreateTable
CREATE TABLE "knowledge_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" "KnowledgeCategory" NOT NULL DEFAULT 'GENERAL',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_rules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "BusinessRuleCategory" NOT NULL DEFAULT 'GENERAL',
    "priority" INTEGER NOT NULL DEFAULT 50,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_items_tenantId_businessId_idx" ON "knowledge_items"("tenantId", "businessId");

-- CreateIndex
CREATE INDEX "knowledge_items_tenantId_businessId_isActive_idx" ON "knowledge_items"("tenantId", "businessId", "isActive");

-- CreateIndex
CREATE INDEX "knowledge_items_tenantId_businessId_category_idx" ON "knowledge_items"("tenantId", "businessId", "category");

-- CreateIndex
CREATE INDEX "business_rules_tenantId_businessId_idx" ON "business_rules"("tenantId", "businessId");

-- CreateIndex
CREATE INDEX "business_rules_tenantId_businessId_isActive_idx" ON "business_rules"("tenantId", "businessId", "isActive");

-- CreateIndex
CREATE INDEX "business_rules_tenantId_businessId_category_idx" ON "business_rules"("tenantId", "businessId", "category");

-- CreateIndex
CREATE INDEX "business_rules_tenantId_businessId_priority_idx" ON "business_rules"("tenantId", "businessId", "priority");

-- AddForeignKey
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_rules" ADD CONSTRAINT "business_rules_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_rules" ADD CONSTRAINT "business_rules_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
