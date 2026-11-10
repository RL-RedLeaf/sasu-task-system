
-- CreateTable
CREATE TABLE `users` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(32) NOT NULL,
    `name` VARCHAR(32) NOT NULL,
    `role` ENUM('STUDENT', 'TEACHER', 'ADMIN') NOT NULL,
    `class_name` VARCHAR(64) NULL,
    `email` VARCHAR(128) NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `must_change_password` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
    `token_version` INTEGER NOT NULL DEFAULT 0,
    `last_login_at` DATETIME(3) NULL,
    `violation_count` INTEGER NOT NULL DEFAULT 0,
    `penalty_debt` INTEGER NOT NULL DEFAULT 0,
    `disabled_reason` VARCHAR(255) NULL,
    `version` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `users_username_key`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `login_attempts` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(32) NOT NULL,
    `ip` VARCHAR(64) NOT NULL,
    `success` BOOLEAN NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `login_attempts_username_created_at_idx`(`username`, `created_at`),
    INDEX `login_attempts_ip_created_at_idx`(`ip`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `import_batches` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `file_name` VARCHAR(255) NOT NULL,
    `total_rows` INTEGER NOT NULL DEFAULT 0,
    `success_rows` INTEGER NOT NULL DEFAULT 0,
    `failed_rows` INTEGER NOT NULL DEFAULT 0,
    `created_by` BIGINT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `import_errors` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `batch_id` BIGINT NOT NULL,
    `row_num` INTEGER NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `raw_data` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `import_errors_batch_id_idx`(`batch_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_categories` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(32) NOT NULL,
    `description` VARCHAR(255) NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `task_categories_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tasks` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `teacher_id` BIGINT NOT NULL,
    `created_by` BIGINT NOT NULL,
    `category_id` BIGINT NOT NULL,
    `title` VARCHAR(50) NOT NULL,
    `description` VARCHAR(2000) NOT NULL,
    `requirement` TEXT NULL,
    `location` VARCHAR(100) NULL,
    `contact_info` VARCHAR(200) NULL,
    `reward_per_person` INTEGER NULL,
    `headcount` INTEGER NOT NULL,
    `total_amount` INTEGER NOT NULL DEFAULT 0,
    `filled_count` INTEGER NOT NULL DEFAULT 0,
    `accepted_count` INTEGER NOT NULL DEFAULT 0,
    `paid_base_amount` INTEGER NOT NULL DEFAULT 0,
    `paid_bonus_amount` INTEGER NOT NULL DEFAULT 0,
    `refunded_amount` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('PENDING_REWARD', 'RECRUITING', 'FULL', 'OFFLINE', 'CLOSED', 'SETTLED', 'CANCELLED') NOT NULL DEFAULT 'PENDING_REWARD',
    `settlement_status` ENUM('OPEN', 'SETTLING', 'DONE') NOT NULL DEFAULT 'OPEN',
    `settlement_mode` ENUM('NORMAL', 'REFUND_ONLY') NOT NULL DEFAULT 'NORMAL',
    `cancel_type` ENUM('TEACHER', 'ADMIN') NULL,
    `cancel_reason` VARCHAR(255) NULL,
    `priced_at` DATETIME(3) NULL,
    `priced_by` BIGINT NULL,
    `deadline_at` DATETIME(3) NOT NULL,
    `closed_at` DATETIME(3) NULL,
    `settled_at` DATETIME(3) NULL,
    `target_grades` JSON NULL,
    `version` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_status_deadline`(`status`, `deadline_at`),
    INDEX `idx_teacher_status`(`teacher_id`, `status`),
    INDEX `idx_pending`(`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_attachments` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `task_id` BIGINT NOT NULL,
    `file_id` BIGINT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `task_attachments_task_id_idx`(`task_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_assignments` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `task_id` BIGINT NOT NULL,
    `student_id` BIGINT NOT NULL,
    `attempt_no` INTEGER NOT NULL,
    `status` ENUM('CLAIMED', 'SUBMITTED', 'ACCEPTED', 'REJECTED', 'FAILED', 'OVERDUE', 'WITHDRAWN', 'CANCELLED_BY_TEACHER', 'SETTLED') NOT NULL DEFAULT 'CLAIMED',
    `claimed_at` DATETIME(3) NOT NULL,
    `accepted_at` DATETIME(3) NULL,
    `withdrawn_at` DATETIME(3) NULL,
    `failed_at` DATETIME(3) NULL,
    `overdue_at` DATETIME(3) NULL,
    `resubmit_deadline` DATETIME(3) NULL,
    `reject_count` INTEGER NOT NULL DEFAULT 0,
    `base_paid` INTEGER NOT NULL DEFAULT 0,
    `reward_paid_rate` INTEGER NULL,
    `bonus_paid` INTEGER NOT NULL DEFAULT 0,
    `passed` BOOLEAN NOT NULL DEFAULT false,
    `is_violation` BOOLEAN NOT NULL DEFAULT false,
    `violation_penalty` INTEGER NOT NULL DEFAULT 0,
    `violation_deducted` INTEGER NOT NULL DEFAULT 0,
    `version` INTEGER NOT NULL DEFAULT 0,

    INDEX `task_assignments_task_id_status_idx`(`task_id`, `status`),
    INDEX `task_assignments_student_id_status_idx`(`student_id`, `status`),
    UNIQUE INDEX `uk_attempt`(`task_id`, `student_id`, `attempt_no`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_events` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `task_id` BIGINT NOT NULL,
    `from_status` ENUM('PENDING_REWARD', 'RECRUITING', 'FULL', 'OFFLINE', 'CLOSED', 'SETTLED', 'CANCELLED') NULL,
    `to_status` ENUM('PENDING_REWARD', 'RECRUITING', 'FULL', 'OFFLINE', 'CLOSED', 'SETTLED', 'CANCELLED') NOT NULL,
    `actor_id` BIGINT NULL,
    `reason` VARCHAR(255) NULL,
    `requestId` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `task_events_task_id_id_idx`(`task_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assignment_events` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `assignment_id` BIGINT NOT NULL,
    `from_status` ENUM('CLAIMED', 'SUBMITTED', 'ACCEPTED', 'REJECTED', 'FAILED', 'OVERDUE', 'WITHDRAWN', 'CANCELLED_BY_TEACHER', 'SETTLED') NULL,
    `to_status` ENUM('CLAIMED', 'SUBMITTED', 'ACCEPTED', 'REJECTED', 'FAILED', 'OVERDUE', 'WITHDRAWN', 'CANCELLED_BY_TEACHER', 'SETTLED') NOT NULL,
    `actor_id` BIGINT NULL,
    `reason` VARCHAR(255) NULL,
    `requestId` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `assignment_events_assignment_id_id_idx`(`assignment_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_edit_history` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `task_id` BIGINT NOT NULL,
    `editor_id` BIGINT NOT NULL,
    `field` VARCHAR(32) NOT NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `task_edit_history_task_id_id_idx`(`task_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `submissions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `assignment_id` BIGINT NOT NULL,
    `version` INTEGER NOT NULL,
    `content` VARCHAR(1000) NOT NULL,
    `status` ENUM('PENDING', 'ACCEPTED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `submitted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewed_at` DATETIME(3) NULL,
    `student_id` BIGINT NOT NULL,

    UNIQUE INDEX `uk_submission_version`(`assignment_id`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `submission_files` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `submission_id` BIGINT NOT NULL,
    `file_id` BIGINT NOT NULL,

    UNIQUE INDEX `submission_files_submission_id_file_id_key`(`submission_id`, `file_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reviews` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `submission_id` BIGINT NOT NULL,
    `assignment_id` BIGINT NOT NULL,
    `reviewer_id` BIGINT NOT NULL,
    `decision` ENUM('ACCEPT', 'REJECT') NOT NULL,
    `reason` VARCHAR(200) NULL,
    `is_proxy` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `reviews_assignment_id_id_idx`(`assignment_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `comments` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `task_id` BIGINT NOT NULL,
    `author_id` BIGINT NOT NULL,
    `parent_id` BIGINT NULL,
    `content` VARCHAR(500) NOT NULL,
    `deleted_at` DATETIME(3) NULL,
    `deleted_by` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `comments_task_id_id_idx`(`task_id`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `point_accounts` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `account_key` VARCHAR(64) NOT NULL,
    `owner_type` ENUM('POOL', 'TASK_ESCROW', 'USER', 'SYS_ISSUE', 'SYS_CASHOUT') NOT NULL,
    `owner_id` BIGINT NULL,
    `balance` INTEGER NOT NULL DEFAULT 0,
    `frozen` INTEGER NOT NULL DEFAULT 0,
    `total_in` INTEGER NOT NULL DEFAULT 0,
    `total_out` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `point_accounts_account_key_key`(`account_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `point_transactions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `type` ENUM('POOL_TOPUP', 'POOL_ADJUST_DOWN', 'ADMIN_GRANT', 'ADMIN_DEDUCT', 'TASK_FREEZE', 'TASK_PAYOUT', 'TASK_REPRICE_TOPUP', 'TASK_ARBITRATION', 'TASK_BONUS', 'TASK_REFUND', 'VIOLATION_DEDUCT', 'DEBT_OFFSET', 'WITHDRAW_FREEZE', 'WITHDRAW_REFUND', 'WITHDRAW_PAID', 'ARBITRATION_PAY') NOT NULL,
    `biz_key` VARCHAR(128) NOT NULL,
    `task_id` BIGINT NULL,
    `assignment_id` BIGINT NULL,
    `withdrawal_id` BIGINT NULL,
    `dispute_id` BIGINT NULL,
    `operator_id` BIGINT NULL,
    `reason` VARCHAR(255) NULL,
    `requestId` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `point_transactions_biz_key_key`(`biz_key`),
    INDEX `point_transactions_type_created_at_idx`(`type`, `created_at`),
    INDEX `point_transactions_task_id_idx`(`task_id`),
    INDEX `point_transactions_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `point_legs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `transaction_id` BIGINT NOT NULL,
    `account_id` BIGINT NOT NULL,
    `bucket` ENUM('AVAILABLE', 'FROZEN') NOT NULL,
    `delta` INTEGER NOT NULL,
    `balance_after` INTEGER NOT NULL,

    INDEX `point_legs_account_id_bucket_id_idx`(`account_id`, `bucket`, `id`),
    INDEX `point_legs_transaction_id_idx`(`transaction_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `withdrawals` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `student_id` BIGINT NOT NULL,
    `points` INTEGER NOT NULL,
    `cash_amount` DECIMAL(10, 2) NOT NULL,
    `rate` DECIMAL(10, 4) NOT NULL,
    `period_key` CHAR(7) NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'PAID', 'REJECTED', 'WITHDRAWN') NOT NULL DEFAULT 'PENDING',
    `applied_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewed_at` DATETIME(3) NULL,
    `paid_at` DATETIME(3) NULL,
    `reviewed_by` BIGINT NULL,
    `paid_by` BIGINT NULL,
    `reject_reason` VARCHAR(255) NULL,
    `pay_note` VARCHAR(255) NULL,
    `freeze_tx_id` BIGINT NULL,
    `payout_tx_id` BIGINT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,

    INDEX `withdrawals_student_id_status_period_key_idx`(`student_id`, `status`, `period_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `disputes` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `task_id` BIGINT NULL,
    `assignment_id` BIGINT NULL,
    `initiator_id` BIGINT NOT NULL,
    `initiator_role` ENUM('STUDENT', 'TEACHER') NOT NULL,
    `respondent_id` BIGINT NOT NULL,
    `reason` TEXT NOT NULL,
    `status` ENUM('OPEN', 'RESOLVED', 'REJECTED') NOT NULL DEFAULT 'OPEN',
    `decision` ENUM('PAY_FULL', 'PAY_PARTIAL', 'REJECT') NULL,
    `pay_points` INTEGER NULL,
    `resolution_note` TEXT NULL,
    `resolution_tx_id` BIGINT NULL,
    `resolved_by` BIGINT NULL,
    `resolved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `disputes_status_created_at_idx`(`status`, `created_at`),
    INDEX `disputes_task_id_idx`(`task_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dispute_evidence` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `dispute_id` BIGINT NOT NULL,
    `uploader_id` BIGINT NOT NULL,
    `file_id` BIGINT NULL,
    `description` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `dispute_evidence_dispute_id_idx`(`dispute_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `notifications` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `type` VARCHAR(32) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `body` TEXT NOT NULL,
    `payload` JSON NULL,
    `read_at` DATETIME(3) NULL,
    `dedupe_key` VARCHAR(128) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `notifications_dedupe_key_key`(`dedupe_key`),
    INDEX `notifications_user_id_read_at_idx`(`user_id`, `read_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `announcements` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(100) NOT NULL,
    `content` TEXT NOT NULL,
    `status` ENUM('DRAFT', 'PUBLISHED', 'OFFLINE') NOT NULL DEFAULT 'DRAFT',
    `published_at` DATETIME(3) NULL,
    `created_by` BIGINT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reports` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `reporter_id` BIGINT NOT NULL,
    `target_type` ENUM('TASK', 'COMMENT') NOT NULL,
    `target_id` BIGINT NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `status` ENUM('OPEN', 'HANDLED', 'DISMISSED') NOT NULL DEFAULT 'OPEN',
    `handled_by` BIGINT NULL,
    `handled_at` DATETIME(3) NULL,
    `handle_note` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `reports_status_created_at_idx`(`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `settlement_batches` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `task_id` BIGINT NOT NULL,
    `status` ENUM('RUNNING', 'DONE', 'FAILED') NOT NULL DEFAULT 'RUNNING',
    `accepted_count` INTEGER NOT NULL DEFAULT 0,
    `base_amount` INTEGER NOT NULL DEFAULT 0,
    `bonus_amount` INTEGER NOT NULL DEFAULT 0,
    `refund_amount` INTEGER NOT NULL DEFAULT 0,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finished_at` DATETIME(3) NULL,
    `error` VARCHAR(500) NULL,

    UNIQUE INDEX `settlement_batches_task_id_key`(`task_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `task_settlements` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `batch_id` BIGINT NOT NULL,
    `task_id` BIGINT NOT NULL,
    `assignment_id` BIGINT NULL,
    `kind` ENUM('BASE', 'BONUS', 'REFUND') NOT NULL,
    `amount` INTEGER NOT NULL,
    `remainder_rank` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `task_settlements_task_id_batch_id_idx`(`task_id`, `batch_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `files` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `storage_key` VARCHAR(255) NOT NULL,
    `original_name` VARCHAR(255) NOT NULL,
    `mime` VARCHAR(128) NOT NULL,
    `size_bytes` BIGINT NOT NULL,
    `sha256` CHAR(64) NOT NULL,
    `uploader_id` BIGINT NOT NULL,
    `visibility` ENUM('TASK_PUBLIC', 'TASK_PARTICIPANT', 'SUBMISSION_OWNER', 'DISPUTE_PARTY', 'ADMIN_ONLY') NOT NULL,
    `ref_type` VARCHAR(32) NULL,
    `ref_id` BIGINT NULL,
    `scan_status` ENUM('PENDING', 'CLEAN', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `files_storage_key_key`(`storage_key`),
    INDEX `files_ref_type_ref_id_idx`(`ref_type`, `ref_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `system_configs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(64) NOT NULL,
    `value_type` ENUM('INT', 'DECIMAL', 'JSON', 'STRING', 'ENUM') NOT NULL,
    `value` VARCHAR(255) NOT NULL,
    `description` VARCHAR(255) NULL,
    `updated_by` BIGINT NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `system_configs_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `actor_id` BIGINT NOT NULL,
    `actor_role` ENUM('STUDENT', 'TEACHER', 'ADMIN') NOT NULL,
    `action` VARCHAR(64) NOT NULL,
    `target_type` VARCHAR(32) NOT NULL,
    `target_id` BIGINT NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `reason` VARCHAR(255) NULL,
    `ip` VARCHAR(64) NULL,
    `user_agent` VARCHAR(255) NULL,
    `request_id` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_action_created_at_idx`(`action`, `created_at`),
    INDEX `audit_logs_actor_id_created_at_idx`(`actor_id`, `created_at`),
    INDEX `audit_logs_target_type_target_id_idx`(`target_type`, `target_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `job_runs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `job_name` VARCHAR(64) NOT NULL,
    `status` ENUM('RUNNING', 'SUCCESS', 'FAILED') NOT NULL DEFAULT 'RUNNING',
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finished_at` DATETIME(3) NULL,
    `error` VARCHAR(500) NULL,
    `meta` JSON NULL,

    INDEX `job_runs_job_name_started_at_idx`(`job_name`, `started_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `job_locks` (
    `name` VARCHAR(64) NOT NULL,
    `holder` VARCHAR(128) NULL,
    `locked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`name`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `outbox` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `channel` ENUM('EMAIL', 'IN_APP') NOT NULL,
    `recipient` VARCHAR(128) NOT NULL,
    `subject` VARCHAR(255) NULL,
    `body` TEXT NULL,
    `payload` JSON NULL,
    `status` ENUM('PENDING', 'SENT', 'FAILED', 'SKIPPED') NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `next_retry_at` DATETIME(3) NULL,
    `sent_at` DATETIME(3) NULL,
    `last_error` VARCHAR(500) NULL,
    `dedupe_key` VARCHAR(128) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `outbox_status_next_retry_at_idx`(`status`, `next_retry_at`),
    INDEX `outbox_dedupe_key_idx`(`dedupe_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `idempotency_keys` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(128) NOT NULL,
    `user_id` BIGINT NOT NULL,
    `route` VARCHAR(128) NOT NULL,
    `status_code` INTEGER NULL,
    `response_body` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,

    INDEX `idempotency_keys_expires_at_idx`(`expires_at`),
    UNIQUE INDEX `idempotency_keys_key_user_id_route_key`(`key`, `user_id`, `route`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `import_batches` ADD CONSTRAINT `import_batches_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_errors` ADD CONSTRAINT `import_errors_batch_id_fkey` FOREIGN KEY (`batch_id`) REFERENCES `import_batches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_teacher_id_fkey` FOREIGN KEY (`teacher_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tasks` ADD CONSTRAINT `tasks_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `task_categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_attachments` ADD CONSTRAINT `task_attachments_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_attachments` ADD CONSTRAINT `task_attachments_file_id_fkey` FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_assignments` ADD CONSTRAINT `task_assignments_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_assignments` ADD CONSTRAINT `task_assignments_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_events` ADD CONSTRAINT `task_events_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_events` ADD CONSTRAINT `task_events_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assignment_events` ADD CONSTRAINT `assignment_events_assignment_id_fkey` FOREIGN KEY (`assignment_id`) REFERENCES `task_assignments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assignment_events` ADD CONSTRAINT `assignment_events_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_edit_history` ADD CONSTRAINT `task_edit_history_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_edit_history` ADD CONSTRAINT `task_edit_history_editor_id_fkey` FOREIGN KEY (`editor_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `submissions` ADD CONSTRAINT `submissions_assignment_id_fkey` FOREIGN KEY (`assignment_id`) REFERENCES `task_assignments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `submissions` ADD CONSTRAINT `submissions_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `submission_files` ADD CONSTRAINT `submission_files_submission_id_fkey` FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `submission_files` ADD CONSTRAINT `submission_files_file_id_fkey` FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_submission_id_fkey` FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_assignment_id_fkey` FOREIGN KEY (`assignment_id`) REFERENCES `task_assignments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reviews` ADD CONSTRAINT `reviews_reviewer_id_fkey` FOREIGN KEY (`reviewer_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `comments` ADD CONSTRAINT `comments_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `comments` ADD CONSTRAINT `comments_author_id_fkey` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `comments` ADD CONSTRAINT `comments_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `comments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `point_legs` ADD CONSTRAINT `point_legs_transaction_id_fkey` FOREIGN KEY (`transaction_id`) REFERENCES `point_transactions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `point_legs` ADD CONSTRAINT `point_legs_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `point_accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `withdrawals` ADD CONSTRAINT `withdrawals_student_id_fkey` FOREIGN KEY (`student_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `disputes` ADD CONSTRAINT `disputes_initiator_id_fkey` FOREIGN KEY (`initiator_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `disputes` ADD CONSTRAINT `disputes_respondent_id_fkey` FOREIGN KEY (`respondent_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dispute_evidence` ADD CONSTRAINT `dispute_evidence_dispute_id_fkey` FOREIGN KEY (`dispute_id`) REFERENCES `disputes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dispute_evidence` ADD CONSTRAINT `dispute_evidence_uploader_id_fkey` FOREIGN KEY (`uploader_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `dispute_evidence` ADD CONSTRAINT `dispute_evidence_file_id_fkey` FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `announcements` ADD CONSTRAINT `announcements_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `reports` ADD CONSTRAINT `reports_reporter_id_fkey` FOREIGN KEY (`reporter_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `settlement_batches` ADD CONSTRAINT `settlement_batches_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_settlements` ADD CONSTRAINT `task_settlements_batch_id_fkey` FOREIGN KEY (`batch_id`) REFERENCES `settlement_batches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_settlements` ADD CONSTRAINT `task_settlements_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task_settlements` ADD CONSTRAINT `task_settlements_assignment_id_fkey` FOREIGN KEY (`assignment_id`) REFERENCES `task_assignments`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `files` ADD CONSTRAINT `files_uploader_id_fkey` FOREIGN KEY (`uploader_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `system_configs` ADD CONSTRAINT `system_configs_updated_by_fkey` FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actor_id_fkey` FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- 手工维护段（schema.prisma 之外，勿删；见 prisma/README.md）
-- 1) 生成列 active_flag：Prisma 不支持生成列，只能在此维护。
-- 2) uk_active* 唯一键：依赖上述生成列，保证同一学生同一任务只有一条活跃接单 /
--    同一学生同时只有一条待处理提现（PRD §5.6 / §9.2）。
-- 3) CHECK 约束：账务底线（PRD §9.2 / §9.3）。
-- ---------------------------------------------------------------------------

-- 生成列：活跃接单标记（CLAIMED/SUBMITTED/ACCEPTED/REJECTED 为活跃）
ALTER TABLE `task_assignments` ADD COLUMN `active_flag` TINYINT GENERATED ALWAYS AS (
    CASE WHEN `status` IN ('CLAIMED','SUBMITTED','ACCEPTED','REJECTED') THEN 1 ELSE NULL END
) STORED;
ALTER TABLE `task_assignments` ADD UNIQUE KEY `uk_active` (`task_id`, `student_id`, `active_flag`);

-- 生成列：待处理提现标记（PENDING/APPROVED 为活跃；PAID 占额度但不占唯一键）
ALTER TABLE `withdrawals` ADD COLUMN `active_flag` TINYINT GENERATED ALWAYS AS (
    CASE WHEN `status` IN ('PENDING','APPROVED') THEN 1 ELSE NULL END
) STORED;
ALTER TABLE `withdrawals` ADD UNIQUE KEY `uk_active_withdrawal` (`student_id`, `active_flag`);

-- tasks：待定价无资金；已定价预算 = R×N（等式只在结算前成立，由应用层断言 + 对账巡检校验）
ALTER TABLE `tasks` ADD CONSTRAINT `chk_tasks_reward_budget` CHECK (
    (`reward_per_person` IS NULL AND `total_amount` = 0 AND `refunded_amount` = 0)
    OR (`reward_per_person` >= 1 AND `total_amount` >= `reward_per_person` * `headcount`)
);
ALTER TABLE `tasks` ADD CONSTRAINT `chk_tasks_refunded_nonneg` CHECK (`refunded_amount` >= 0);
ALTER TABLE `tasks` ADD CONSTRAINT `chk_tasks_budget_nonneg` CHECK (`total_amount` - `refunded_amount` >= 0);
ALTER TABLE `tasks` ADD CONSTRAINT `chk_tasks_filled_count` CHECK (`filled_count` BETWEEN 0 AND `headcount`);

-- task_assignments：已发金额非负
ALTER TABLE `task_assignments` ADD CONSTRAINT `chk_assignments_paid_nonneg` CHECK (
    `base_paid` >= 0 AND `bonus_paid` >= 0
);

-- point_accounts：SYS_ISSUE 恒 ≤ 0 且不冻结（发行总量相反数）；其余账户非负（PRD §9.2）
ALTER TABLE `point_accounts` ADD CONSTRAINT `chk_accounts_balance` CHECK (
    (`owner_type` = 'SYS_ISSUE' AND `balance` <= 0 AND `frozen` = 0)
    OR (`owner_type` <> 'SYS_ISSUE' AND `balance` >= 0 AND `frozen` >= 0)
);
