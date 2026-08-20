import { count, eq, sql } from "drizzle-orm";
import {
  callEvaluations,
  certificationProgress,
  communications,
  competitors,
  contentEntries,
  emailMessages,
  emailTemplates,
  eventLogs,
  knowledgeArticles,
  matrixCapabilities,
  matrixCells,
  organizationSettings,
  partners,
  trainees,
} from "../drizzle/schema";
import { CERTIFICATION_MODULES } from "../shared/domain";
import { getDb, type OperationsDb } from "./db";
import {
  seededCalendar,
  seededEmails,
  seededEvaluations,
  seededKnowledge,
  seededPartners,
} from "./operationsData";

export type SeedResult = {
  seeded: boolean;
  reason:
    | "database-unavailable"
    | "already-seeded"
    | "created"
    | "backfilled"
    | "locked";
  backfilled?: number;
};

const DEFAULT_COMPETITORS = ["Hyro", "Orbita", "Credo AI", "Arthur AI"];

const DEFAULT_MATRIX: Array<{
  capability: string;
  cells: Record<string, string>;
}> = [
  {
    capability: "Shadow Pilot delivery",
    cells: {
      "NHID-Clinical": "Primary",
      Hyro: "Adjacent",
      Orbita: "Adjacent",
      "Credo AI": "Adjacent",
      "Arthur AI": "Adjacent",
    },
  },
  {
    capability: "Five-control evidence",
    cells: {
      "NHID-Clinical": "Primary",
      Hyro: "Review",
      Orbita: "Review",
      "Credo AI": "Review",
      "Arthur AI": "Review",
    },
  },
  {
    capability: "Call-level evaluation",
    cells: {
      "NHID-Clinical": "Primary",
      Hyro: "Workflow",
      Orbita: "Workflow",
      "Credo AI": "Policy",
      "Arthur AI": "Monitoring",
    },
  },
  {
    capability: "Operational email queue",
    cells: {
      "NHID-Clinical": "Primary",
      Hyro: "—",
      Orbita: "—",
      "Credo AI": "—",
      "Arthur AI": "—",
    },
  },
];

/**
 * Serializes seeding across processes.
 *
 * Two concurrent first requests previously both passed the "is it empty"
 * check and both inserted, colliding on the unique columns. A named MySQL
 * lock means the loser waits and then observes the winner's rows.
 */
async function withSeedLock<T>(
  db: OperationsDb,
  run: () => Promise<T>
): Promise<T | null> {
  const result = await db.execute(
    sql`SELECT GET_LOCK('nhid_seed_operations', 10) AS acquired`
  );
  const rows = (
    result as unknown as Array<Array<{ acquired: number | null }>>
  )[0];
  const acquired = rows?.[0]?.acquired;
  if (acquired !== 1) return null;

  try {
    return await run();
  } finally {
    await db.execute(sql`SELECT RELEASE_LOCK('nhid_seed_operations')`);
  }
}

async function insertBaseline(db: OperationsDb) {
  await db.insert(partners).values(
    seededPartners.map(partner => ({
      name: partner.name,
      contactName: partner.contactName,
      email: partner.email,
      phone: partner.phone,
      platform: partner.platform,
      estimatedCallVolume: partner.estimatedCallVolume,
      useCase: partner.useCase,
      stage: partner.stage,
      owner: partner.owner,
      risk: partner.risk as "Low" | "Medium" | "High",
    }))
  );

  // Read the ids back rather than assuming autoincrement started at 1.
  const partnerRows = await db
    .select({ id: partners.id, name: partners.name })
    .from(partners);
  const idByName = new Map(partnerRows.map(row => [row.name, row.id]));
  const firstPartnerId = partnerRows[0]?.id;
  const secondPartnerId = partnerRows[1]?.id ?? firstPartnerId;

  await db.insert(emailMessages).values(
    seededEmails.map(email => ({
      direction: "Inbound" as const,
      sender: email.sender,
      subject: email.subject,
      body: email.preview,
      category: email.category,
      confidence: email.confidence,
      status: email.status as "Draft" | "Review" | "Sent",
      receivedAt: new Date(email.receivedAt),
    }))
  );

  await db.insert(emailTemplates).values(
    [
      "Pilot Inquiry",
      "Pricing",
      "Integration",
      "Consulting",
      "Media",
      "Investor",
      "Research",
      "Vendor",
      "General",
      "Follow-up",
    ].map(type => ({
      type,
      name: `${type} response`,
      subject: `NHID-Clinical: ${type}`,
      body: "Approved NHID-Clinical response template. Review before sending.",
    }))
  );

  await db.insert(knowledgeArticles).values(
    seededKnowledge.map(article => ({
      title: article.title,
      tag: article.tag,
      body: article.body,
      updatedAt: new Date(article.updatedAt),
    }))
  );

  await db.insert(callEvaluations).values(
    seededEvaluations.map(evaluation => ({
      partnerId: idByName.get(evaluation.partner) ?? null,
      callId: evaluation.callId,
      transcript:
        "Seeded evaluation record for operational workspace demonstration.",
      overallGrade: evaluation.overall as "A" | "B" | "C" | "F",
      scorecard: JSON.stringify([
        { code: "IDG-01", grade: evaluation.IDG, status: "evaluated" },
        { code: "PDX-01", grade: evaluation.PDX, status: "evaluated" },
        { code: "DBC-01", grade: evaluation.DBC, status: "evaluated" },
        { code: "EIT-01", grade: evaluation.EIT, status: "evaluated" },
        { code: "ATR-01", grade: evaluation.ATR, status: "evaluated" },
      ]),
      evaluatedAt: new Date(evaluation.evaluatedAt),
    }))
  );

  const traineeInsert = await db.insert(trainees).values({
    name: "Alex Morgan",
    email: "alex.morgan@example.org",
    status: "Certified",
  });
  const traineeId = Number(traineeInsert[0].insertId);

  await db.insert(certificationProgress).values(
    CERTIFICATION_MODULES.map(module => ({
      traineeId,
      module,
      score: 93,
      completedAt: new Date(),
    }))
  );

  await db.insert(contentEntries).values(
    seededCalendar.map(entry => ({
      title: entry.title,
      body: "Operational content calendar entry.",
      hashtags: entry.hashtags,
      platform: entry.platform as "LinkedIn" | "Twitter",
      status: entry.status as "Idea" | "Draft" | "Scheduled" | "Published",
      publishDate: new Date(entry.publishDate),
    }))
  );

  await db.insert(competitors).values(
    DEFAULT_COMPETITORS.map(name => ({
      name,
      profile: `${name} operational profile`,
      positioning: "Editable comparison and sales positioning note.",
    }))
  );

  await seedMatrix(db);

  if (firstPartnerId) {
    await db.insert(eventLogs).values([
      {
        partnerId: firstPartnerId,
        eventType: "pilot.started",
        correlationId: "evt-northstar-001",
        payload: JSON.stringify({ platform: "VAPI", control: "IDG-01" }),
        occurredAt: new Date(),
      },
      {
        partnerId: firstPartnerId,
        eventType: "evaluation.completed",
        correlationId: "evt-northstar-002",
        payload: JSON.stringify({
          grade: "A",
          controls: ["IDG-01", "PDX-01", "DBC-01", "EIT-01", "ATR-01"],
        }),
        occurredAt: new Date(),
      },
      {
        partnerId: secondPartnerId!,
        eventType: "integration.reviewed",
        correlationId: "evt-redwood-001",
        payload: JSON.stringify({ platform: "VAPI", state: "Vetted" }),
        occurredAt: new Date(),
      },
    ]);

    await db.insert(communications).values([
      {
        partnerId: firstPartnerId,
        type: "Email",
        subject: "Kickoff and weekly evidence cadence",
        body: "Pilot kickoff confirmed with weekly evidence review.",
      },
      {
        partnerId: firstPartnerId,
        type: "Call",
        subject: "Integration readiness review",
        body: "Reviewed disclosure and escalation-handling expectations.",
      },
      {
        partnerId: secondPartnerId!,
        type: "Note",
        subject: "Contract review follow-up",
        body: "Partner requested a scoped integration checklist.",
      },
    ]);
  }

  await db.insert(organizationSettings).values({
    name: "NHID-Clinical",
    supportEmail: "contact@nhid-clinical.org",
    billingStatus: "Coming Soon",
  });
}

async function seedMatrix(db: OperationsDb) {
  for (const [index, row] of DEFAULT_MATRIX.entries()) {
    await db
      .insert(matrixCapabilities)
      .values({ capability: row.capability, sortOrder: index })
      .onDuplicateKeyUpdate({ set: { sortOrder: index } });

    const [capability] = await db
      .select()
      .from(matrixCapabilities)
      .where(eq(matrixCapabilities.capability, row.capability))
      .limit(1);
    if (!capability) continue;

    for (const [subject, value] of Object.entries(row.cells)) {
      await db
        .insert(matrixCells)
        .values({ capabilityId: capability.id, subject, value })
        .onDuplicateKeyUpdate({ set: { value } });
    }
  }
}

/**
 * Adds records that were introduced after a database was first seeded, so an
 * existing workspace picks up new baseline content without being reset.
 */
async function backfill(db: OperationsDb): Promise<number> {
  let backfilled = 0;

  // One statement instead of one query per article.
  const existingTitles = new Set(
    (
      await db
        .select({ title: knowledgeArticles.title })
        .from(knowledgeArticles)
    ).map(row => row.title)
  );
  const missing = seededKnowledge.filter(
    article => !existingTitles.has(article.title)
  );
  if (missing.length) {
    await db.insert(knowledgeArticles).values(
      missing.map(article => ({
        title: article.title,
        tag: article.tag,
        body: article.body,
        updatedAt: new Date(article.updatedAt),
      }))
    );
    backfilled += missing.length;
  }

  const [matrixCount] = await db
    .select({ total: count() })
    .from(matrixCapabilities);
  if ((matrixCount?.total ?? 0) === 0) {
    await seedMatrix(db);
    backfilled += DEFAULT_MATRIX.length;
  }

  const [competitorCount] = await db
    .select({ total: count() })
    .from(competitors);
  if ((competitorCount?.total ?? 0) === 0) {
    await db.insert(competitors).values(
      DEFAULT_COMPETITORS.map(name => ({
        name,
        profile: `${name} operational profile`,
        positioning: "Editable comparison and sales positioning note.",
      }))
    );
    backfilled += DEFAULT_COMPETITORS.length;
  }

  return backfilled;
}

/**
 * Seeds an empty database, or backfills a previously seeded one.
 *
 * This is NOT called from request handlers any more — running it per request
 * cost every dashboard load a table count plus a lookup per knowledge article.
 * It runs once at server start (see `server/_core/index.ts`) and on demand via
 * the admin-only `operations.seed` procedure.
 */
export async function seedOperationsDatabase(): Promise<SeedResult> {
  const db = await getDb();
  if (!db) return { seeded: false, reason: "database-unavailable" };

  const result = await withSeedLock(db, async () => {
    const [existing] = await db.select({ total: count() }).from(partners);

    if ((existing?.total ?? 0) > 0) {
      const backfilled = await backfill(db);
      return {
        seeded: backfilled > 0,
        reason:
          backfilled > 0
            ? ("backfilled" as const)
            : ("already-seeded" as const),
        backfilled,
      };
    }

    await insertBaseline(db);
    return { seeded: true, reason: "created" as const };
  });

  return result ?? { seeded: false, reason: "locked" };
}

/** Admin-triggered reseed. Same routine; named so the intent reads clearly. */
export async function reseedOperationsDatabase(): Promise<SeedResult> {
  return seedOperationsDatabase();
}
