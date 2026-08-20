import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserRole } from "../shared/domain";
import type { TrpcContext } from "./_core/context";

/**
 * Authorization coverage.
 *
 * Every procedure is asserted against an anonymous caller and against each
 * role. The previous suite only ever built an admin context, so a missing role
 * check was indistinguishable from a working one.
 */

const mocks = vi.hoisted(() => {
  const chain: Record<string, unknown> = {};
  const thenable = (rows: unknown[] = []) =>
    Object.assign(Promise.resolve(rows), chain);

  const where = vi.fn(() => thenable([]));
  const limit = vi.fn(() => thenable([]));
  const orderBy = vi.fn(() => thenable([]));
  const from = vi.fn(() => thenable([]));
  const select = vi.fn(() => ({ from }));
  const onDuplicateKeyUpdate = vi.fn(() => thenable([{ insertId: 1 }]));
  const values = vi.fn(() =>
    Object.assign(Promise.resolve([{ insertId: 1 }]), { onDuplicateKeyUpdate })
  );
  const insert = vi.fn(() => ({ values }));
  const set = vi.fn(() => thenable([]));
  const update = vi.fn(() => ({ set }));
  const del = vi.fn(() => ({ where }));
  const execute = vi.fn(async () => [[{ acquired: 1 }]]);

  Object.assign(chain, { where, limit, orderBy, from });

  return {
    select,
    insert,
    update,
    delete: del,
    execute,
    values,
    getDb: vi.fn(async () => ({
      select,
      insert,
      update,
      delete: del,
      execute,
    })),
  };
});

vi.mock("./db", () => ({ getDb: mocks.getDb }));

import { appRouter } from "./routers";

function context(role: UserRole | null): TrpcContext {
  return {
    user:
      role === null
        ? null
        : {
            id: 7,
            openId: `open-${role}`,
            name: "Test User",
            email: "test@example.org",
            loginMethod: "manus",
            role,
            createdAt: new Date(),
            updatedAt: new Date(),
            lastSignedIn: new Date(),
          },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

/** Runs a procedure and returns the TRPC error code, or "OK". */
async function attempt(
  role: UserRole | null,
  run: (caller: ReturnType<typeof appRouter.createCaller>) => Promise<unknown>
): Promise<string> {
  try {
    await run(appRouter.createCaller(context(role)));
    return "OK";
  } catch (error) {
    const code = (error as { code?: string }).code;
    // Anything that is not an auth rejection means the guard let us through.
    return code === "UNAUTHORIZED" || code === "FORBIDDEN" ? code : "OK";
  }
}

const STAFF_ONLY: Array<
  [
    string,
    (caller: ReturnType<typeof appRouter.createCaller>) => Promise<unknown>,
  ]
> = [
  ["operations.snapshot", c => c.operations.snapshot()],
  ["partners.list", c => c.partners.list()],
  ["partners.detail", c => c.partners.detail({ id: 1 })],
  ["partners.moveStage", c => c.partners.moveStage({ id: 1, stage: "Live" })],
  [
    "partners.importCallVolume",
    c =>
      c.partners.importCallVolume({
        partnerId: 1,
        fileName: "volumes.csv",
        csvContent: "week,calls\n2026-08-03,10",
      }),
  ],
  ["email.inbox", c => c.email.inbox()],
  ["email.templates", c => c.email.templates()],
  ["email.campaignDrafts", c => c.email.campaignDrafts()],
  ["email.categorize", c => c.email.categorize({ subject: "a", body: "b" })],
  [
    "email.applyCategory",
    c => c.email.applyCategory({ id: 1, category: "Pricing" }),
  ],
  [
    "email.generateDraft",
    c =>
      c.email.generateDraft({
        senderName: "A",
        subject: "S",
        category: "Pricing",
      }),
  ],
  [
    "evaluations.scoreTranscript",
    c =>
      c.evaluations.scoreTranscript({
        callId: "CALL-1",
        transcript: "Agent: I am an automated assistant.\nCaller: Hello there.",
      }),
  ],
  ["evaluations.list", c => c.evaluations.list()],
  ["calendar.list", c => c.calendar.list()],
  ["intelligence.list", c => c.intelligence.list()],
  ["intelligence.matrix", c => c.intelligence.matrix()],
  [
    "knowledge.save",
    c =>
      c.knowledge.save({ title: "Title", tag: "Tag", body: "Body body body" }),
  ],
  [
    "certification.completeModule",
    c =>
      c.certification.completeModule({
        traineeId: 1,
        module: "101",
        score: 90,
      }),
  ],
];

const ADMIN_ONLY: Array<
  [
    string,
    (caller: ReturnType<typeof appRouter.createCaller>) => Promise<unknown>,
  ]
> = [
  ["operations.seed", c => c.operations.seed()],
  ["email.deleteTemplate", c => c.email.deleteTemplate({ id: 1 })],
  ["email.deleteCampaignDraft", c => c.email.deleteCampaignDraft({ id: 1 })],
  [
    "intelligence.deleteCompetitor",
    c => c.intelligence.deleteCompetitor({ id: 1 }),
  ],
  [
    "settings.saveOrganization",
    c => c.settings.saveOrganization({ name: "NHID-Clinical" }),
  ],
  ["settings.listUsers", c => c.settings.listUsers()],
  [
    "settings.setUserRole",
    c => c.settings.setUserRole({ userId: 99, role: "consultant" }),
  ],
];

const SIGNED_IN_ONLY: Array<
  [
    string,
    (caller: ReturnType<typeof appRouter.createCaller>) => Promise<unknown>,
  ]
> = [
  ["knowledge.list", c => c.knowledge.list()],
  ["profile.me", c => c.profile.me()],
  ["profile.save", c => c.profile.save({ name: "Test User" })],
  ["settings.organization", c => c.settings.organization()],
  ["certification.progress", c => c.certification.progress({ traineeId: 1 })],
];

describe("staff-only procedures", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(STAFF_ONLY)("%s rejects an anonymous caller", async (_name, run) => {
    expect(await attempt(null, run)).toBe("UNAUTHORIZED");
  });

  it.each(STAFF_ONLY)("%s rejects the partner role", async (_name, run) => {
    expect(await attempt("partner", run)).toBe("FORBIDDEN");
  });

  it.each(STAFF_ONLY)("%s allows a consultant", async (_name, run) => {
    expect(await attempt("consultant", run)).toBe("OK");
  });
});

describe("admin-only procedures", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(ADMIN_ONLY)("%s rejects an anonymous caller", async (_name, run) => {
    expect(await attempt(null, run)).toBe("UNAUTHORIZED");
  });

  it.each(ADMIN_ONLY)("%s rejects the partner role", async (_name, run) => {
    expect(await attempt("partner", run)).toBe("FORBIDDEN");
  });

  it.each(ADMIN_ONLY)("%s rejects a consultant", async (_name, run) => {
    expect(await attempt("consultant", run)).toBe("FORBIDDEN");
  });

  it.each(ADMIN_ONLY)("%s allows an admin", async (_name, run) => {
    expect(await attempt("admin", run)).toBe("OK");
  });
});

describe("signed-in procedures", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(SIGNED_IN_ONLY)(
    "%s rejects an anonymous caller",
    async (_name, run) => {
      expect(await attempt(null, run)).toBe("UNAUTHORIZED");
    }
  );

  it.each(SIGNED_IN_ONLY)("%s allows the partner role", async (_name, run) => {
    expect(await attempt("partner", run)).toBe("OK");
  });
});

describe("intentionally public procedures", () => {
  beforeEach(() => vi.clearAllMocks());

  it("allows anonymous access to exactly the intake, health and auth surfaces", async () => {
    expect(
      await attempt(null, c =>
        c.partners.publicIntake({
          name: "Acme Clinic",
          contactName: "Jane Doe",
          email: "jane@acme.example",
          platform: "Twilio",
          estimatedCallVolume: 100,
          useCase: "Appointment scheduling",
        })
      )
    ).toBe("OK");
    expect(
      await attempt(null, c => c.system.health({ timestamp: Date.now() }))
    ).toBe("OK");
    expect(await attempt(null, c => c.auth.me())).toBe("OK");
  });
});

describe("admin self-protection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("refuses to let an admin demote themselves", async () => {
    await expect(
      appRouter
        .createCaller(context("admin"))
        .settings.setUserRole({ userId: 7, role: "partner" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
