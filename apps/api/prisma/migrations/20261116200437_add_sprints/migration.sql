-- CreateEnum
CREATE TYPE "sprint_status" AS ENUM ('planned', 'active', 'closed');

-- AlterTable
ALTER TABLE "cards" ADD COLUMN     "sprint_id" UUID;

-- CreateTable
CREATE TABLE "sprints" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT NOT NULL DEFAULT '',
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "sprint_status" NOT NULL DEFAULT 'planned',
    "committed_points" INTEGER,
    "completed_points" INTEGER,
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sprints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sprint_events" (
    "id" UUID NOT NULL,
    "sprint_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sprint_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sprints_project_id_start_date_id_idx" ON "sprints"("project_id", "start_date", "id");

-- CreateIndex
CREATE INDEX "sprint_events_sprint_id_created_at_idx" ON "sprint_events"("sprint_id", "created_at");

-- CreateIndex
CREATE INDEX "cards_sprint_id_idx" ON "cards"("sprint_id");

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_sprint_id_fkey" FOREIGN KEY ("sprint_id") REFERENCES "sprints"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_events" ADD CONSTRAINT "sprint_events_sprint_id_fkey" FOREIGN KEY ("sprint_id") REFERENCES "sprints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprint_events" ADD CONSTRAINT "sprint_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Invariants enforced by the database (G4).
-- A sprint cannot end before it starts.
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_dates_check" CHECK ("end_date" >= "start_date");

-- At most one active sprint per project, also under concurrent starts.
CREATE UNIQUE INDEX "sprints_one_active_per_project_idx" ON "sprints"("project_id") WHERE "status" = 'active';

-- Only a closed sprint has a closing time.
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_closed_check" CHECK (("status" = 'closed') = ("closed_at" IS NOT NULL));
