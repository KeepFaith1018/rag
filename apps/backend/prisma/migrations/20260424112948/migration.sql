-- AlterTable
ALTER TABLE `b_document_chunks` ADD COLUMN `char_end` INTEGER NULL,
    ADD COLUMN `char_start` INTEGER NULL,
    ADD COLUMN `metadata_json` JSON NULL,
    ADD COLUMN `page_no` INTEGER NULL,
    ADD COLUMN `vector_id` VARCHAR(100) NULL;

-- AlterTable
ALTER TABLE `b_documents` ADD COLUMN `last_reparse_at` DATETIME(3) NULL,
    ADD COLUMN `mime_type` VARCHAR(100) NULL,
    ADD COLUMN `original_filename` VARCHAR(255) NULL,
    ADD COLUMN `parse_finished_at` DATETIME(3) NULL,
    ADD COLUMN `parse_started_at` DATETIME(3) NULL,
    ADD COLUMN `uploader_id` BIGINT NULL;

-- AlterTable
ALTER TABLE `b_kb_invitations` ADD COLUMN `accepted_at` DATETIME(3) NULL,
    ADD COLUMN `accepted_by` BIGINT NULL,
    ADD COLUMN `cancelled_at` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `b_knowledge_bases` ADD COLUMN `allow_public_download` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `is_public` BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX `idx_chunk_vector_id` ON `b_document_chunks`(`vector_id`);

-- CreateIndex
CREATE INDEX `idx_invite_status_lookup` ON `b_kb_invitations`(`kb_id`, `is_used`, `expired_at`);

-- CreateIndex
CREATE INDEX `idx_kb_visibility_status` ON `b_knowledge_bases`(`visibility`, `status`);

-- CreateIndex
CREATE INDEX `idx_kb_visibility_public` ON `b_knowledge_bases`(`visibility`, `is_public`);
