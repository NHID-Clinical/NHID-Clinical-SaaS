CREATE TABLE `campaignDrafts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(160) NOT NULL,
	`subject` varchar(255) NOT NULL,
	`body` text NOT NULL,
	`status` enum('Draft','Review','Scheduled') NOT NULL DEFAULT 'Draft',
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `campaignDrafts_id` PRIMARY KEY(`id`)
);
