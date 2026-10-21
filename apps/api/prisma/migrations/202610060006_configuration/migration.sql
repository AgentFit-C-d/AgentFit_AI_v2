CREATE TABLE "ConfigPreview" (
 "id" TEXT PRIMARY KEY, "projectId" TEXT NOT NULL, "metadata" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ConfigPreview_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ConfigPreview_projectId_createdAt_idx" ON "ConfigPreview"("projectId", "createdAt");
CREATE TABLE "ConfigApproval" (
 "id" TEXT PRIMARY KEY, "projectId" TEXT NOT NULL, "previewId" TEXT NOT NULL, "fingerprint" TEXT NOT NULL,
 "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ConfigApproval_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ConfigApproval_projectId_previewId_idx" ON "ConfigApproval"("projectId", "previewId");
CREATE TABLE "Configuration" (
 "id" TEXT PRIMARY KEY, "projectId" TEXT NOT NULL, "metadata" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "Configuration_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Configuration_projectId_createdAt_id_idx" ON "Configuration"("projectId", "createdAt", "id");
CREATE TABLE "ConfigurationReport" (
 "id" TEXT PRIMARY KEY, "projectId" TEXT NOT NULL, "configurationId" TEXT NOT NULL, "reportedState" TEXT NOT NULL, "reasonCode" TEXT,
 "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ConfigurationReport_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "ConfigurationReport_configurationId_fkey" FOREIGN KEY ("configurationId") REFERENCES "Configuration"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ConfigurationReport_configurationId_reportedAt_idx" ON "ConfigurationReport"("configurationId", "reportedAt");
