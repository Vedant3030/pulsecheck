-- AlterTable: chain monitor type (defaults to "single"; existing rows unchanged)
ALTER TABLE "Monitor" ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'single';

-- CreateTable
CREATE TABLE "MonitorStep" (
    "id" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'GET',
    "url" TEXT NOT NULL,
    "requestBody" TEXT,
    "requestHeaders" JSONB,
    "authType" TEXT,
    "authHeaderName" TEXT,
    "encryptedAuthValue" TEXT,
    "extracts" JSONB,

    CONSTRAINT "MonitorStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MonitorStep_monitorId_order_key" ON "MonitorStep"("monitorId", "order");
CREATE INDEX "MonitorStep_monitorId_idx" ON "MonitorStep"("monitorId");

-- AlterTable: nullable per-step link on assertions
ALTER TABLE "MonitorAssertion" ADD COLUMN     "stepId" TEXT;

-- AddForeignKey
ALTER TABLE "MonitorStep" ADD CONSTRAINT "MonitorStep_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MonitorAssertion" ADD CONSTRAINT "MonitorAssertion_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "MonitorStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: per-step results on checks
ALTER TABLE "CheckResult" ADD COLUMN     "stepResults" JSONB;
