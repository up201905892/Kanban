-- CreateTable
CREATE TABLE "boards" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "boards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "columns" (
    "id" UUID NOT NULL,
    "board_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "position" TEXT COLLATE "C" NOT NULL,
    "is_done" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "columns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "boards_project_id_key" ON "boards"("project_id");

-- CreateIndex
CREATE INDEX "columns_board_id_position_id_idx" ON "columns"("board_id", "position", "id");

-- AddForeignKey
ALTER TABLE "boards" ADD CONSTRAINT "boards_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "columns" ADD CONSTRAINT "columns_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariants enforced by the database (G4): a column name has 1 to 50 characters and a board has at
-- most one Done column (the API swaps the flag inside one transaction, clearing the old one first).
ALTER TABLE "columns" ADD CONSTRAINT "columns_name_length_check" CHECK (char_length("name") BETWEEN 1 AND 50);

CREATE UNIQUE INDEX "columns_one_done_per_board" ON "columns"("board_id") WHERE "is_done";

-- Data migration: every existing project gets a board with the default columns (keys a0, a1, a2 are
-- what keysBetween(null, null, 3) produces).
INSERT INTO "boards" ("id", "project_id")
SELECT gen_random_uuid(), "id" FROM "projects";

INSERT INTO "columns" ("id", "board_id", "name", "position", "is_done")
SELECT gen_random_uuid(), b."id", d."name", d."position", d."is_done"
FROM "boards" b
CROSS JOIN (VALUES ('To do', 'a0', false), ('In progress', 'a1', false), ('Done', 'a2', true))
  AS d("name", "position", "is_done");
