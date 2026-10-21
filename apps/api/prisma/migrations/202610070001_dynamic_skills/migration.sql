ALTER TYPE "JobKind" ADD VALUE 'discover';
ALTER TYPE "JobKind" ADD VALUE 'discover_expire';
CREATE TABLE "SkillDiscovery" (
  "id" TEXT NOT NULL, "projectId" TEXT NOT NULL, "basis" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED', "result" JSONB NOT NULL,
  "leaseId" TEXT, "errorCode" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deadline" TIMESTAMP(3) NOT NULL, "finishedAt" TIMESTAMP(3),
  CONSTRAINT "SkillDiscovery_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SkillDiscovery_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "SkillDiscovery_projectId_createdAt_idx" ON "SkillDiscovery"("projectId", "createdAt");
CREATE INDEX "SkillDiscovery_status_deadline_idx" ON "SkillDiscovery"("status", "deadline");
CREATE TABLE "SkillArtifact" (
  "id" TEXT NOT NULL, "package" JSONB NOT NULL, "checkedAt" TIMESTAMP(3) NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SkillArtifact_pkey" PRIMARY KEY ("id")
);
