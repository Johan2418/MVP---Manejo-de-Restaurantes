-- AlterTable
ALTER TABLE "restaurants" ADD COLUMN     "reminderHoursBefore" INTEGER NOT NULL DEFAULT 2;

-- AlterTable
ALTER TABLE "reservations" ADD COLUMN     "reminderSentAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "messages_providerSid_key" ON "messages"("providerSid");

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outbox_events_status_createdAt_idx" ON "outbox_events"("status", "createdAt");
