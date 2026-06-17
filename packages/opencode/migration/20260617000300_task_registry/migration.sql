CREATE TABLE `task` (
	`id` text NOT NULL,
	`session_id` text NOT NULL,
	`parent_task_id` text,
	`status` text NOT NULL,
	`summary` text NOT NULL,
	`owner` text,
	`created_at` integer NOT NULL,
	`last_event_at` integer NOT NULL,
	`ended_at` integer,
	`cleanup_after` integer,
	PRIMARY KEY(`session_id`, `id`),
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_session_idx` ON `task` (`session_id`);--> statement-breakpoint
CREATE INDEX `task_parent_idx` ON `task` (`session_id`,`parent_task_id`);--> statement-breakpoint
CREATE INDEX `task_status_idx` ON `task` (`status`);--> statement-breakpoint
CREATE TABLE `task_event` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` text NOT NULL,
	`task_id` text NOT NULL,
	`at` integer NOT NULL,
	`kind` text NOT NULL,
	`summary` text,
	FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`,`task_id`) REFERENCES `task`(`session_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_event_task_idx` ON `task_event` (`session_id`,`task_id`,`at`);
