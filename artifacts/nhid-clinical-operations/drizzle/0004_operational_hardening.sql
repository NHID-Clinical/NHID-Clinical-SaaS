-- Operational hardening.
--
-- Adds referential integrity and the uniqueness constraints the application
-- was relying on the happy path to provide, and normalizes the comparison
-- matrix so competitors are rows rather than columns.
--
-- Written by hand rather than generated so the existing comparisonMatrix
-- contents are migrated into the new tables before the old table is dropped.

--> statement-breakpoint
-- Competitors become data instead of a schema enum, so a new competitor is an
-- INSERT rather than a migration.
ALTER TABLE `competitors` MODIFY COLUMN `name` varchar(160) NOT NULL;
--> statement-breakpoint

-- Normalized comparison matrix ---------------------------------------------
CREATE TABLE `matrixCapabilities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`capability` varchar(160) NOT NULL,
	`sortOrder` int NOT NULL DEFAULT 0,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `matrixCapabilities_id` PRIMARY KEY(`id`),
	CONSTRAINT `matrixCapabilities_capability_unique` UNIQUE(`capability`)
);
--> statement-breakpoint
CREATE TABLE `matrixCells` (
	`id` int AUTO_INCREMENT NOT NULL,
	`capabilityId` int NOT NULL,
	`subject` varchar(160) NOT NULL,
	`value` varchar(80) NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `matrixCells_id` PRIMARY KEY(`id`),
	CONSTRAINT `matrixCells_capability_subject_uq` UNIQUE(`capabilityId`,`subject`)
);
--> statement-breakpoint

-- Carry the existing rows across before dropping the old shape.
INSERT INTO `matrixCapabilities` (`capability`, `sortOrder`)
	SELECT `capability`, `id` FROM `comparisonMatrix`;
--> statement-breakpoint
INSERT INTO `matrixCells` (`capabilityId`, `subject`, `value`)
	SELECT c.`id`, 'NHID-Clinical', m.`nhidClinical`
	FROM `comparisonMatrix` m
	JOIN `matrixCapabilities` c ON c.`capability` = m.`capability`;
--> statement-breakpoint
INSERT INTO `matrixCells` (`capabilityId`, `subject`, `value`)
	SELECT c.`id`, 'Hyro', m.`hyro`
	FROM `comparisonMatrix` m
	JOIN `matrixCapabilities` c ON c.`capability` = m.`capability`;
--> statement-breakpoint
INSERT INTO `matrixCells` (`capabilityId`, `subject`, `value`)
	SELECT c.`id`, 'Orbita', m.`orbita`
	FROM `comparisonMatrix` m
	JOIN `matrixCapabilities` c ON c.`capability` = m.`capability`;
--> statement-breakpoint
INSERT INTO `matrixCells` (`capabilityId`, `subject`, `value`)
	SELECT c.`id`, 'Credo AI', m.`credoAi`
	FROM `comparisonMatrix` m
	JOIN `matrixCapabilities` c ON c.`capability` = m.`capability`;
--> statement-breakpoint
INSERT INTO `matrixCells` (`capabilityId`, `subject`, `value`)
	SELECT c.`id`, 'Arthur AI', m.`arthurAi`
	FROM `comparisonMatrix` m
	JOIN `matrixCapabilities` c ON c.`capability` = m.`capability`;
--> statement-breakpoint
DROP TABLE `comparisonMatrix`;
--> statement-breakpoint

-- De-duplicate before the new unique keys are applied ------------------------
-- A trainee could previously hold several rows for the same module, and a
-- partner several rows for the same week. Keep the most recent of each.
DELETE p FROM `certificationProgress` p
	JOIN `certificationProgress` q
	ON p.`traineeId` = q.`traineeId`
	AND p.`module` = q.`module`
	AND p.`id` < q.`id`;
--> statement-breakpoint
DELETE p FROM `callVolumes` p
	JOIN `callVolumes` q
	ON p.`partnerId` = q.`partnerId`
	AND p.`weekStart` = q.`weekStart`
	AND p.`id` < q.`id`;
--> statement-breakpoint
DELETE p FROM `knowledgeArticles` p
	JOIN `knowledgeArticles` q
	ON p.`title` = q.`title`
	AND p.`id` < q.`id`;
--> statement-breakpoint

-- Drop rows that reference a partner or trainee that no longer exists, so the
-- foreign keys below can be created.
DELETE FROM `partnerIntegrations` WHERE `partnerId` NOT IN (SELECT `id` FROM `partners`);
--> statement-breakpoint
DELETE FROM `callVolumes` WHERE `partnerId` NOT IN (SELECT `id` FROM `partners`);
--> statement-breakpoint
DELETE FROM `eventLogs` WHERE `partnerId` NOT IN (SELECT `id` FROM `partners`);
--> statement-breakpoint
DELETE FROM `communications` WHERE `partnerId` NOT IN (SELECT `id` FROM `partners`);
--> statement-breakpoint
DELETE FROM `certificationProgress` WHERE `traineeId` NOT IN (SELECT `id` FROM `trainees`);
--> statement-breakpoint
UPDATE `emailMessages` SET `partnerId` = NULL WHERE `partnerId` IS NOT NULL AND `partnerId` NOT IN (SELECT `id` FROM `partners`);
--> statement-breakpoint
UPDATE `callEvaluations` SET `partnerId` = NULL WHERE `partnerId` IS NOT NULL AND `partnerId` NOT IN (SELECT `id` FROM `partners`);
--> statement-breakpoint

-- Uniqueness -----------------------------------------------------------------
ALTER TABLE `certificationProgress` ADD CONSTRAINT `certificationProgress_trainee_module_uq` UNIQUE(`traineeId`,`module`);
--> statement-breakpoint
ALTER TABLE `callVolumes` ADD CONSTRAINT `callVolumes_partner_week_uq` UNIQUE(`partnerId`,`weekStart`);
--> statement-breakpoint
ALTER TABLE `knowledgeArticles` ADD CONSTRAINT `knowledgeArticles_title_uq` UNIQUE(`title`);
--> statement-breakpoint

-- Indexes --------------------------------------------------------------------
CREATE INDEX `partnerIntegrations_partnerId_idx` ON `partnerIntegrations` (`partnerId`);
--> statement-breakpoint
CREATE INDEX `eventLogs_partnerId_idx` ON `eventLogs` (`partnerId`);
--> statement-breakpoint
CREATE INDEX `eventLogs_correlationId_idx` ON `eventLogs` (`correlationId`);
--> statement-breakpoint
CREATE INDEX `communications_partnerId_idx` ON `communications` (`partnerId`);
--> statement-breakpoint
CREATE INDEX `emailMessages_partnerId_idx` ON `emailMessages` (`partnerId`);
--> statement-breakpoint
CREATE INDEX `emailMessages_status_idx` ON `emailMessages` (`status`);
--> statement-breakpoint
CREATE INDEX `callEvaluations_partnerId_idx` ON `callEvaluations` (`partnerId`);
--> statement-breakpoint
CREATE INDEX `contentEntries_publishDate_idx` ON `contentEntries` (`publishDate`);
--> statement-breakpoint

-- Referential integrity ------------------------------------------------------
ALTER TABLE `partnerIntegrations` ADD CONSTRAINT `partnerIntegrations_partnerId_partners_id_fk` FOREIGN KEY (`partnerId`) REFERENCES `partners`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `callVolumes` ADD CONSTRAINT `callVolumes_partnerId_partners_id_fk` FOREIGN KEY (`partnerId`) REFERENCES `partners`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `eventLogs` ADD CONSTRAINT `eventLogs_partnerId_partners_id_fk` FOREIGN KEY (`partnerId`) REFERENCES `partners`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `communications` ADD CONSTRAINT `communications_partnerId_partners_id_fk` FOREIGN KEY (`partnerId`) REFERENCES `partners`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `emailMessages` ADD CONSTRAINT `emailMessages_partnerId_partners_id_fk` FOREIGN KEY (`partnerId`) REFERENCES `partners`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `callEvaluations` ADD CONSTRAINT `callEvaluations_partnerId_partners_id_fk` FOREIGN KEY (`partnerId`) REFERENCES `partners`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `certificationProgress` ADD CONSTRAINT `certificationProgress_traineeId_trainees_id_fk` FOREIGN KEY (`traineeId`) REFERENCES `trainees`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `matrixCells` ADD CONSTRAINT `matrixCells_capabilityId_matrixCapabilities_id_fk` FOREIGN KEY (`capabilityId`) REFERENCES `matrixCapabilities`(`id`) ON DELETE cascade ON UPDATE no action;
