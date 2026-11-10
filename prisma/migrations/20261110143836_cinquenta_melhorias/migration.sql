-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'moderador';

-- AlterTable
ALTER TABLE "AlertDispatch" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "nextRetryAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "competition" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "House" ADD COLUMN     "lastError" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "lastGoodAt" TIMESTAMP(3),
ADD COLUMN     "maxStakeCents" INTEGER NOT NULL DEFAULT 5000000,
ADD COLUMN     "minStakeCents" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "stakeStepCents" INTEGER NOT NULL DEFAULT 100;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "StakeLaunch" ADD COLUMN     "leftoverCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "result" TEXT NOT NULL DEFAULT 'pendente',
ADD COLUMN     "settledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "StakePreset" ADD COLUMN     "label" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "alertMinProfit" DECIMAL(7,3),
ADD COLUMN     "boardPrefs" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "supportStatus" TEXT NOT NULL DEFAULT 'aberto',
ADD COLUMN     "supportUnread" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "totpSecret" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "NameAlias" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NameAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordReset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailConfirm" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailConfirm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'fila',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedRun" (
    "id" TEXT NOT NULL,
    "houseSlug" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageTiming" (
    "id" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageTiming_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NameAlias_kind_source_key" ON "NameAlias"("kind", "source");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordReset_tokenHash_key" ON "PasswordReset"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "EmailConfirm_tokenHash_key" ON "EmailConfirm"("tokenHash");

-- CreateIndex
CREATE INDEX "MailMessage_createdAt_idx" ON "MailMessage"("createdAt");

-- CreateIndex
CREATE INDEX "FeedRun_createdAt_idx" ON "FeedRun"("createdAt");

-- CreateIndex
CREATE INDEX "PageTiming_createdAt_idx" ON "PageTiming"("createdAt");

-- CreateIndex
CREATE INDEX "AlertDispatch_status_nextRetryAt_idx" ON "AlertDispatch"("status", "nextRetryAt");

-- AddForeignKey
ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailConfirm" ADD CONSTRAINT "EmailConfirm_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailMessage" ADD CONSTRAINT "MailMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
