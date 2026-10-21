CREATE TABLE "Draft" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Draft_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ProfileAudit" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "draftId" TEXT,
  "decisions" JSONB NOT NULL,
  "confirmedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProfileAudit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Draft_projectId_createdAt_idx" ON "Draft"("projectId", "createdAt");
CREATE UNIQUE INDEX "ProfileAudit_projectId_version_key" ON "ProfileAudit"("projectId", "version");
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProfileAudit" ADD CONSTRAINT "ProfileAudit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
