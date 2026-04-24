-- AlterTable
ALTER TABLE `b_kb_invitations` MODIFY `role` VARCHAR(50) NOT NULL DEFAULT 'member';

-- AlterTable
ALTER TABLE `b_kb_members` MODIFY `role` VARCHAR(50) NOT NULL DEFAULT 'member';

-- CreateIndex
CREATE INDEX `idx_doc_uploader_id` ON `b_documents`(`uploader_id`);

-- CreateIndex
CREATE INDEX `idx_doc_kb_uploader` ON `b_documents`(`kb_id`, `uploader_id`);

-- AddForeignKey
ALTER TABLE `b_documents` ADD CONSTRAINT `fk_doc_uploader` FOREIGN KEY (`uploader_id`) REFERENCES `b_users`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;
