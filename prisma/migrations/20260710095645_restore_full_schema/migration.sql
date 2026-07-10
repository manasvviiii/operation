/*
  Warnings:

  - You are about to drop the column `updatedAt` on the `Vendor` table. All the data in the column will be lost.
  - The `status` column on the `Vendor` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `state` column on the `Workflow` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - A unique constraint covering the columns `[taxId]` on the table `Vendor` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "VendorStatus" AS ENUM ('PROSPECT', 'ACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "WorkflowState" AS ENUM ('INITIATED', 'AWAITING_GST', 'AWAITING_PAN', 'AWAITING_BANK', 'VALIDATING', 'PENDING_APPROVAL', 'WRITING_ERP', 'COMPLETED', 'FAILED', 'CANCELLED', 'PAUSED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- DropForeignKey
ALTER TABLE "Workflow" DROP CONSTRAINT "Workflow_vendorId_fkey";

-- AlterTable
ALTER TABLE "Vendor" DROP COLUMN "updatedAt",
ADD COLUMN     "taxId" TEXT,
ALTER COLUMN "contactEmail" DROP NOT NULL,
DROP COLUMN "status",
ADD COLUMN     "status" "VendorStatus" NOT NULL DEFAULT 'PROSPECT';

-- AlterTable
ALTER TABLE "Workflow" ADD COLUMN     "chatId" TEXT,
DROP COLUMN "state",
ADD COLUMN     "state" "WorkflowState" NOT NULL DEFAULT 'INITIATED',
ALTER COLUMN "primaryChannel" SET DEFAULT 'telegram';

-- CreateTable
CREATE TABLE "Execution" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "triggerSource" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "error" TEXT,
    "errorMessage" TEXT,

    CONSTRAINT "Execution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'done',
    "input" JSONB NOT NULL,
    "output" JSONB,
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "connectorId" TEXT,
    "direction" "MessageDirection" NOT NULL DEFAULT 'INBOUND',
    "role" TEXT NOT NULL DEFAULT 'user',
    "channel" TEXT NOT NULL DEFAULT 'telegram',
    "senderId" TEXT,
    "content" TEXT NOT NULL,
    "attachments" JSONB,
    "externalMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "decision" "ApprovalDecision" NOT NULL DEFAULT 'PENDING',
    "decidedBy" TEXT,
    "reason" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromState" TEXT,
    "toState" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "storageUrl" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Message_externalMessageId_key" ON "Message"("externalMessageId");

-- CreateIndex
CREATE INDEX "Message_workflowId_channel_createdAt_idx" ON "Message"("workflowId", "channel", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Vendor_taxId_key" ON "Vendor"("taxId");

-- AddForeignKey
ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Execution" ADD CONSTRAINT "Execution_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "Execution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
