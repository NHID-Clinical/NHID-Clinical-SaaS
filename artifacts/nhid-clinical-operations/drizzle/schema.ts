import {
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/mysql-core";
import {
  CERTIFICATION_MODULES,
  CONTENT_STATUSES,
  EMAIL_CATEGORIES,
  GRADES,
  PIPELINE_STAGES,
  USER_ROLES,
} from "../shared/domain";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", USER_ROLES).default("partner").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const partners = mysqlTable("partners", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  contactName: varchar("contactName", { length: 255 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  phone: varchar("phone", { length: 64 }),
  platform: varchar("platform", { length: 128 }).notNull(),
  estimatedCallVolume: int("estimatedCallVolume").notNull().default(0),
  useCase: text("useCase"),
  stage: mysqlEnum("stage", PIPELINE_STAGES).default("Applied").notNull(),
  owner: varchar("owner", { length: 255 }),
  risk: mysqlEnum("risk", ["Low", "Medium", "High"]).default("Low").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const partnerIntegrations = mysqlTable(
  "partnerIntegrations",
  {
    id: int("id").autoincrement().primaryKey(),
    partnerId: int("partnerId")
      .notNull()
      .references(() => partners.id, { onDelete: "cascade" }),
    checklist: text("checklist").notNull(),
    status: mysqlEnum("status", ["Not Started", "In Progress", "Complete"])
      .default("Not Started")
      .notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("partnerIntegrations_partnerId_idx").on(table.partnerId)]
);

export const callVolumes = mysqlTable(
  "callVolumes",
  {
    id: int("id").autoincrement().primaryKey(),
    partnerId: int("partnerId")
      .notNull()
      .references(() => partners.id, { onDelete: "cascade" }),
    weekStart: timestamp("weekStart").notNull(),
    totalCalls: int("totalCalls").notNull(),
    sourceFileKey: varchar("sourceFileKey", { length: 512 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    // One row per partner per week. Re-importing the same evidence file
    // updates the week in place instead of silently doubling the totals.
    unique("callVolumes_partner_week_uq").on(table.partnerId, table.weekStart),
  ]
);

export const eventLogs = mysqlTable(
  "eventLogs",
  {
    id: int("id").autoincrement().primaryKey(),
    partnerId: int("partnerId")
      .notNull()
      .references(() => partners.id, { onDelete: "cascade" }),
    eventType: varchar("eventType", { length: 128 }).notNull(),
    correlationId: varchar("correlationId", { length: 128 }).notNull(),
    payload: text("payload").notNull(),
    occurredAt: timestamp("occurredAt").notNull(),
  },
  table => [
    index("eventLogs_partnerId_idx").on(table.partnerId),
    index("eventLogs_correlationId_idx").on(table.correlationId),
  ]
);

export const communications = mysqlTable(
  "communications",
  {
    id: int("id").autoincrement().primaryKey(),
    partnerId: int("partnerId")
      .notNull()
      .references(() => partners.id, { onDelete: "cascade" }),
    type: mysqlEnum("type", ["Email", "Call", "Note"]).notNull(),
    subject: varchar("subject", { length: 255 }).notNull(),
    body: text("body"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [index("communications_partnerId_idx").on(table.partnerId)]
);

export const emailMessages = mysqlTable(
  "emailMessages",
  {
    id: int("id").autoincrement().primaryKey(),
    partnerId: int("partnerId").references(() => partners.id, {
      onDelete: "set null",
    }),
    direction: mysqlEnum("direction", ["Inbound", "Outbound"]).notNull(),
    sender: varchar("sender", { length: 320 }).notNull(),
    subject: varchar("subject", { length: 255 }).notNull(),
    body: text("body").notNull(),
    category: mysqlEnum("category", EMAIL_CATEGORIES).notNull(),
    /** 0-100 categorizer confidence. See `categorizeEmail` for how it is derived. */
    confidence: int("confidence").notNull(),
    status: mysqlEnum("status", ["Draft", "Review", "Sent"])
      .default("Draft")
      .notNull(),
    receivedAt: timestamp("receivedAt").defaultNow().notNull(),
  },
  table => [
    index("emailMessages_partnerId_idx").on(table.partnerId),
    index("emailMessages_status_idx").on(table.status),
  ]
);

export const emailTemplates = mysqlTable("emailTemplates", {
  id: int("id").autoincrement().primaryKey(),
  type: varchar("type", { length: 80 }).notNull().unique(),
  name: varchar("name", { length: 160 }).notNull(),
  subject: varchar("subject", { length: 255 }).notNull(),
  body: text("body").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const campaignDrafts = mysqlTable("campaignDrafts", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  subject: varchar("subject", { length: 255 }).notNull(),
  body: text("body").notNull(),
  status: mysqlEnum("status", ["Draft", "Review", "Scheduled"])
    .default("Draft")
    .notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const knowledgeArticles = mysqlTable(
  "knowledgeArticles",
  {
    id: int("id").autoincrement().primaryKey(),
    title: varchar("title", { length: 255 }).notNull(),
    tag: varchar("tag", { length: 80 }).notNull(),
    body: text("body").notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    // The seed backfill looks articles up by title; without this it is a scan.
    unique("knowledgeArticles_title_uq").on(table.title),
  ]
);

export const callEvaluations = mysqlTable(
  "callEvaluations",
  {
    id: int("id").autoincrement().primaryKey(),
    partnerId: int("partnerId").references(() => partners.id, {
      onDelete: "set null",
    }),
    callId: varchar("callId", { length: 128 }).notNull().unique(),
    sourceFileKey: varchar("sourceFileKey", { length: 512 }),
    transcript: text("transcript").notNull(),
    overallGrade: mysqlEnum("overallGrade", GRADES).notNull(),
    scorecard: text("scorecard").notNull(),
    evaluatedAt: timestamp("evaluatedAt").defaultNow().notNull(),
  },
  table => [index("callEvaluations_partnerId_idx").on(table.partnerId)]
);

export const trainees = mysqlTable("trainees", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  status: mysqlEnum("status", ["In Progress", "Certified"])
    .default("In Progress")
    .notNull(),
  certificateKey: varchar("certificateKey", { length: 512 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const certificationProgress = mysqlTable(
  "certificationProgress",
  {
    id: int("id").autoincrement().primaryKey(),
    traineeId: int("traineeId")
      .notNull()
      .references(() => trainees.id, { onDelete: "cascade" }),
    module: mysqlEnum("module", CERTIFICATION_MODULES).notNull(),
    score: int("score"),
    completedAt: timestamp("completedAt"),
  },
  table => [
    // A trainee completes each module at most once. This is what actually
    // prevents duplicate completions; the application check alone races.
    unique("certificationProgress_trainee_module_uq").on(
      table.traineeId,
      table.module
    ),
  ]
);

export const contentEntries = mysqlTable(
  "contentEntries",
  {
    id: int("id").autoincrement().primaryKey(),
    title: varchar("title", { length: 255 }).notNull(),
    body: text("body"),
    hashtags: text("hashtags"),
    platform: mysqlEnum("platform", ["LinkedIn", "Twitter"]).notNull(),
    status: mysqlEnum("status", CONTENT_STATUSES).notNull(),
    publishedUrl: varchar("publishedUrl", { length: 512 }),
    publishDate: timestamp("publishDate").notNull(),
  },
  table => [index("contentEntries_publishDate_idx").on(table.publishDate)]
);

/**
 * Competitors are data, not schema. `name` is a plain unique varchar so a new
 * competitor is an INSERT rather than a migration.
 */
export const competitors = mysqlTable("competitors", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 160 }).notNull().unique(),
  profile: text("profile").notNull(),
  positioning: text("positioning").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

/**
 * The feature-comparison matrix, normalized. Previously each competitor was a
 * *column*, so adding one required a migration. Now a capability is a row, and
 * each cell names its subject ("NHID-Clinical" or a competitor name).
 */
export const matrixCapabilities = mysqlTable("matrixCapabilities", {
  id: int("id").autoincrement().primaryKey(),
  capability: varchar("capability", { length: 160 }).notNull().unique(),
  sortOrder: int("sortOrder").notNull().default(0),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const matrixCells = mysqlTable(
  "matrixCells",
  {
    id: int("id").autoincrement().primaryKey(),
    capabilityId: int("capabilityId")
      .notNull()
      .references(() => matrixCapabilities.id, { onDelete: "cascade" }),
    /** "NHID-Clinical", or a value matching `competitors.name`. */
    subject: varchar("subject", { length: 160 }).notNull(),
    value: varchar("value", { length: 80 }).notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    unique("matrixCells_capability_subject_uq").on(
      table.capabilityId,
      table.subject
    ),
  ]
);

export const organizationSettings = mysqlTable("organizationSettings", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  supportEmail: varchar("supportEmail", { length: 320 }),
  billingStatus: varchar("billingStatus", { length: 80 })
    .default("Coming Soon")
    .notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
