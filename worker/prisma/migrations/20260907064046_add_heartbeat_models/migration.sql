-- CreateEnum
CREATE TYPE "HeartbeatStatus" AS ENUM ('PENDING', 'UP', 'DOWN');

-- CreateTable
CREATE TABLE "HeartbeatMonitor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "expectedIntervalSeconds" INTEGER NOT NULL,
    "gracePeriodSeconds" INTEGER NOT NULL,
    "lastPingAt" TIMESTAMP(3),
    "status" "HeartbeatStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HeartbeatMonitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HeartbeatCheck" (
    "id" TEXT NOT NULL,
    "heartbeatMonitorId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "HeartbeatStatus" NOT NULL,

    CONSTRAINT "HeartbeatCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HeartbeatMonitor_slug_key" ON "HeartbeatMonitor"("slug");

-- AddForeignKey
ALTER TABLE "HeartbeatMonitor" ADD CONSTRAINT "HeartbeatMonitor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HeartbeatCheck" ADD CONSTRAINT "HeartbeatCheck_heartbeatMonitorId_fkey" FOREIGN KEY ("heartbeatMonitorId") REFERENCES "HeartbeatMonitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
