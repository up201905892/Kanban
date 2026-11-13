-- CreateEnum
CREATE TYPE "card_priority" AS ENUM ('none', 'low', 'medium', 'high', 'urgent');

-- AlterTable
ALTER TABLE "cards" ADD COLUMN     "assignee_id" UUID,
ADD COLUMN     "estimate" INTEGER,
ADD COLUMN     "priority" "card_priority" NOT NULL DEFAULT 'none';

-- CreateIndex
CREATE INDEX "cards_assignee_id_idx" ON "cards"("assignee_id");

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Invariant enforced by the database (G4): story points from 0 to 100, or not estimated.
ALTER TABLE "cards" ADD CONSTRAINT "cards_estimate_range_check" CHECK ("estimate" IS NULL OR "estimate" BETWEEN 0 AND 100);
