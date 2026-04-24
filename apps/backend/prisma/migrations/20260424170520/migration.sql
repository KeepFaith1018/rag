-- CreateTable
CREATE TABLE `b_upload_sessions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `kb_id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,
    `document_id` BIGINT NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `title` VARCHAR(255) NULL,
    `file_size` BIGINT NOT NULL,
    `mime_type` VARCHAR(100) NULL,
    `file_hash` VARCHAR(64) NOT NULL,
    `file_extension` VARCHAR(20) NULL,
    `chunk_size` INTEGER NOT NULL,
    `total_chunks` INTEGER NOT NULL,
    `uploaded_count` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(50) NOT NULL DEFAULT 'init',
    `storage_type` VARCHAR(50) NOT NULL DEFAULT 'local',
    `temp_dir` VARCHAR(500) NOT NULL,
    `completed_at` DATETIME(3) NULL,
    `expired_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_upload_session_kb`(`kb_id`),
    INDEX `idx_upload_session_user`(`user_id`),
    INDEX `idx_upload_session_restore`(`kb_id`, `user_id`, `file_hash`),
    INDEX `idx_upload_session_document`(`document_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `b_upload_chunks` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `upload_id` BIGINT NOT NULL,
    `chunk_index` INTEGER NOT NULL,
    `chunk_size` INTEGER NOT NULL,
    `chunk_hash` VARCHAR(64) NULL,
    `storage_path` VARCHAR(500) NOT NULL,
    `status` VARCHAR(50) NOT NULL DEFAULT 'uploaded',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_upload_chunk_upload`(`upload_id`),
    UNIQUE INDEX `uk_upload_chunk`(`upload_id`, `chunk_index`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `b_upload_sessions` ADD CONSTRAINT `fk_upload_session_kb` FOREIGN KEY (`kb_id`) REFERENCES `b_knowledge_bases`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `b_upload_sessions` ADD CONSTRAINT `fk_upload_session_user` FOREIGN KEY (`user_id`) REFERENCES `b_users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `b_upload_sessions` ADD CONSTRAINT `fk_upload_session_document` FOREIGN KEY (`document_id`) REFERENCES `b_documents`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `b_upload_chunks` ADD CONSTRAINT `fk_upload_chunk_session` FOREIGN KEY (`upload_id`) REFERENCES `b_upload_sessions`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
