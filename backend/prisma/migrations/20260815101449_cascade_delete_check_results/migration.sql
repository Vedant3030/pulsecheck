-- DropForeignKey
ALTER TABLE "CheckResult" DROP CONSTRAINT "CheckResult_monitorId_fkey";

-- AddForeignKey
ALTER TABLE "CheckResult" ADD CONSTRAINT "CheckResult_monitorId_fkey" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
