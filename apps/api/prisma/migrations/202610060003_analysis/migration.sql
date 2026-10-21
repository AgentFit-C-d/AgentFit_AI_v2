-- CreateEnum
CREATE TYPE "AnalysisStatus" AS ENUM ('QUEUED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "UploadState" AS ENUM ('GRANTED', 'UPLOADING', 'READY', 'CLAIMED', 'DELETED');

-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('upstage', 'nvidia');

-- CreateEnum
CREATE TYPE "InputStorage" AS ENUM ('local', 'vercel');

-- CreateEnum
CREATE TYPE "InputKind" AS ENUM ('pdf', 'markdown', 'text');

-- CreateEnum
CREATE TYPE "JobKind" AS ENUM ('analyze', 'expire', 'cleanup');

-- AlterTable
ALTER TABLE "Draft" ADD COLUMN     "attemptId" TEXT;

-- CreateTable
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "projectId" TEXT,
    "objectKey" TEXT NOT NULL,
    "storage" "InputStorage" NOT NULL,
    "kind" "InputKind" NOT NULL,
    "size" INTEGER NOT NULL,
    "contentType" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "state" "UploadState" NOT NULL DEFAULT 'GRANTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisAttempt" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "status" "AnalysisStatus" NOT NULL DEFAULT 'QUEUED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadline" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "leaseId" TEXT,

    CONSTRAINT "AnalysisAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobOutbox" (
    "id" TEXT NOT NULL,
    "kind" "JobKind" NOT NULL,
    "targetId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetCounter" (
    "id" TEXT NOT NULL,
    "spentMicroUsd" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BudgetCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetLedger" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "pages" INTEGER NOT NULL,
    "amountMicroUsd" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BudgetLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Upload_objectKey_key" ON "Upload"("objectKey");

-- CreateIndex
CREATE INDEX "Upload_ownerId_projectId_idx" ON "Upload"("ownerId", "projectId");

-- CreateIndex
CREATE INDEX "Upload_expiresAt_idx" ON "Upload"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisAttempt_uploadId_key" ON "AnalysisAttempt"("uploadId");

-- CreateIndex
CREATE INDEX "AnalysisAttempt_ownerId_status_deadline_idx" ON "AnalysisAttempt"("ownerId", "status", "deadline");

-- CreateIndex
CREATE INDEX "AnalysisAttempt_projectId_status_idx" ON "AnalysisAttempt"("projectId", "status");

-- CreateIndex
CREATE INDEX "JobOutbox_completedAt_dueAt_idx" ON "JobOutbox"("completedAt", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetLedger_attemptId_key" ON "BudgetLedger"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "Draft_attemptId_key" ON "Draft"("attemptId");

-- AddForeignKey
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "AnalysisAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisAttempt" ADD CONSTRAINT "AnalysisAttempt_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisAttempt" ADD CONSTRAINT "AnalysisAttempt_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLedger" ADD CONSTRAINT "BudgetLedger_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "AnalysisAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;
