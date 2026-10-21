-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JobKind" ADD VALUE 'purge';
ALTER TYPE "JobKind" ADD VALUE 'delete';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "deletingAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "FailureDiagnostic" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "authTag" BYTEA NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FailureDiagnostic_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FailureDiagnostic_attemptId_key" ON "FailureDiagnostic"("attemptId");

-- CreateIndex
CREATE INDEX "FailureDiagnostic_expiresAt_idx" ON "FailureDiagnostic"("expiresAt");

-- AddForeignKey
ALTER TABLE "FailureDiagnostic" ADD CONSTRAINT "FailureDiagnostic_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "AnalysisAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
