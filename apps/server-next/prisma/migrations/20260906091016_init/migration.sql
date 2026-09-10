-- CreateTable
CREATE TABLE `b_users` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(255) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `full_name` VARCHAR(100) NULL,
    `avatar_url` VARCHAR(500) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `email_verified_at` DATETIME(3) NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    UNIQUE INDEX `uk_email`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `b_user_sessions` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `session_id` CHAR(36) NOT NULL,
    `user_id` BIGINT NOT NULL,
    `refresh_token_hash` CHAR(64) NOT NULL,
    `user_agent` VARCHAR(255) NULL,
    `revoked` BOOLEAN NOT NULL DEFAULT false,
    `revoked_at` DATETIME(3) NULL,
    `last_used_at` DATETIME(3) NULL,
    `expired_at` DATETIME(0) NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    UNIQUE INDEX `uk_session_id`(`session_id`),
    UNIQUE INDEX `uk_refresh_token_hash`(`refresh_token_hash`),
    INDEX `idx_user_id`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_email_codes` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(255) NOT NULL,
    `code_hash` CHAR(64) NOT NULL,
    `purpose` TINYINT UNSIGNED NOT NULL,
    `used` BOOLEAN NOT NULL DEFAULT false,
    `expired_at` DATETIME(0) NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_email`(`email`),
    INDEX `idx_email_purpose`(`email`, `purpose`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_admins` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(100) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `role` VARCHAR(50) NOT NULL DEFAULT 'admin',
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    UNIQUE INDEX `uk_admin_username`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_admin_sessions` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `session_id` CHAR(36) NOT NULL,
    `admin_id` BIGINT NOT NULL,
    `refresh_token_hash` CHAR(64) NOT NULL,
    `user_agent` VARCHAR(255) NULL,
    `revoked` BOOLEAN NOT NULL DEFAULT false,
    `expired_at` DATETIME(0) NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    UNIQUE INDEX `uk_admin_session_id`(`session_id`),
    UNIQUE INDEX `uk_admin_rt_hash`(`refresh_token_hash`),
    INDEX `idx_admin_id`(`admin_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_model_configs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `provider` VARCHAR(50) NOT NULL,
    `model_name` VARCHAR(100) NOT NULL,
    `display_name` VARCHAR(100) NOT NULL,
    `type` ENUM('chat', 'light', 'embedding', 'rerank') NOT NULL,
    `base_url` VARCHAR(500) NULL,
    `config_json` JSON NULL,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_model_type_status`(`type`, `is_active`, `is_default`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `b_user_model_configs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `provider` VARCHAR(50) NOT NULL,
    `model_name` VARCHAR(100) NOT NULL,
    `display_name` VARCHAR(100) NOT NULL,
    `base_url` VARCHAR(500) NULL,
    `api_key_encrypted` VARCHAR(1024) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_user_model`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `b_knowledge_bases` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `description` TEXT NULL,
    `cover_url` VARCHAR(500) NULL,
    `visibility` ENUM('private', 'collaborative', 'public') NOT NULL DEFAULT 'private',
    `allow_public_download` BOOLEAN NOT NULL DEFAULT false,
    `owner_id` BIGINT NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `idx_kb_owner`(`owner_id`),
    INDEX `idx_kb_visibility_updated`(`visibility`, `updated_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `b_kb_members` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `kb_id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,
    `role` ENUM('manager', 'collaborator', 'member') NOT NULL DEFAULT 'member',
    `joined_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `fk_member_user`(`user_id`),
    UNIQUE INDEX `uk_kb_user`(`kb_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `b_kb_invitations` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `kb_id` BIGINT NOT NULL,
    `inviter_id` BIGINT NOT NULL,
    `invite_code_hash` CHAR(64) NOT NULL,
    `role` ENUM('manager', 'collaborator', 'member') NOT NULL DEFAULT 'member',
    `expired_at` DATETIME(0) NOT NULL,
    `cancelled_at` DATETIME(3) NULL,
    `accepted_by` BIGINT NULL,
    `accepted_at` DATETIME(3) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    UNIQUE INDEX `b_kb_invitations_invite_code_hash_key`(`invite_code_hash`),
    INDEX `idx_invite_kb`(`kb_id`),
    INDEX `idx_invite_status_lookup`(`kb_id`, `accepted_at`, `cancelled_at`, `expired_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `b_documents` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `kb_id` BIGINT NOT NULL,
    `uploader_id` BIGINT NULL,
    `title` VARCHAR(255) NOT NULL,
    `original_filename` VARCHAR(255) NULL,
    `file_extension` VARCHAR(20) NULL,
    `mime_type` VARCHAR(100) NULL,
    `storage_provider` VARCHAR(30) NOT NULL DEFAULT 'minio',
    `storage_bucket` VARCHAR(128) NOT NULL,
    `storage_key` VARCHAR(1024) NOT NULL,
    `storage_etag` VARCHAR(255) NULL,
    `file_size` BIGINT NOT NULL,
    `file_sha256` CHAR(64) NOT NULL,
    `status` ENUM('processing', 'ready', 'failed', 'deleting', 'deleted') NOT NULL DEFAULT 'processing',
    `active_run_id` BIGINT NULL,
    `desired_run_id` BIGINT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,
    `deleted_at` DATETIME(0) NULL,

    INDEX `idx_kb_id`(`kb_id`),
    INDEX `idx_doc_uploader_id`(`uploader_id`),
    INDEX `idx_doc_kb_uploader`(`kb_id`, `uploader_id`),
    INDEX `idx_doc_kb_status_updated`(`kb_id`, `status`, `updated_at`),
    INDEX `idx_doc_file_sha256`(`file_sha256`),
    UNIQUE INDEX `uk_doc_active_run`(`active_run_id`),
    UNIQUE INDEX `uk_doc_desired_run`(`desired_run_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `b_upload_sessions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `session_id` CHAR(36) NOT NULL,
    `kb_id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,
    `document_id` BIGINT NULL,
    `storage_provider` VARCHAR(30) NOT NULL DEFAULT 'minio',
    `storage_bucket` VARCHAR(128) NOT NULL,
    `storage_key` VARCHAR(1024) NOT NULL,
    `multipart_upload_id` VARCHAR(255) NOT NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `title` VARCHAR(255) NULL,
    `file_size` BIGINT NOT NULL,
    `mime_type` VARCHAR(100) NULL,
    `client_sha256` CHAR(64) NULL,
    `file_extension` VARCHAR(20) NULL,
    `part_size` INTEGER NOT NULL,
    `total_parts` INTEGER NOT NULL,
    `uploaded_parts` INTEGER NOT NULL DEFAULT 0,
    `uploaded_bytes` BIGINT NOT NULL DEFAULT 0,
    `status` ENUM('initiated', 'uploading', 'completing', 'completed', 'aborted', 'expired', 'failed') NOT NULL DEFAULT 'initiated',
    `expires_at` DATETIME(0) NOT NULL,
    `last_activity_at` DATETIME(0) NULL,
    `completed_at` DATETIME(0) NULL,
    `aborted_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    UNIQUE INDEX `uk_upload_session_id`(`session_id`),
    UNIQUE INDEX `uk_upload_multipart_id`(`multipart_upload_id`),
    INDEX `idx_upload_session_kb`(`kb_id`),
    INDEX `idx_upload_session_user`(`user_id`),
    INDEX `idx_upload_session_restore`(`kb_id`, `user_id`, `client_sha256`),
    INDEX `idx_upload_session_document`(`document_id`),
    INDEX `idx_upload_session_expire`(`status`, `expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `b_upload_parts` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `upload_session_id` BIGINT NOT NULL,
    `part_number` INTEGER NOT NULL,
    `expected_size` INTEGER NOT NULL,
    `actual_size` INTEGER NULL,
    `etag` VARCHAR(255) NULL,
    `checksum_sha256` CHAR(64) NULL,
    `status` ENUM('pending', 'uploading', 'uploaded', 'failed') NOT NULL DEFAULT 'pending',
    `attempt_count` INTEGER NOT NULL DEFAULT 0,
    `last_error` TEXT NULL,
    `uploaded_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_upload_part_status`(`upload_session_id`, `status`),
    UNIQUE INDEX `uk_upload_part`(`upload_session_id`, `part_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `b_document_chunks` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `processing_run_id` BIGINT NOT NULL,
    `chunk_no` INTEGER NOT NULL,
    `content` LONGTEXT NOT NULL,
    `content_hash` CHAR(64) NULL,
    `token_count` INTEGER NULL DEFAULT 0,
    `page_start` INTEGER NULL,
    `page_end` INTEGER NULL,
    `char_start` INTEGER NULL,
    `char_end` INTEGER NULL,
    `chunk_level` INTEGER NOT NULL DEFAULT 3,
    `parent_chunk_id` BIGINT NULL,
    `root_chunk_id` BIGINT NULL,
    `vector_id` VARCHAR(255) NULL,
    `embedding_status` ENUM('pending', 'processing', 'completed', 'failed', 'skipped') NOT NULL DEFAULT 'pending',
    `embedding_error` TEXT NULL,
    `embedded_at` DATETIME(0) NULL,
    `vector_index_status` ENUM('pending', 'processing', 'completed', 'failed', 'skipped') NOT NULL DEFAULT 'pending',
    `vector_index_error` TEXT NULL,
    `vector_indexed_at` DATETIME(0) NULL,
    `search_index_status` ENUM('pending', 'processing', 'completed', 'failed', 'skipped') NOT NULL DEFAULT 'pending',
    `search_index_error` TEXT NULL,
    `search_indexed_at` DATETIME(0) NULL,
    `metadata_json` JSON NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_chunk_run_embedding`(`processing_run_id`, `embedding_status`),
    INDEX `idx_chunk_run_vector_index`(`processing_run_id`, `vector_index_status`),
    INDEX `idx_chunk_run_search_index`(`processing_run_id`, `search_index_status`),
    INDEX `idx_chunk_run_level`(`processing_run_id`, `chunk_level`),
    INDEX `idx_chunk_parent`(`parent_chunk_id`),
    INDEX `idx_chunk_root`(`root_chunk_id`),
    INDEX `idx_chunk_vector_id`(`vector_id`),
    UNIQUE INDEX `uk_run_chunk_no`(`processing_run_id`, `chunk_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `b_document_processing_runs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `document_id` BIGINT NOT NULL,
    `run_no` INTEGER NOT NULL,
    `trigger_type` VARCHAR(30) NOT NULL,
    `status` ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled') NOT NULL DEFAULT 'queued',
    `current_stage` ENUM('parse', 'chunk', 'embed', 'index', 'completed') NOT NULL DEFAULT 'parse',
    `source_sha256` CHAR(64) NOT NULL,
    `parser_config_json` JSON NULL,
    `chunking_config_json` JSON NULL,
    `embedding_model_name` VARCHAR(150) NOT NULL,
    `embedding_dimension` INTEGER NULL,
    `embedding_config_json` JSON NOT NULL,
    `embedding_config_hash` CHAR(64) NOT NULL,
    `index_targets_json` JSON NOT NULL,
    `retrieval_policy_json` JSON NOT NULL,
    `total_chunks` INTEGER NOT NULL DEFAULT 0,
    `completed_chunks` INTEGER NOT NULL DEFAULT 0,
    `total_tokens` INTEGER NOT NULL DEFAULT 0,
    `error_code` VARCHAR(100) NULL,
    `error_message` TEXT NULL,
    `requested_by` BIGINT NULL,
    `queued_at` DATETIME(0) NULL,
    `started_at` DATETIME(0) NULL,
    `finished_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_processing_run_document_status`(`document_id`, `status`),
    INDEX `idx_processing_run_status_stage`(`status`, `current_stage`),
    UNIQUE INDEX `uk_document_run_no`(`document_id`, `run_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `b_document_processing_tasks` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `processing_run_id` BIGINT NOT NULL,
    `parent_task_id` BIGINT NULL,
    `stage` ENUM('parse', 'chunk', 'embed', 'vector_index', 'search_index') NOT NULL,
    `task_key` VARCHAR(255) NOT NULL,
    `queue_name` VARCHAR(100) NOT NULL,
    `bullmq_job_id` VARCHAR(255) NULL,
    `status` ENUM('queued', 'running', 'retrying', 'succeeded', 'failed', 'cancelled') NOT NULL DEFAULT 'queued',
    `attempts_allowed` INTEGER NOT NULL DEFAULT 3,
    `attempts_made` INTEGER NOT NULL DEFAULT 0,
    `progress` INTEGER NOT NULL DEFAULT 0,
    `batch_no` INTEGER NULL,
    `scope_json` JSON NULL,
    `payload_json` JSON NULL,
    `result_json` JSON NULL,
    `artifact_manifest_json` JSON NULL,
    `execution_version` INTEGER NOT NULL DEFAULT 0,
    `worker_id` VARCHAR(100) NULL,
    `locked_at` DATETIME(0) NULL,
    `heartbeat_at` DATETIME(0) NULL,
    `available_at` DATETIME(0) NULL,
    `last_error_code` VARCHAR(100) NULL,
    `last_error_message` TEXT NULL,
    `started_at` DATETIME(0) NULL,
    `finished_at` DATETIME(0) NULL,
    `duration_ms` INTEGER NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    UNIQUE INDEX `uk_processing_task_key`(`task_key`),
    INDEX `idx_processing_task_run_stage`(`processing_run_id`, `stage`, `status`),
    INDEX `idx_processing_task_status_available`(`status`, `available_at`),
    INDEX `idx_processing_task_parent`(`parent_task_id`),
    INDEX `idx_processing_task_status_heartbeat`(`status`, `heartbeat_at`),
    UNIQUE INDEX `uk_processing_task_bullmq_job`(`queue_name`, `bullmq_job_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `b_chat_sessions` (
    `id` CHAR(36) NOT NULL,
    `user_id` BIGINT NOT NULL,
    `kb_id` BIGINT NULL,
    `title` VARCHAR(100) NOT NULL DEFAULT '新会话',
    `summary_text` TEXT NULL,
    `last_selected_kb_ids_json` JSON NULL,
    `last_chat_mode` VARCHAR(20) NULL,
    `last_message_at` DATETIME(0) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL,

    INDEX `idx_user_chat`(`user_id`),
    INDEX `idx_chat_user_updated`(`user_id`, `updated_at`),
    INDEX `idx_chat_user_last_message`(`user_id`, `last_message_at`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `b_chat_messages` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `session_id` CHAR(36) NOT NULL,
    `role` VARCHAR(50) NOT NULL,
    `content` TEXT NOT NULL,
    `references` JSON NULL,
    `tool_calls` JSON NULL,
    `tokens_used` INTEGER NULL DEFAULT 0,
    `message_status` VARCHAR(30) NOT NULL DEFAULT 'completed',
    `metadata_json` JSON NULL,
    `model_name` VARCHAR(100) NULL,
    `model_source` ENUM('system', 'user') NULL,
    `model_config_id` VARCHAR(50) NULL,
    `finish_reason` VARCHAR(30) NULL,
    `trace_id` CHAR(36) NULL,
    `chat_mode` VARCHAR(20) NULL,
    `selected_kb_ids_json` JSON NULL,
    `resolved_kb_ids_json` JSON NULL,
    `stream_started_at` DATETIME(0) NULL,
    `stream_finished_at` DATETIME(0) NULL,
    `feedback_type` VARCHAR(20) NULL,
    `feedback_reason` TEXT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_session_msg`(`session_id`),
    INDEX `idx_session_msg_created`(`session_id`, `created_at`),
    INDEX `idx_session_role`(`session_id`, `role`),
    INDEX `idx_msg_trace`(`trace_id`),
    INDEX `idx_msg_status`(`message_status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `b_chat_message_citations` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `message_id` BIGINT NOT NULL,
    `kb_id` BIGINT NULL,
    `doc_id` BIGINT NULL,
    `chunk_id` BIGINT NULL,
    `score` DOUBLE NULL,
    `quote` TEXT NULL,
    `source_snapshot_json` JSON NOT NULL,
    `order_no` INTEGER NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_chat_citation_doc`(`doc_id`),
    INDEX `idx_chat_citation_chunk`(`chunk_id`),
    INDEX `idx_chat_citation_kb`(`kb_id`),
    UNIQUE INDEX `uk_chat_citation_order`(`message_id`, `order_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `b_outbox_events` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `event_key` VARCHAR(255) NOT NULL,
    `event_type` ENUM('dispatch_processing_task', 'cleanup_document', 'cleanup_run', 'cleanup_knowledge_base') NOT NULL,
    `aggregate_type` VARCHAR(50) NOT NULL,
    `aggregate_id` VARCHAR(64) NOT NULL,
    `payload_json` JSON NOT NULL,
    `status` ENUM('pending', 'dispatching', 'dispatched', 'completed', 'failed') NOT NULL DEFAULT 'pending',
    `attempts_made` INTEGER NOT NULL DEFAULT 0,
    `available_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lock_token` CHAR(36) NULL,
    `locked_until` DATETIME(3) NULL,
    `dispatched_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `last_error` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `uk_outbox_event_key`(`event_key`),
    INDEX `idx_outbox_dispatch`(`status`, `available_at`),
    INDEX `idx_outbox_lease`(`status`, `locked_until`),
    INDEX `idx_outbox_reconcile`(`status`, `dispatched_at`),
    INDEX `idx_outbox_aggregate`(`aggregate_type`, `aggregate_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `b_user_sessions` ADD CONSTRAINT `b_user_sessions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `b_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sys_admin_sessions` ADD CONSTRAINT `sys_admin_sessions_admin_id_fkey` FOREIGN KEY (`admin_id`) REFERENCES `sys_admins`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `b_user_model_configs` ADD CONSTRAINT `b_user_model_configs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `b_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `b_knowledge_bases` ADD CONSTRAINT `fk_kb_owner` FOREIGN KEY (`owner_id`) REFERENCES `b_users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `b_kb_members` ADD CONSTRAINT `fk_member_kb` FOREIGN KEY (`kb_id`) REFERENCES `b_knowledge_bases`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `b_kb_members` ADD CONSTRAINT `fk_member_user` FOREIGN KEY (`user_id`) REFERENCES `b_users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `b_kb_invitations` ADD CONSTRAINT `b_kb_invitations_kb_id_fkey` FOREIGN KEY (`kb_id`) REFERENCES `b_knowledge_bases`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `b_kb_invitations` ADD CONSTRAINT `b_kb_invitations_inviter_id_fkey` FOREIGN KEY (`inviter_id`) REFERENCES `b_users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `b_kb_invitations` ADD CONSTRAINT `b_kb_invitations_accepted_by_fkey` FOREIGN KEY (`accepted_by`) REFERENCES `b_users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `b_documents` ADD CONSTRAINT `fk_doc_active_run` FOREIGN KEY (`active_run_id`) REFERENCES `b_document_processing_runs`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `b_documents` ADD CONSTRAINT `fk_doc_desired_run` FOREIGN KEY (`desired_run_id`) REFERENCES `b_document_processing_runs`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `b_documents` ADD CONSTRAINT `fk_doc_kb` FOREIGN KEY (`kb_id`) REFERENCES `b_knowledge_bases`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `b_documents` ADD CONSTRAINT `fk_doc_uploader` FOREIGN KEY (`uploader_id`) REFERENCES `b_users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `b_upload_sessions` ADD CONSTRAINT `fk_upload_session_kb` FOREIGN KEY (`kb_id`) REFERENCES `b_knowledge_bases`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `b_upload_sessions` ADD CONSTRAINT `fk_upload_session_user` FOREIGN KEY (`user_id`) REFERENCES `b_users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `b_upload_sessions` ADD CONSTRAINT `fk_upload_session_document` FOREIGN KEY (`document_id`) REFERENCES `b_documents`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `b_upload_parts` ADD CONSTRAINT `fk_upload_part_session` FOREIGN KEY (`upload_session_id`) REFERENCES `b_upload_sessions`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `b_document_chunks` ADD CONSTRAINT `fk_chunk_processing_run` FOREIGN KEY (`processing_run_id`) REFERENCES `b_document_processing_runs`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `b_document_chunks` ADD CONSTRAINT `b_document_chunks_parent_chunk_id_fkey` FOREIGN KEY (`parent_chunk_id`) REFERENCES `b_document_chunks`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `b_document_processing_runs` ADD CONSTRAINT `fk_processing_run_document` FOREIGN KEY (`document_id`) REFERENCES `b_documents`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `b_document_processing_tasks` ADD CONSTRAINT `fk_processing_task_run` FOREIGN KEY (`processing_run_id`) REFERENCES `b_document_processing_runs`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `b_document_processing_tasks` ADD CONSTRAINT `b_document_processing_tasks_parent_task_id_fkey` FOREIGN KEY (`parent_task_id`) REFERENCES `b_document_processing_tasks`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `b_chat_sessions` ADD CONSTRAINT `fk_chat_user` FOREIGN KEY (`user_id`) REFERENCES `b_users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `b_chat_messages` ADD CONSTRAINT `fk_msg_session` FOREIGN KEY (`session_id`) REFERENCES `b_chat_sessions`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `b_chat_message_citations` ADD CONSTRAINT `fk_chat_citation_message` FOREIGN KEY (`message_id`) REFERENCES `b_chat_messages`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `b_chat_message_citations` ADD CONSTRAINT `fk_chat_citation_kb` FOREIGN KEY (`kb_id`) REFERENCES `b_knowledge_bases`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `b_chat_message_citations` ADD CONSTRAINT `fk_chat_citation_doc` FOREIGN KEY (`doc_id`) REFERENCES `b_documents`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `b_chat_message_citations` ADD CONSTRAINT `fk_chat_citation_chunk` FOREIGN KEY (`chunk_id`) REFERENCES `b_document_chunks`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;
