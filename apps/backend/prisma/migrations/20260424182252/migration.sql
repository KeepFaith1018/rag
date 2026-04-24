-- AlterTable
ALTER TABLE `b_documents` ADD COLUMN `current_stage` VARCHAR(50) NOT NULL DEFAULT 'uploaded',
    ADD COLUMN `last_error_code` VARCHAR(100) NULL,
    ADD COLUMN `last_error_stage` VARCHAR(50) NULL,
    ADD COLUMN `processing_version` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `retry_count` INTEGER NOT NULL DEFAULT 0;
