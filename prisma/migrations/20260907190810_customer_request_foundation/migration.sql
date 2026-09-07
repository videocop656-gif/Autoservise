-- CreateEnum
CREATE TYPE "CustomerRequestSource" AS ENUM ('PHONE', 'WEBSITE', 'MANUAL', 'OTHER');

-- CreateEnum
CREATE TYPE "CustomerRequestStatus" AS ENUM ('NEW', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'QUALIFIED', 'CONVERTED', 'CLOSED', 'CANCELLED');

-- CreateTable
CREATE TABLE "customer_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "serviceId" TEXT,
    "appointmentId" TEXT,
    "source" "CustomerRequestSource" NOT NULL DEFAULT 'MANUAL',
    "status" "CustomerRequestStatus" NOT NULL DEFAULT 'NEW',
    "subject" TEXT NOT NULL,
    "description" TEXT,
    "requestedDate" TIMESTAMP(3),
    "requestedTimeFrom" TEXT,
    "requestedTimeTo" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_request_status_history" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerRequestId" TEXT NOT NULL,
    "fromStatus" "CustomerRequestStatus",
    "toStatus" "CustomerRequestStatus" NOT NULL,
    "changedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_request_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_requests_tenantId_businessId_idx" ON "customer_requests"("tenantId", "businessId");

-- CreateIndex
CREATE INDEX "customer_requests_tenantId_businessId_status_idx" ON "customer_requests"("tenantId", "businessId", "status");

-- CreateIndex
CREATE INDEX "customer_requests_tenantId_businessId_createdAt_idx" ON "customer_requests"("tenantId", "businessId", "createdAt");

-- CreateIndex
CREATE INDEX "customer_requests_customerId_createdAt_idx" ON "customer_requests"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "customer_requests_vehicleId_createdAt_idx" ON "customer_requests"("vehicleId", "createdAt");

-- CreateIndex
CREATE INDEX "customer_requests_appointmentId_idx" ON "customer_requests"("appointmentId");

-- CreateIndex
CREATE INDEX "customer_request_status_history_tenantId_businessId_custome_idx" ON "customer_request_status_history"("tenantId", "businessId", "customerRequestId", "createdAt");

-- CreateIndex
CREATE INDEX "customer_request_status_history_customerRequestId_createdAt_idx" ON "customer_request_status_history"("customerRequestId", "createdAt");

-- AddForeignKey
ALTER TABLE "customer_requests" ADD CONSTRAINT "customer_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_requests" ADD CONSTRAINT "customer_requests_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_requests" ADD CONSTRAINT "customer_requests_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_requests" ADD CONSTRAINT "customer_requests_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_requests" ADD CONSTRAINT "customer_requests_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_requests" ADD CONSTRAINT "customer_requests_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_request_status_history" ADD CONSTRAINT "customer_request_status_history_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_request_status_history" ADD CONSTRAINT "customer_request_status_history_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_request_status_history" ADD CONSTRAINT "customer_request_status_history_customerRequestId_fkey" FOREIGN KEY ("customerRequestId") REFERENCES "customer_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_request_status_history" ADD CONSTRAINT "customer_request_status_history_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
