/*
  Warnings:

  - Made the column `expectedReceiverAccount` on table `PaymentIntent` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "PaymentIntent" ADD COLUMN     "expectedReceiverName" TEXT,
ALTER COLUMN "expectedReceiverAccount" SET NOT NULL;
