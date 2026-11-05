-- CreateTable
CREATE TABLE "cards" (
    "id" UUID NOT NULL,
    "board_id" UUID NOT NULL,
    "column_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "position" TEXT COLLATE "C" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_events" (
    "id" UUID NOT NULL,
    "card_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cards_column_id_position_id_idx" ON "cards"("column_id", "position", "id");

-- CreateIndex
CREATE UNIQUE INDEX "cards_board_id_number_key" ON "cards"("board_id", "number");

-- CreateIndex
CREATE INDEX "activity_events_card_id_created_at_idx" ON "activity_events"("card_id", "created_at");

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_column_id_fkey" FOREIGN KEY ("column_id") REFERENCES "columns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cards" ADD CONSTRAINT "cards_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Invariants enforced by the database (G4): title 1 to 200 characters, description at most 20,000,
-- a positive card number and version. `position` sorts by code unit (COLLATE "C", ADR 0001 section 1).
ALTER TABLE "cards" ADD CONSTRAINT "cards_title_length_check" CHECK (char_length("title") BETWEEN 1 AND 200);
ALTER TABLE "cards" ADD CONSTRAINT "cards_description_length_check" CHECK (char_length("description") <= 20000);
ALTER TABLE "cards" ADD CONSTRAINT "cards_number_positive_check" CHECK ("number" > 0);
ALTER TABLE "cards" ADD CONSTRAINT "cards_version_positive_check" CHECK ("version" > 0);
