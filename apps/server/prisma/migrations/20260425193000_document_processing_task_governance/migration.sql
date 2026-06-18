-- CreateTable
CREATE TABLE `b_document_processing_tasks` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `document_id` BIGINT NOT NULL,
    `processing_version` INTEGER NOT NULL,
    `job_id` VARCHAR(100) NULL,
    `stage` VARCHAR(50) NOT NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'running',
    `attempt` INTEGER NOT NULL DEFAULT 1,
    `error_code` VARCHAR(100) NULL,
    `error_message` TEXT NULL,
    `started_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `finished_at` DATETIME(0) NULL,
    `duration_ms` INTEGER NULL,
    `heartbeat_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_doc_processing_stage_attempt`(`document_id`, `processing_version`, `stage`, `attempt`),
    INDEX `idx_processing_task_document_version`(`document_id`, `processing_version`),
    INDEX `idx_processing_task_status_stage`(`status`, `stage`),
    INDEX `idx_processing_task_started_at`(`started_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `b_document_processing_tasks` ADD CONSTRAINT `fk_processing_task_document`
FOREIGN KEY (`document_id`) REFERENCES `b_documents`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
