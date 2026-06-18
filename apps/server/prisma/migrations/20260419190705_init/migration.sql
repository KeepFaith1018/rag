-- CreateTable
CREATE TABLE `b_users` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(255) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `full_name` VARCHAR(100) NULL,
    `avatar_url` VARCHAR(500) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `daily_chat_limit` INTEGER NOT NULL DEFAULT 50,
    `token_quota` BIGINT NOT NULL DEFAULT 1000000,
    `used_tokens` BIGINT NOT NULL DEFAULT 0,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_email`(`email`),
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
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_admin_username`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_email_codes` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `email` VARCHAR(255) NOT NULL,
    `code` CHAR(6) NOT NULL,
    `purpose` TINYINT UNSIGNED NOT NULL,
    `used` BOOLEAN NOT NULL DEFAULT false,
    `expired_at` DATETIME(0) NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_email`(`email`),
    INDEX `idx_email_purpose`(`email`, `purpose`),
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
    `expired_at` DATETIME(0) NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_session_id`(`session_id`),
    UNIQUE INDEX `uk_refresh_token_hash`(`refresh_token_hash`),
    INDEX `idx_user_id`(`user_id`),
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

    UNIQUE INDEX `uk_admin_session_id`(`session_id`),
    UNIQUE INDEX `uk_admin_rt_hash`(`refresh_token_hash`),
    INDEX `idx_admin_id`(`admin_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_model_configs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `provider` VARCHAR(50) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `type` VARCHAR(50) NOT NULL,
    `base_url` VARCHAR(255) NULL,
    `api_key` VARCHAR(500) NULL,
    `config_json` JSON NULL,
    `is_default` BOOLEAN NOT NULL DEFAULT false,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `b_user_model_configs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `provider` VARCHAR(50) NOT NULL,
    `model_name` VARCHAR(100) NOT NULL,
    `base_url` VARCHAR(255) NULL,
    `api_key` VARCHAR(500) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_user_model`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `b_knowledge_bases` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `description` TEXT NULL,
    `visibility` VARCHAR(50) NOT NULL DEFAULT 'private',
    `status` VARCHAR(50) NOT NULL DEFAULT 'normal',
    `owner_id` BIGINT NOT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_owner`(`owner_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `b_kb_members` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `kb_id` BIGINT NOT NULL,
    `user_id` BIGINT NOT NULL,
    `role` VARCHAR(50) NOT NULL DEFAULT 'viewer',
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
    `invite_code` VARCHAR(64) NOT NULL,
    `role` VARCHAR(50) NOT NULL DEFAULT 'viewer',
    `expired_at` DATETIME(0) NOT NULL,
    `is_used` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `b_kb_invitations_invite_code_key`(`invite_code`),
    INDEX `idx_invite_kb`(`kb_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `b_documents` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `kb_id` BIGINT NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `file_path` VARCHAR(500) NOT NULL,
    `file_hash` VARCHAR(64) NULL,
    `file_size` BIGINT NULL DEFAULT 0,
    `file_type` VARCHAR(20) NULL,
    `status` VARCHAR(50) NOT NULL DEFAULT 'pending',
    `error_msg` TEXT NULL,
    `token_count` INTEGER NULL DEFAULT 0,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_kb_id`(`kb_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `b_document_chunks` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `doc_id` BIGINT NOT NULL,
    `chunk_index` INTEGER NOT NULL,
    `content` LONGTEXT NOT NULL,
    `token_count` INTEGER NULL DEFAULT 0,
    `embedding_status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_doc_chunk`(`doc_id`, `chunk_index`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `b_chat_sessions` (
    `id` CHAR(36) NOT NULL,
    `user_id` BIGINT NOT NULL,
    `kb_id` BIGINT NULL,
    `title` VARCHAR(100) NOT NULL DEFAULT '新会话',
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),
    `updated_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_user_chat`(`user_id`),
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
    `feedback_type` VARCHAR(20) NULL,
    `feedback_reason` TEXT NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_session_msg`(`session_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_audit_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `admin_id` BIGINT NULL,
    `action` VARCHAR(100) NOT NULL,
    `module` VARCHAR(50) NOT NULL,
    `ip_address` VARCHAR(50) NULL,
    `details` JSON NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_audit_admin`(`admin_id`),
    INDEX `idx_audit_action`(`action`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_dict_type` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(100) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `remark` VARCHAR(255) NULL,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    UNIQUE INDEX `uk_code`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sys_dict_item` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `type_code` VARCHAR(100) NOT NULL,
    `value` VARCHAR(100) NOT NULL,
    `label` VARCHAR(100) NOT NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,
    `status` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(0) NOT NULL DEFAULT CURRENT_TIMESTAMP(0),

    INDEX `idx_type_code`(`type_code`),
    UNIQUE INDEX `uk_type_value`(`type_code`, `value`),
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
ALTER TABLE `b_documents` ADD CONSTRAINT `fk_doc_kb` FOREIGN KEY (`kb_id`) REFERENCES `b_knowledge_bases`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `b_document_chunks` ADD CONSTRAINT `fk_chunk_doc` FOREIGN KEY (`doc_id`) REFERENCES `b_documents`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `b_chat_sessions` ADD CONSTRAINT `fk_chat_user` FOREIGN KEY (`user_id`) REFERENCES `b_users`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `b_chat_messages` ADD CONSTRAINT `fk_msg_session` FOREIGN KEY (`session_id`) REFERENCES `b_chat_sessions`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `sys_audit_logs` ADD CONSTRAINT `sys_audit_logs_admin_id_fkey` FOREIGN KEY (`admin_id`) REFERENCES `sys_admins`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
