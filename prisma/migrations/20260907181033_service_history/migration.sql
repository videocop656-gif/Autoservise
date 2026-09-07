-- CreateTable
CREATE TABLE "service_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "performedAt" TIMESTAMP(3) NOT NULL,
    "mileage" INTEGER,
    "totalPrice" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "workDescription" TEXT NOT NULL,
    "partsDescription" TEXT,
    "recommendations" TEXT,
    "notes" TEXT,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_records_tenantId_businessId_idx" ON "service_records"("tenantId", "businessId");

-- CreateIndex
CREATE INDEX "service_records_tenantId_businessId_performedAt_idx" ON "service_records"("tenantId", "businessId", "performedAt");

-- CreateIndex
CREATE INDEX "service_records_tenantId_businessId_isArchived_idx" ON "service_records"("tenantId", "businessId", "isArchived");

-- CreateIndex
CREATE INDEX "service_records_vehicleId_performedAt_idx" ON "service_records"("vehicleId", "performedAt");

-- CreateIndex
CREATE INDEX "service_records_customerId_performedAt_idx" ON "service_records"("customerId", "performedAt");

-- CreateIndex
CREATE INDEX "service_records_serviceId_performedAt_idx" ON "service_records"("serviceId", "performedAt");

-- CreateIndex
CREATE INDEX "service_records_appointmentId_idx" ON "service_records"("appointmentId");

-- AddForeignKey
ALTER TABLE "service_records" ADD CONSTRAINT "service_records_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_records" ADD CONSTRAINT "service_records_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_records" ADD CONSTRAINT "service_records_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_records" ADD CONSTRAINT "service_records_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_records" ADD CONSTRAINT "service_records_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_records" ADD CONSTRAINT "service_records_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
