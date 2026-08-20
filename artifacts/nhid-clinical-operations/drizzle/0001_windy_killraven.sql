CREATE TABLE `callEvaluations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerId` int,
	`callId` varchar(128) NOT NULL,
	`sourceFileKey` varchar(512),
	`transcript` text NOT NULL,
	`overallGrade` enum('A','B','C','F') NOT NULL,
	`scorecard` text NOT NULL,
	`evaluatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `callEvaluations_id` PRIMARY KEY(`id`),
	CONSTRAINT `callEvaluations_callId_unique` UNIQUE(`callId`)
);
--> statement-breakpoint
CREATE TABLE `callVolumes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerId` int NOT NULL,
	`weekStart` timestamp NOT NULL,
	`totalCalls` int NOT NULL,
	`sourceFileKey` varchar(512),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `callVolumes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `certificationProgress` (
	`id` int AUTO_INCREMENT NOT NULL,
	`traineeId` int NOT NULL,
	`module` enum('101','102','103','104','105','106','107') NOT NULL,
	`score` int,
	`completedAt` timestamp,
	CONSTRAINT `certificationProgress_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `communications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerId` int NOT NULL,
	`type` enum('Email','Call','Note') NOT NULL,
	`subject` varchar(255) NOT NULL,
	`body` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `communications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `competitors` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` enum('Hyro','Orbita','Credo AI','Arthur AI') NOT NULL,
	`profile` text NOT NULL,
	`positioning` text NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `competitors_id` PRIMARY KEY(`id`),
	CONSTRAINT `competitors_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `contentEntries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`body` text,
	`hashtags` text,
	`platform` enum('LinkedIn','Twitter') NOT NULL,
	`status` enum('Idea','Draft','Scheduled','Published') NOT NULL,
	`publishedUrl` varchar(512),
	`publishDate` timestamp NOT NULL,
	CONSTRAINT `contentEntries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `emailMessages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerId` int,
	`direction` enum('Inbound','Outbound') NOT NULL,
	`sender` varchar(320) NOT NULL,
	`subject` varchar(255) NOT NULL,
	`body` text NOT NULL,
	`category` enum('Pilot Inquiry','Pricing','Integration','Consulting','Media','Investor','Research','Vendor','General') NOT NULL,
	`confidence` int NOT NULL,
	`status` enum('Draft','Review','Sent') NOT NULL DEFAULT 'Draft',
	`receivedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `emailMessages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `emailTemplates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`type` varchar(80) NOT NULL,
	`name` varchar(160) NOT NULL,
	`subject` varchar(255) NOT NULL,
	`body` text NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `emailTemplates_id` PRIMARY KEY(`id`),
	CONSTRAINT `emailTemplates_type_unique` UNIQUE(`type`)
);
--> statement-breakpoint
CREATE TABLE `eventLogs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerId` int NOT NULL,
	`eventType` varchar(128) NOT NULL,
	`correlationId` varchar(128) NOT NULL,
	`payload` text NOT NULL,
	`occurredAt` timestamp NOT NULL,
	CONSTRAINT `eventLogs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `knowledgeArticles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`tag` varchar(80) NOT NULL,
	`body` text NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `knowledgeArticles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `organizationSettings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`supportEmail` varchar(320),
	`billingStatus` varchar(80) NOT NULL DEFAULT 'Coming Soon',
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `organizationSettings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `partnerIntegrations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`partnerId` int NOT NULL,
	`checklist` text NOT NULL,
	`status` enum('Not Started','In Progress','Complete') NOT NULL DEFAULT 'Not Started',
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `partnerIntegrations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `partners` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`contactName` varchar(255) NOT NULL,
	`email` varchar(320) NOT NULL,
	`phone` varchar(64),
	`platform` varchar(128) NOT NULL,
	`estimatedCallVolume` int NOT NULL DEFAULT 0,
	`useCase` text,
	`stage` enum('Applied','Vetted','Contract Sent','Integrated','Live','Reporting','Complete') NOT NULL DEFAULT 'Applied',
	`owner` varchar(255),
	`risk` enum('Low','Medium','High') NOT NULL DEFAULT 'Low',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `partners_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `trainees` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`email` varchar(320) NOT NULL,
	`status` enum('In Progress','Certified') NOT NULL DEFAULT 'In Progress',
	`certificateKey` varchar(512),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `trainees_id` PRIMARY KEY(`id`),
	CONSTRAINT `trainees_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('admin','consultant','partner') NOT NULL DEFAULT 'partner';