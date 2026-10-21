ALTER TYPE "Provider" ADD VALUE 'solar';
CREATE TABLE "SolarBudgetReservation" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "inputBytes" INTEGER NOT NULL,
  "outputTokens" INTEGER NOT NULL,
  "amountMicroUsd" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SolarBudgetReservation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SolarBudgetReservation_projectId_idx" ON "SolarBudgetReservation"("projectId");
ALTER TABLE "SolarBudgetReservation" ADD CONSTRAINT "SolarBudgetReservation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
