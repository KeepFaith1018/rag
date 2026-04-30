/*
  Warnings:

  - You are about to drop the column `daily_chat_limit` on the `b_users` table. All the data in the column will be lost.
  - You are about to drop the column `token_quota` on the `b_users` table. All the data in the column will be lost.
  - You are about to drop the column `used_tokens` on the `b_users` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `b_chat_messages` ADD COLUMN `chat_mode` VARCHAR(20) NULL,
    ADD COLUMN `finish_reason` VARCHAR(30) NULL,
    ADD COLUMN `message_status` VARCHAR(30) NOT NULL DEFAULT 'completed',
    ADD COLUMN `metadata_json` JSON NULL,
    ADD COLUMN `model_name` VARCHAR(100) NULL,
    ADD COLUMN `resolved_kb_ids_json` JSON NULL,
    ADD COLUMN `selected_kb_ids_json` JSON NULL,
    ADD COLUMN `stream_finished_at` DATETIME(0) NULL,
    ADD COLUMN `stream_started_at` DATETIME(0) NULL,
    ADD COLUMN `trace_id` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `b_chat_sessions` ADD COLUMN `last_chat_mode` VARCHAR(20) NULL,
    ADD COLUMN `last_message_at` DATETIME(0) NULL,
    ADD COLUMN `last_selected_kb_ids_json` JSON NULL,
    ADD COLUMN `summary_text` TEXT NULL;

-- AlterTable
ALTER TABLE `b_users` DROP COLUMN `daily_chat_limit`,
    DROP COLUMN `token_quota`,
    DROP COLUMN `used_tokens`;

-- CreateTable
CREATE TABLE `b_user_daily_quotas` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `quota_date` DATE NOT NULL,
    `daily_chat_limit` INTEGER NOT NULL DEFAULT 50,
    `daily_token_quota` BIGINT NOT NULL DEFAULT 1000000,
    `used_chat_count` INTEGER NOT NULL DEFAULT 0,
    `used_token_count` BIGINT NOT NULL DEFAULT 0,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_daily_quota_date`(`quota_date`),
    UNIQUE INDEX `uk_user_daily_quota`(`user_id`, `quota_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `b_chat_message_citations` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `message_id` BIGINT NOT NULL,
    `kb_id` BIGINT NOT NULL,
    `doc_id` BIGINT NOT NULL,
    `chunk_id` BIGINT NOT NULL,
    `score` DOUBLE NULL,
    `quote` TEXT NULL,
    `order_no` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_chat_citation_message`(`message_id`),
    INDEX `idx_chat_citation_doc`(`doc_id`),
    INDEX `idx_chat_citation_chunk`(`chunk_id`),
    INDEX `idx_chat_citation_kb`(`kb_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `b_agent_runs` (
    `id` CHAR(36) NOT NULL,
    `session_id` CHAR(36) NOT NULL,
    `user_id` BIGINT NOT NULL,
    `user_message_id` BIGINT NOT NULL,
    `assistant_message_id` BIGINT NULL,
    `status` VARCHAR(30) NOT NULL,
    `total_tokens` INTEGER NULL DEFAULT 0,
    `duration_ms` INTEGER NULL,
    `chat_mode` VARCHAR(20) NULL,
    `selected_kb_ids_json` JSON NULL,
    `resolved_kb_ids_json` JSON NULL,
    `routed_query_json` JSON NULL,
    `metadata_json` JSON NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `finished_at` DATETIME(0) NULL,

    INDEX `idx_agent_run_session`(`session_id`),
    INDEX `idx_agent_run_user`(`user_id`),
    INDEX `idx_agent_run_status`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `idx_session_msg_created` ON `b_chat_messages`(`session_id`, `created_at`);

-- CreateIndex
CREATE INDEX `idx_msg_trace` ON `b_chat_messages`(`trace_id`);

-- CreateIndex
CREATE INDEX `idx_msg_status` ON `b_chat_messages`(`message_status`);

-- CreateIndex
CREATE INDEX `idx_chat_user_updated` ON `b_chat_sessions`(`user_id`, `updated_at`);

-- AddForeignKey
ALTER TABLE `b_user_daily_quotas` ADD CONSTRAINT `fk_user_daily_quota_user` FOREIGN KEY (`user_id`) REFERENCES `b_users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `b_chat_message_citations` ADD CONSTRAINT `fk_chat_citation_message` FOREIGN KEY (`message_id`) REFERENCES `b_chat_messages`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `b_chat_message_citations` ADD CONSTRAINT `fk_chat_citation_kb` FOREIGN KEY (`kb_id`) REFERENCES `b_knowledge_bases`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `b_chat_message_citations` ADD CONSTRAINT `fk_chat_citation_doc` FOREIGN KEY (`doc_id`) REFERENCES `b_documents`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `b_chat_message_citations` ADD CONSTRAINT `fk_chat_citation_chunk` FOREIGN KEY (`chunk_id`) REFERENCES `b_document_chunks`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `b_agent_runs` ADD CONSTRAINT `fk_agent_run_session` FOREIGN KEY (`session_id`) REFERENCES `b_chat_sessions`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `b_agent_runs` ADD CONSTRAINT `fk_agent_run_user` FOREIGN KEY (`user_id`) REFERENCES `b_users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
