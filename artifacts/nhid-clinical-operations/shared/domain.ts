export const PIPELINE_STAGES = [
  "Applied",
  "Vetted",
  "Contract Sent",
  "Integrated",
  "Live",
  "Reporting",
  "Complete",
] as const;

export const EMAIL_CATEGORIES = [
  "Pilot Inquiry",
  "Pricing",
  "Integration",
  "Consulting",
  "Media",
  "Investor",
  "Research",
  "Vendor",
  "General",
] as const;

export const POLICY_CODES = [
  "IDG-01",
  "PDX-01",
  "DBC-01",
  "EIT-01",
  "ATR-01",
] as const;
export const GRADES = ["A", "B", "C", "F"] as const;

/**
 * Whether a control produced a judgement at all.
 *
 * `not-evaluated` is the important one: it means the transcript contained no
 * trigger for this control (nobody asked for PHI, nobody asked to escalate).
 * That is NOT the same as compliance, so `not-evaluated` controls are excluded
 * from the overall grade rather than silently scoring an A.
 */
export const CONTROL_STATUSES = ["evaluated", "not-evaluated"] as const;
export const CERTIFICATION_MODULES = [
  "101",
  "102",
  "103",
  "104",
  "105",
  "106",
  "107",
] as const;
export const CONTENT_STATUSES = [
  "Idea",
  "Draft",
  "Scheduled",
  "Published",
] as const;
export const COMPETITORS = ["Hyro", "Orbita", "Credo AI", "Arthur AI"] as const;
export const USER_ROLES = ["admin", "consultant", "partner"] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];
export type EmailCategory = (typeof EMAIL_CATEGORIES)[number];
export type PolicyCode = (typeof POLICY_CODES)[number];
export type Grade = (typeof GRADES)[number];
export type UserRole = (typeof USER_ROLES)[number];
export type ControlStatus = (typeof CONTROL_STATUSES)[number];
export type CertificationModule = (typeof CERTIFICATION_MODULES)[number];
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

/** Roles permitted to operate the internal Shadow Pilot workspace. */
export const STAFF_ROLES = [
  "admin",
  "consultant",
] as const satisfies readonly UserRole[];
