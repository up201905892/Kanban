-- CreateTable
CREATE TABLE "y_documents" (
    "name" TEXT NOT NULL,
    "snapshot" BYTEA NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "y_documents_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "y_document_updates" (
    "id" BIGSERIAL NOT NULL,
    "doc_name" TEXT NOT NULL,
    "update" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "y_document_updates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "y_document_updates_doc_name_id_idx" ON "y_document_updates"("doc_name", "id");

-- AddForeignKey
ALTER TABLE "y_document_updates" ADD CONSTRAINT "y_document_updates_doc_name_fkey" FOREIGN KEY ("doc_name") REFERENCES "y_documents"("name") ON DELETE CASCADE ON UPDATE CASCADE;
