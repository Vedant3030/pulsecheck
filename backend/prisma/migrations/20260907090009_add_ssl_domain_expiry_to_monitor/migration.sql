-- CreateEnum
CREATE TYPE "ExpiryAlertStage" AS ENUM ('NONE', 'WARNED_30D', 'WARNED_14D', 'WARNED_7D', 'EXPIRED');

-- AlterTable
ALTER TABLE "Monitor" ADD COLUMN     "certExpiresAt" TIMESTAMP(3),
ADD COLUMN     "domainAlertStage" "ExpiryAlertStage" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "domainExpiresAt" TIMESTAMP(3),
ADD COLUMN     "domainMonitoringEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastDomainCheckAt" TIMESTAMP(3),
ADD COLUMN     "lastSslCheckAt" TIMESTAMP(3),
ADD COLUMN     "sslAlertStage" "ExpiryAlertStage" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "sslMonitoringEnabled" BOOLEAN NOT NULL DEFAULT false;
