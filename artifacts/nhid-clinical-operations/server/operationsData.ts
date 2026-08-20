import { asc, desc } from "drizzle-orm";
import {
  PIPELINE_STAGES,
  POLICY_CODES,
  type PipelineStage,
} from "../shared/domain";
import {
  callEvaluations,
  callVolumes,
  contentEntries,
  emailMessages,
  partners,
} from "../drizzle/schema";
import type { OperationsDb } from "./db";
import { CONTENT_STATUSES, EMAIL_CATEGORIES } from "../shared/domain";

const now = Date.now();

export const seededPartners = [
  {
    id: 1,
    name: "Northstar Family Health",
    contactName: "Maya Chen",
    email: "maya@northstar.example",
    phone: "+1 617 555 0138",
    platform: "Twilio",
    estimatedCallVolume: 12400,
    useCase: "Patient access and appointment routing",
    stage: "Live" as const,
    owner: "A. Rivera",
    lastActivity: now - 1000 * 60 * 48,
    risk: "Low",
  },
  {
    id: 2,
    name: "Harbor Oncology Network",
    contactName: "Jordan Wright",
    email: "jordan@harboroncology.example",
    phone: "+1 212 555 0174",
    platform: "Amazon Connect",
    estimatedCallVolume: 8800,
    useCase: "Referral and care-navigation workflows",
    stage: "Integrated" as const,
    owner: "K. Shah",
    lastActivity: now - 1000 * 60 * 60 * 5,
    risk: "Medium",
  },
  {
    id: 3,
    name: "Redwood Community Care",
    contactName: "Elena Morales",
    email: "elena@redwoodcare.example",
    phone: "+1 415 555 0199",
    platform: "VAPI",
    estimatedCallVolume: 5100,
    useCase: "After-hours nurse-line intake",
    stage: "Vetted" as const,
    owner: "A. Rivera",
    lastActivity: now - 1000 * 60 * 60 * 20,
    risk: "Low",
  },
];

const emailSubjects = [
  "Shadow Pilot inquiry for patient access workflow",
  "Question about production packaging",
  "Amazon Connect integration checklist",
  "Consulting engagement scope",
  "Request for an expert comment",
  "Investor update request",
  "Research collaboration proposal",
  "Vendor security questionnaire",
  "General platform overview request",
  "Pilot timeline and deliverables",
  "Pricing follow-up",
  "VAPI disclosure configuration",
  "Training and certification options",
  "Media briefing availability",
  "Implementation documentation request",
];

export const seededEmails = emailSubjects.map((subject, index) => ({
  id: index + 1,
  sender: `contact${index + 1}@example.org`,
  senderName: ["Alex", "Jordan", "Maya", "Sam", "Dana"][index % 5] + " Example",
  subject,
  preview:
    "Please share the appropriate next step and relevant NHID-Clinical materials for our team.",
  category: EMAIL_CATEGORIES[index % EMAIL_CATEGORIES.length],
  confidence: 94 - (index % 5) * 3,
  status: index < 4 ? "Review" : index < 10 ? "Draft" : "Sent",
  receivedAt: now - 1000 * 60 * 60 * (index + 2),
}));

export const seededKnowledge = [
  {
    id: 1,
    title: "What is NHID-Clinical?",
    tag: "Foundation",
    updatedAt: now - 86400000,
    body: "NHID-Clinical is an operational assurance framework for healthcare AI interactions, designed to make disclosure, escalation, auditability, and deceptive-artifact controls visible and testable.",
  },
  {
    id: 2,
    title: "The Five Controls",
    tag: "Controls",
    updatedAt: now - 86400000 * 2,
    body: "IDG-01 governs disclosure; PDX-01 governs protected-information requests; DBC-01 detects deceptive artifacts; EIT-01 validates escalation; ATR-01 validates the audit trail.",
  },
  {
    id: 3,
    title: "Shadow Pilot Process",
    tag: "Process",
    updatedAt: now - 86400000 * 3,
    body: "A Shadow Pilot is a 30-day operational assessment including intake, configuration review, sampled evaluation, weekly reporting, and a close-out report.",
  },
  {
    id: 4,
    title: "Twilio Integration Guide",
    tag: "Integration",
    updatedAt: now - 86400000 * 4,
    body: "Capture transcript and event metadata, maintain correlation IDs, and preserve disclosure and escalation signals.",
  },
  {
    id: 5,
    title: "VAPI Integration Guide",
    tag: "Integration",
    updatedAt: now - 86400000 * 5,
    body: "Map assistant events to the common event log and retain the original call and escalation identifiers.",
  },
  {
    id: 6,
    title: "Amazon Connect Integration Guide",
    tag: "Integration",
    updatedAt: now - 86400000 * 6,
    body: "Export contact traces and transcript events with stable identifiers for audit-trail reconciliation.",
  },
  {
    id: 7,
    title: "Retell Integration Guide",
    tag: "Integration",
    updatedAt: now - 86400000 * 7,
    body: "Ensure disclosure events, transfer requests, and recording metadata are attached to the same evaluation trace.",
  },
  {
    id: 8,
    title: "Pricing & Packaging",
    tag: "Commercial",
    updatedAt: now - 86400000 * 8,
    body: "Shadow Pilot is free. Production packaging is TBD. Consulting engagements are custom-scoped.",
  },
  {
    id: 9,
    title: "Impersonation Latency",
    tag: "Terminology",
    updatedAt: now - 86400000 * 9,
    body: "Impersonation latency is the time between an interaction beginning and a user receiving a clear, understandable disclosure about the automated system.",
  },
  {
    id: 10,
    title: "Tier 0 vs Tier 1",
    tag: "Terminology",
    updatedAt: now - 86400000 * 10,
    body: "Tier 0 describes baseline operational visibility: clear disclosure, traceable events, and controlled evidence collection. Tier 1 adds repeatable evaluation, exception handling, escalation testing, reporting cadence, and accountable operational ownership.",
  },
  {
    id: 11,
    title: "FAQ: Controls, Tiers, and Readiness",
    tag: "FAQ",
    updatedAt: now - 86400000 * 11,
    body: "1. What is a Shadow Pilot? A 30-day operational assessment. 2. Is it free? Yes. 3. What is IDG-01? Disclosure control. 4. What is PDX-01? PHI-request timing control. 5. What is DBC-01? Deceptive-artifact control. 6. What is EIT-01? Escalation integrity control. 7. What is ATR-01? Audit-trail control. 8. What is Tier 0? Baseline visibility. 9. What is Tier 1? Repeatable managed readiness. 10. What is impersonation latency? Time until clear disclosure. 11. Which platforms are supported? Twilio, VAPI, Amazon Connect, and Retell. 12. What evidence is reviewed? Transcript and event evidence. 13. Are calls scored? Yes, with A, B, C, or F. 14. Is production pricing set? It is TBD. 15. Is consulting available? Yes, custom-scoped. 16. Are emails sent automatically? No, human review is required. 17. Is escalation tested? Yes, through EIT-01. 18. Are reports provided? Yes, on a weekly and close-out cadence. 19. Can operational teams search guidance? Yes, in the internal knowledge base. 20. What happens after the pilot? Results inform the appropriate production-readiness next step.",
  },
];

export const seededEvaluations = [
  {
    id: 1,
    callId: "NSF-4821",
    partner: "Northstar Family Health",
    overall: "A",
    IDG: "A",
    PDX: "A",
    DBC: "A",
    EIT: "B",
    ATR: "A",
    evaluatedAt: now - 1000 * 60 * 90,
  },
  {
    id: 2,
    callId: "HON-1107",
    partner: "Harbor Oncology Network",
    overall: "B",
    IDG: "A",
    PDX: "B",
    DBC: "A",
    EIT: "B",
    ATR: "B",
    evaluatedAt: now - 1000 * 60 * 180,
  },
  {
    id: 3,
    callId: "RCC-0830",
    partner: "Redwood Community Care",
    overall: "C",
    IDG: "C",
    PDX: "A",
    DBC: "A",
    EIT: "B",
    ATR: "B",
    evaluatedAt: now - 1000 * 60 * 330,
  },
  {
    id: 4,
    callId: "NSF-4812",
    partner: "Northstar Family Health",
    overall: "A",
    IDG: "A",
    PDX: "A",
    DBC: "A",
    EIT: "A",
    ATR: "A",
    evaluatedAt: now - 1000 * 60 * 480,
  },
  {
    id: 5,
    callId: "HON-1092",
    partner: "Harbor Oncology Network",
    overall: "F",
    IDG: "F",
    PDX: "B",
    DBC: "A",
    EIT: "C",
    ATR: "B",
    evaluatedAt: now - 1000 * 60 * 720,
  },
];

export const seededCalendar = Array.from({ length: 30 }, (_, index) => ({
  id: index + 1,
  title: [
    "Control explainer",
    "Shadow Pilot insight",
    "Integration field note",
    "FAQ spotlight",
    "Operator briefing",
  ][index % 5],
  platform: index % 3 === 0 ? "Twitter" : "LinkedIn",
  status: CONTENT_STATUSES[index % CONTENT_STATUSES.length],
  publishDate: now + index * 86400000,
  hashtags: "#HealthcareAI #ClinicalOperations #NHIDClinical",
}));

export const violationTrend = Array.from({ length: 8 }, (_, index) => ({
  week: `W${index + 1}`,
  "IDG-01": [9, 7, 6, 5, 4, 3, 3, 2][index],
  "PDX-01": [4, 5, 3, 4, 3, 2, 1, 1][index],
  "DBC-01": [3, 2, 3, 2, 2, 1, 1, 0][index],
  "EIT-01": [7, 5, 6, 4, 3, 3, 2, 2][index],
  "ATR-01": [5, 4, 3, 2, 3, 2, 1, 1][index],
}));

/**
 * Live dashboard aggregate.
 *
 * Everything here is computed from the operations tables. It previously
 * returned the seed constants above, so the dashboard showed the same three
 * partners and a hardcoded 92% pass rate no matter what the database held.
 */
export async function dashboardSnapshot(db: OperationsDb) {
  const [partnerRows, emailRows, evaluationRows, calendarRows, volumeRows] =
    await Promise.all([
      db.select().from(partners).orderBy(desc(partners.updatedAt)),
      db.select().from(emailMessages).orderBy(desc(emailMessages.receivedAt)),
      db
        .select()
        .from(callEvaluations)
        .orderBy(desc(callEvaluations.evaluatedAt)),
      db.select().from(contentEntries).orderBy(asc(contentEntries.publishDate)),
      db.select().from(callVolumes).orderBy(asc(callVolumes.weekStart)),
    ]);

  const graded = evaluationRows.length;
  const passing = evaluationRows.filter(row => row.overallGrade === "A").length;

  return {
    partners: partnerRows,
    emails: emailRows,
    evaluations: evaluationRows,
    calendar: calendarRows,
    callVolumes: volumeRows,
    violationTrend: buildViolationTrend(evaluationRows),
    pipeline: PIPELINE_STAGES.map(stage => ({
      stage,
      count: partnerRows.filter(partner => partner.stage === stage).length,
    })),
    metrics: {
      activePartners: partnerRows.filter(partner =>
        (["Integrated", "Live", "Reporting"] as PipelineStage[]).includes(
          partner.stage
        )
      ).length,
      pendingReview: emailRows.filter(email => email.status === "Review")
        .length,
      evaluatedCalls: graded,
      /** Share of evaluated calls with an overall A. Null when nothing is scored yet. */
      controlPassRate: graded ? Math.round((passing / graded) * 100) : null,
    },
    policyCodes: POLICY_CODES,
  };
}

/**
 * Failures per control over the last eight ISO weeks, read out of the stored
 * scorecards. `not-evaluated` controls are skipped — they are not passes and
 * they are not failures.
 */
function buildViolationTrend(
  rows: Array<{ evaluatedAt: Date; scorecard: string }>
) {
  const weeks = new Map<string, Record<string, number>>();

  rows.forEach(row => {
    const week = isoWeekKey(row.evaluatedAt);
    const bucket =
      weeks.get(week) ??
      Object.fromEntries(POLICY_CODES.map(code => [code, 0]));

    let results: Array<{ code: string; grade: string; status?: string }> = [];
    try {
      const parsed = JSON.parse(row.scorecard);
      if (Array.isArray(parsed)) results = parsed;
    } catch {
      // A scorecard we cannot read contributes nothing rather than throwing.
      return;
    }

    results.forEach(result => {
      if (result.status === "not-evaluated") return;
      if (result.grade === "A") return;
      if (!(result.code in bucket)) return;
      bucket[result.code] += 1;
    });

    weeks.set(week, bucket);
  });

  return [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-8)
    .map(([week, counts]) => ({ week, ...counts }));
}

function isoWeekKey(date: Date): string {
  const target = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
