-- CreateEnum
CREATE TYPE "AssertionType" AS ENUM ('STATUS_CODE', 'RESPONSE_TIME', 'BODY_CONTAINS', 'JSON_FIELD_EQUALS');

-- CreateEnum
CREATE TYPE "AssertionOperator" AS ENUM ('EQUALS', 'CONTAINS', 'LESS_THAN', 'GREATER_THAN');

-- AlterTable
ALTER TABLE "CheckResult" ADD COLUMN     "assertionResults" JSONB;

-- CreateTable
CREATE TABLE "MonitorAssertion" (
    "id" TEXT NOT NULL,
    "monitorId" TEXT NOT NULL,
    "type" "AssertionType" NOT NULL,
    "field" TEXT,
    "operator" "AssertionOperator" NOT NULL,
    "expectedValue" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonitorAssertion_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "MonitorAssertion" ADD CONSTRAINT "MonitorAssertion_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
