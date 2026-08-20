CREATE TABLE `comparisonMatrix` (
	`id` int AUTO_INCREMENT NOT NULL,
	`capability` varchar(160) NOT NULL,
	`nhidClinical` varchar(80) NOT NULL,
	`hyro` varchar(80) NOT NULL,
	`orbita` varchar(80) NOT NULL,
	`credoAi` varchar(80) NOT NULL,
	`arthurAi` varchar(80) NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `comparisonMatrix_id` PRIMARY KEY(`id`),
	CONSTRAINT `comparisonMatrix_capability_unique` UNIQUE(`capability`)
);
