-- CreateTable
CREATE TABLE "labels" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_labels" (
    "card_id" UUID NOT NULL,
    "label_id" UUID NOT NULL,

    CONSTRAINT "card_labels_pkey" PRIMARY KEY ("card_id","label_id")
);

-- Hand-written (Prisma cannot express them): the name is unique per project without regard to case,
-- 1 to 30 characters, and the colour is one of the 8 palette tokens.
CREATE UNIQUE INDEX "labels_project_id_lower_name_key" ON "labels"("project_id", lower("name"));
ALTER TABLE "labels" ADD CONSTRAINT "labels_name_length_check" CHECK (char_length("name") BETWEEN 1 AND 30);
ALTER TABLE "labels" ADD CONSTRAINT "labels_color_check"
  CHECK ("color" IN ('red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'gray'));

-- CreateIndex
CREATE INDEX "labels_project_id_idx" ON "labels"("project_id");

-- CreateIndex
CREATE INDEX "card_labels_label_id_idx" ON "card_labels"("label_id");

-- AddForeignKey
ALTER TABLE "labels" ADD CONSTRAINT "labels_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_labels" ADD CONSTRAINT "card_labels_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_labels" ADD CONSTRAINT "card_labels_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;
