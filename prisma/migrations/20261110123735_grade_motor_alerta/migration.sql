-- AlterTable
ALTER TABLE "House" ADD COLUMN     "cloneLabel" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "feed" TEXT NOT NULL DEFAULT 'fixture',
ADD COLUMN     "operable" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "houseId" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "odd" DECIMAL(8,3) NOT NULL,
    "phase" "EventPhase" NOT NULL DEFAULT 'prelive',
    "source" TEXT NOT NULL DEFAULT 'fixture',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StakeLaunch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "signalKey" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "profitCents" INTEGER NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StakeLaunch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'aberto',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertDispatch" (
    "id" TEXT NOT NULL,
    "signalKey" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Quote_phase_idx" ON "Quote"("phase");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_eventId_houseId_market_side_key" ON "Quote"("eventId", "houseId", "market", "side");

-- CreateIndex
CREATE UNIQUE INDEX "StakeLaunch_userId_signalKey_key" ON "StakeLaunch"("userId", "signalKey");

-- CreateIndex
CREATE INDEX "SupportTicket_status_idx" ON "SupportTicket"("status");

-- CreateIndex
CREATE UNIQUE INDEX "AlertDispatch_signalKey_channel_key" ON "AlertDispatch"("signalKey", "channel");

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_houseId_fkey" FOREIGN KEY ("houseId") REFERENCES "House"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StakeLaunch" ADD CONSTRAINT "StakeLaunch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
