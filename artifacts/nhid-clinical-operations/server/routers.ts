import { COOKIE_NAME } from "@shared/const";
import {
  CERTIFICATION_MODULES,
  CONTENT_STATUSES,
  EMAIL_CATEGORIES,
  PIPELINE_STAGES,
  USER_ROLES,
} from "@shared/domain";
import { TRPCError } from "@trpc/server";
import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  callEvaluations,
  callVolumes,
  campaignDrafts,
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
  users,
} from "../drizzle/schema";
import { getDb } from "./db";
import { getSessionCookieOptions } from "./_core/cookies";
import { invokeLLM } from "./_core/llm";
import { systemRouter } from "./_core/systemRouter";
import {
  adminProcedure,
  protectedProcedure,
  publicProcedure,
  router,
  staffProcedure,
} from "./_core/trpc";
import { dashboardSnapshot } from "./operationsData";
import { CallVolumeCsvError, parseCallVolumeCsv } from "./callVolumeCsv";
import {
  buildKnowledgeGroundedDraft,
  categorizeEmail,
  evaluateTranscript,
} from "./policyEngine";
import { reseedOperationsDatabase } from "./seedOperations";
import { storagePut } from "./storage";

/**
 * Every procedure that touches persistence goes through this. A missing
 * database is a server misconfiguration, so it fails loudly with a typed error
 * rather than degrading to empty results that look like an empty workspace.
 */
async function requireDb() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "The operations database is not configured.",
    });
  }
  return db;
}

function notFound(what: string): never {
  throw new TRPCError({ code: "NOT_FOUND", message: `${what} was not found.` });
}

export const appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  operations: router({
    snapshot: staffProcedure.query(async () => {
      const db = await requireDb();
      return dashboardSnapshot(db);
    }),
    /** Reseeding rewrites demo content, so it is admin-only and explicit. */
    seed: adminProcedure.mutation(() => reseedOperationsDatabase()),
  }),
  partners: router({
    /**
     * The one genuinely public write in the application: the partner
     * application form. It persists an Applied partner and records an intake
     * event so the submission is auditable.
     */
    publicIntake: publicProcedure
      .input(
        z.object({
          name: z.string().min(2).max(255),
          contactName: z.string().min(2).max(255),
          email: z.string().email().max(320),
          phone: z.string().max(64).optional(),
          platform: z.enum([
            "Twilio",
            "VAPI",
            "Amazon Connect",
            "Retell",
            "Other",
          ]),
          estimatedCallVolume: z.number().int().nonnegative().max(100_000_000),
          useCase: z.string().min(3).max(5_000),
        })
      )
      .mutation(async ({ input }) => {
        const db = await requireDb();

        const inserted = await db.insert(partners).values({
          name: input.name,
          contactName: input.contactName,
          email: input.email,
          phone: input.phone ?? null,
          platform: input.platform,
          estimatedCallVolume: input.estimatedCallVolume,
          useCase: input.useCase,
          stage: "Applied",
          risk: "Low",
        });

        const partnerId = Number(inserted[0].insertId);

        await db.insert(eventLogs).values({
          partnerId,
          eventType: "partner.applied",
          correlationId: `intake-${partnerId}-${Date.now()}`,
          payload: JSON.stringify({
            platform: input.platform,
            estimatedCallVolume: input.estimatedCallVolume,
            source: "public-intake",
          }),
          occurredAt: new Date(),
        });

        return { success: true, partnerId, stage: "Applied" as const };
      }),
    list: staffProcedure.query(async () => {
      const db = await requireDb();
      return db.select().from(partners).orderBy(desc(partners.updatedAt));
    }),
    detail: staffProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .query(async ({ input }) => {
        const db = await requireDb();
        const [partner] = await db
          .select()
          .from(partners)
          .where(eq(partners.id, input.id))
          .limit(1);
        if (!partner) notFound("Partner");

        const [events, timeline, volumes] = await Promise.all([
          db
            .select()
            .from(eventLogs)
            .where(eq(eventLogs.partnerId, input.id))
            .orderBy(desc(eventLogs.occurredAt)),
          db
            .select()
            .from(communications)
            .where(eq(communications.partnerId, input.id))
            .orderBy(desc(communications.createdAt)),
          db
            .select()
            .from(callVolumes)
            .where(eq(callVolumes.partnerId, input.id))
            .orderBy(asc(callVolumes.weekStart)),
        ]);

        return {
          partner,
          events,
          communications: timeline,
          callVolumes: volumes,
        };
      }),
    moveStage: staffProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          stage: z.enum(PIPELINE_STAGES),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const db = await requireDb();
        const [existing] = await db
          .select()
          .from(partners)
          .where(eq(partners.id, input.id))
          .limit(1);
        if (!existing) notFound("Partner");

        await db
          .update(partners)
          .set({ stage: input.stage })
          .where(eq(partners.id, input.id));

        // Stage transitions are audit-relevant, so they leave a trail.
        await db.insert(eventLogs).values({
          partnerId: input.id,
          eventType: "partner.stage_changed",
          correlationId: `stage-${input.id}-${Date.now()}`,
          payload: JSON.stringify({
            from: existing.stage,
            to: input.stage,
            actor: ctx.user.openId,
          }),
          occurredAt: new Date(),
        });

        return { success: true, id: input.id, stage: input.stage };
      }),
    importCallVolume: staffProcedure
      .input(
        z.object({
          partnerId: z.number().int().positive(),
          fileName: z.string().min(5).max(160),
          csvContent: z.string().min(6).max(1_000_000),
        })
      )
      .mutation(async ({ input }) => {
        if (!input.fileName.toLowerCase().endsWith(".csv")) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Only CSV call-volume files are accepted.",
          });
        }

        const db = await requireDb();
        const [partner] = await db
          .select()
          .from(partners)
          .where(eq(partners.id, input.partnerId))
          .limit(1);
        if (!partner) notFound("Partner");

        let summary;
        try {
          summary = parseCallVolumeCsv(input.csvContent);
        } catch (error) {
          if (error instanceof CallVolumeCsvError) {
            // Surface the precise reason so the operator can fix the file.
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: error.message,
            });
          }
          throw error;
        }

        // Only the basename reaches the storage key, so a crafted filename
        // cannot walk out of the partner's prefix.
        const safeName =
          (input.fileName.split(/[\\/]/).pop() ?? "")
            .replace(/[^A-Za-z0-9._-]/g, "_")
            .replace(/^\.+/, "") || "call-volumes.csv";

        const stored = await storagePut(
          `partner-call-volumes/${input.partnerId}/${safeName}`,
          input.csvContent,
          "text/csv"
        );

        // Re-importing a corrected file updates each week in place rather than
        // doubling the totals (unique on partnerId+weekStart).
        for (const week of summary.weeks) {
          await db
            .insert(callVolumes)
            .values({
              partnerId: input.partnerId,
              weekStart: week.weekStart,
              totalCalls: week.totalCalls,
              sourceFileKey: stored.key,
            })
            .onDuplicateKeyUpdate({
              set: { totalCalls: week.totalCalls, sourceFileKey: stored.key },
            });
        }

        await db.insert(eventLogs).values({
          partnerId: input.partnerId,
          eventType: "callvolume.imported",
          correlationId: stored.key,
          payload: JSON.stringify({
            rows: summary.rows,
            weeks: summary.weeks.length,
            totalCalls: summary.totalCalls,
          }),
          occurredAt: new Date(),
        });

        return {
          success: true,
          rows: summary.rows,
          weeks: summary.weeks.length,
          totalCalls: summary.totalCalls,
          storageKey: stored.key,
          storageUrl: stored.url,
        };
      }),
  }),
  email: router({
    inbox: staffProcedure.query(async () => {
      const db = await requireDb();
      return db
        .select()
        .from(emailMessages)
        .orderBy(desc(emailMessages.receivedAt));
    }),
    categorize: staffProcedure
      .input(z.object({ subject: z.string().min(1), body: z.string().min(1) }))
      .query(({ input }) => categorizeEmail(input.subject, input.body)),
    applyCategory: staffProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          category: z.enum(EMAIL_CATEGORIES),
        })
      )
      .mutation(async ({ input }) => {
        const db = await requireDb();
        await db
          .update(emailMessages)
          .set({ category: input.category })
          .where(eq(emailMessages.id, input.id));
        return { success: true };
      }),
    generateDraft: staffProcedure
      .input(
        z.object({
          senderName: z.string().min(1).max(255),
          subject: z.string().min(1).max(255),
          category: z.enum(EMAIL_CATEGORIES),
        })
      )
      .mutation(async ({ input }) => {
        const fallback = buildKnowledgeGroundedDraft(input);
        try {
          const completion = await invokeLLM({
            maxTokens: 320,
            messages: [
              {
                role: "system",
                content:
                  "You draft concise, professional internal-business email responses. Use only the stated NHID-Clinical context. Do not promise outcomes, make medical claims, or send anything automatically.",
              },
              {
                role: "user",
                content: `Email category: ${input.category}\nSubject: ${input.subject}\nRecipient: ${input.senderName}\n\nApproved knowledge context:\nShadow Pilot is free and lasts 30 days: intake, configuration review, sampled evaluation, weekly reporting, close-out report. Production is TBD. Consulting is custom. The five controls are IDG-01, PDX-01, DBC-01, EIT-01, and ATR-01.\n\nWrite a 120-word or shorter draft response.`,
              },
            ],
          });
          const content = completion.choices[0]?.message.content;
          const draft =
            typeof content === "string" && content.trim().length > 30
              ? content.trim()
              : fallback;
          return {
            draft,
            source:
              draft === fallback ? ("fallback" as const) : ("ai" as const),
            status: "Review" as const,
          };
        } catch {
          return {
            draft: fallback,
            source: "fallback" as const,
            status: "Review" as const,
          };
        }
      }),
    templates: staffProcedure.query(async () => {
      const db = await requireDb();
      return db.select().from(emailTemplates).orderBy(asc(emailTemplates.type));
    }),
    saveTemplate: staffProcedure
      .input(
        z.object({
          id: z.number().int().positive().optional(),
          type: z.string().min(2).max(80),
          name: z.string().min(2).max(160),
          subject: z.string().min(2).max(255),
          body: z.string().min(4),
        })
      )
      .mutation(async ({ input }) => {
        const db = await requireDb();
        const value = {
          type: input.type,
          name: input.name,
          subject: input.subject,
          body: input.body,
        };
        if (input.id) {
          await db
            .update(emailTemplates)
            .set(value)
            .where(eq(emailTemplates.id, input.id));
        } else {
          await db.insert(emailTemplates).values(value);
        }
        return { success: true };
      }),
    deleteTemplate: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        const db = await requireDb();
        await db.delete(emailTemplates).where(eq(emailTemplates.id, input.id));
        return { success: true };
      }),
    campaignDrafts: staffProcedure.query(async () => {
      const db = await requireDb();
      return db
        .select()
        .from(campaignDrafts)
        .orderBy(desc(campaignDrafts.updatedAt));
    }),
    saveCampaignDraft: staffProcedure
      .input(
        z.object({
          id: z.number().int().positive().optional(),
          name: z.string().min(2).max(160),
          subject: z.string().min(2).max(255),
          body: z.string().min(4),
          status: z.enum(["Draft", "Review", "Scheduled"]),
        })
      )
      .mutation(async ({ input }) => {
        const db = await requireDb();
        const value = {
          name: input.name,
          subject: input.subject,
          body: input.body,
          status: input.status,
        };
        if (input.id) {
          await db
            .update(campaignDrafts)
            .set(value)
            .where(eq(campaignDrafts.id, input.id));
        } else {
          await db.insert(campaignDrafts).values(value);
        }
        return { success: true };
      }),
    deleteCampaignDraft: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        const db = await requireDb();
        await db.delete(campaignDrafts).where(eq(campaignDrafts.id, input.id));
        return { success: true };
      }),
  }),
  knowledge: router({
    /** Readable by any signed-in account, including partners. */
    list: protectedProcedure.query(async () => {
      const db = await requireDb();
      return db
        .select()
        .from(knowledgeArticles)
        .orderBy(asc(knowledgeArticles.title));
    }),
    save: staffProcedure
      .input(
        z.object({
          id: z.number().int().positive().optional(),
          title: z.string().min(3).max(255),
          tag: z.string().min(2).max(80),
          body: z.string().min(10),
        })
      )
      .mutation(async ({ input }) => {
        const db = await requireDb();
        const value = { title: input.title, tag: input.tag, body: input.body };
        if (input.id) {
          await db
            .update(knowledgeArticles)
            .set(value)
            .where(eq(knowledgeArticles.id, input.id));
        } else {
          await db.insert(knowledgeArticles).values(value);
        }
        return { success: true };
      }),
  }),
  evaluations: router({
    scoreTranscript: staffProcedure
      .input(
        z.object({
          callId: z.string().min(3).max(128),
          transcript: z.string().min(20).max(500_000),
          partnerId: z.number().int().positive().optional(),
          persist: z.boolean().default(false),
        })
      )
      .mutation(async ({ input }) => {
        const report = evaluateTranscript(input.callId, input.transcript);

        if (input.persist) {
          const db = await requireDb();
          const scorecard = JSON.stringify(report.policyResults);
          await db
            .insert(callEvaluations)
            .values({
              partnerId: input.partnerId ?? null,
              callId: input.callId,
              transcript: input.transcript,
              overallGrade: report.overallGrade,
              scorecard,
            })
            .onDuplicateKeyUpdate({
              set: {
                transcript: input.transcript,
                overallGrade: report.overallGrade,
                scorecard,
                evaluatedAt: new Date(),
              },
            });
        }

        return report;
      }),
    list: staffProcedure.query(async () => {
      const db = await requireDb();
      return db
        .select()
        .from(callEvaluations)
        .orderBy(desc(callEvaluations.evaluatedAt));
    }),
  }),
  certification: router({
    progress: protectedProcedure
      .input(z.object({ traineeId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const db = await requireDb();
        const [trainee] = await db
          .select()
          .from(trainees)
          .where(eq(trainees.id, input.traineeId))
          .limit(1);
        if (!trainee) notFound("Trainee");

        const progress = await db
          .select()
          .from(certificationProgress)
          .where(eq(certificationProgress.traineeId, input.traineeId));

        return { trainee, progress };
      }),
    completeModule: staffProcedure
      .input(
        z.object({
          traineeId: z.number().int().positive(),
          module: z.enum(CERTIFICATION_MODULES),
          score: z.number().int().min(0).max(100),
        })
      )
      .mutation(async ({ input }) => {
        const db = await requireDb();

        // The unique index on (traineeId, module) is the real guard; this
        // insert is idempotent rather than check-then-write, so two concurrent
        // submissions cannot both land.
        await db
          .insert(certificationProgress)
          .values({
            traineeId: input.traineeId,
            module: input.module,
            score: input.score,
            completedAt: new Date(),
          })
          .onDuplicateKeyUpdate({ set: { module: input.module } });

        const completed = await db
          .select({ module: certificationProgress.module })
          .from(certificationProgress)
          .where(eq(certificationProgress.traineeId, input.traineeId));

        // Count distinct modules, not rows.
        const distinct = new Set(completed.map(row => row.module));
        const certified = CERTIFICATION_MODULES.every(module =>
          distinct.has(module)
        );

        if (certified) {
          await db
            .update(trainees)
            .set({ status: "Certified" })
            .where(eq(trainees.id, input.traineeId));
        }

        return {
          success: true,
          completedModules: distinct.size,
          totalModules: CERTIFICATION_MODULES.length,
          certified,
        };
      }),
  }),
  profile: router({
    me: protectedProcedure.query(({ ctx }) => ctx.user),
    save: protectedProcedure
      .input(
        z.object({
          name: z.string().min(2).max(255),
          // Explicitly nullish: omitting the field leaves the stored address
          // alone, passing null clears it. Previously omitting it wiped it.
          email: z.string().email().max(320).nullish(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const db = await requireDb();
        const value: { name: string; email?: string | null } = {
          name: input.name,
        };
        if (input.email !== undefined) value.email = input.email;

        await db.update(users).set(value).where(eq(users.id, ctx.user.id));
        return { success: true };
      }),
  }),
  calendar: router({
    list: staffProcedure.query(async () => {
      const db = await requireDb();
      return db
        .select()
        .from(contentEntries)
        .orderBy(asc(contentEntries.publishDate));
    }),
    save: staffProcedure
      .input(
        z.object({
          id: z.number().int().positive().optional(),
          title: z.string().min(3).max(255),
          body: z.string().optional(),
          hashtags: z.string().optional(),
          platform: z.enum(["LinkedIn", "Twitter"]),
          status: z.enum(CONTENT_STATUSES),
          publishDate: z.date(),
          publishedUrl: z.string().url().max(512).nullish(),
        })
      )
      .mutation(async ({ input }) => {
        const db = await requireDb();
        const value = {
          title: input.title,
          body: input.body,
          hashtags: input.hashtags,
          platform: input.platform,
          status: input.status,
          publishDate: input.publishDate,
          publishedUrl: input.publishedUrl ?? null,
        };
        if (input.id) {
          await db
            .update(contentEntries)
            .set(value)
            .where(eq(contentEntries.id, input.id));
        } else {
          await db.insert(contentEntries).values(value);
        }
        return { success: true };
      }),
  }),
  intelligence: router({
    list: staffProcedure.query(async () => {
      const db = await requireDb();
      return db.select().from(competitors).orderBy(asc(competitors.name));
    }),
    save: staffProcedure
      .input(
        z.object({
          id: z.number().int().positive().optional(),
          // Competitors are data now, not a schema enum — any name is valid.
          name: z.string().min(2).max(160),
          profile: z.string().min(10),
          positioning: z.string().min(10),
        })
      )
      .mutation(async ({ input }) => {
        const db = await requireDb();
        const value = {
          name: input.name,
          profile: input.profile,
          positioning: input.positioning,
        };
        if (input.id) {
          await db
            .update(competitors)
            .set(value)
            .where(eq(competitors.id, input.id));
        } else {
          await db
            .insert(competitors)
            .values(value)
            .onDuplicateKeyUpdate({
              set: { profile: input.profile, positioning: input.positioning },
            });
        }
        return { success: true };
      }),
    deleteCompetitor: adminProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        const db = await requireDb();
        await db.delete(competitors).where(eq(competitors.id, input.id));
        return { success: true };
      }),
    /**
     * Read-only. Defaults are installed by the seed routine, not by this
     * query — a query that writes races itself on first load.
     */
    matrix: staffProcedure.query(async () => {
      const db = await requireDb();
      const [capabilities, cells] = await Promise.all([
        db
          .select()
          .from(matrixCapabilities)
          .orderBy(
            asc(matrixCapabilities.sortOrder),
            asc(matrixCapabilities.capability)
          ),
        db.select().from(matrixCells),
      ]);

      return capabilities.map(capability => ({
        id: capability.id,
        capability: capability.capability,
        sortOrder: capability.sortOrder,
        cells: cells
          .filter(cell => cell.capabilityId === capability.id)
          .map(cell => ({
            id: cell.id,
            subject: cell.subject,
            value: cell.value,
          })),
      }));
    }),
    saveMatrixRow: staffProcedure
      .input(
        z.object({
          id: z.number().int().positive().optional(),
          capability: z.string().min(2).max(160),
          sortOrder: z.number().int().min(0).default(0),
          /** Subject → value, e.g. { "NHID-Clinical": "Primary", Hyro: "Adjacent" }. */
          cells: z.record(
            z.string().min(1).max(160),
            z.string().min(1).max(80)
          ),
        })
      )
      .mutation(async ({ input }) => {
        const db = await requireDb();

        let capabilityId = input.id;
        if (capabilityId) {
          await db
            .update(matrixCapabilities)
            .set({ capability: input.capability, sortOrder: input.sortOrder })
            .where(eq(matrixCapabilities.id, capabilityId));
        } else {
          await db
            .insert(matrixCapabilities)
            .values({
              capability: input.capability,
              sortOrder: input.sortOrder,
            })
            .onDuplicateKeyUpdate({ set: { sortOrder: input.sortOrder } });

          const [existing] = await db
            .select()
            .from(matrixCapabilities)
            .where(eq(matrixCapabilities.capability, input.capability))
            .limit(1);
          capabilityId = existing?.id;
        }

        if (!capabilityId) notFound("Capability");

        for (const [subject, value] of Object.entries(input.cells)) {
          await db
            .insert(matrixCells)
            .values({ capabilityId, subject, value })
            .onDuplicateKeyUpdate({ set: { value } });
        }

        return { success: true, id: capabilityId };
      }),
  }),
  settings: router({
    organization: protectedProcedure.query(async () => {
      const db = await requireDb();
      const [settings] = await db.select().from(organizationSettings).limit(1);
      return settings ?? null;
    }),
    saveOrganization: adminProcedure
      .input(
        z.object({
          name: z.string().min(2).max(255),
          supportEmail: z.string().email().max(320).nullish(),
        })
      )
      .mutation(async ({ input }) => {
        const db = await requireDb();
        const [existing] = await db
          .select()
          .from(organizationSettings)
          .limit(1);
        if (existing) {
          const value: { name: string; supportEmail?: string | null } = {
            name: input.name,
          };
          if (input.supportEmail !== undefined) {
            value.supportEmail = input.supportEmail;
          }
          await db
            .update(organizationSettings)
            .set(value)
            .where(eq(organizationSettings.id, existing.id));
        } else {
          await db.insert(organizationSettings).values({
            name: input.name,
            supportEmail: input.supportEmail ?? null,
            billingStatus: "Coming Soon",
          });
        }
        return { success: true };
      }),
    listUsers: adminProcedure.query(async () => {
      const db = await requireDb();
      return db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          role: users.role,
          lastSignedIn: users.lastSignedIn,
        })
        .from(users)
        .orderBy(asc(users.id));
    }),
    /** Admin-only: change another account's role. */
    setUserRole: adminProcedure
      .input(
        z.object({
          userId: z.number().int().positive(),
          role: z.enum(USER_ROLES),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (input.userId === ctx.user.id && input.role !== "admin") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "You cannot remove your own admin access.",
          });
        }
        const db = await requireDb();
        await db
          .update(users)
          .set({ role: input.role })
          .where(eq(users.id, input.userId));
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
