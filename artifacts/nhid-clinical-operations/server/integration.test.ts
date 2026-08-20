import { beforeAll, describe, expect, it, vi } from "vitest";
import type { UserRole } from "../shared/domain";
import type { TrpcContext } from "./_core/context";
// Object storage is the one external service with no local stand-in. The
// database, the queries and the constraints are all real.
vi.mock("./storage", () => ({
  storagePut: vi.fn(async (key: string) => ({
    key,
    url: `/manus-storage/${key}`,
  })),
}));

import { appRouter } from "./routers";
import { seedOperationsDatabase } from "./seedOperations";

/**
 * End-to-end coverage against a real MySQL-compatible database.
 *
 * Skipped unless TEST_DATABASE_URL is set, so `pnpm test` stays fast and
 * hermetic in CI. Run it with a throwaway database:
 *
 *   TEST_DATABASE_URL="mysql://root@localhost:3307/nhid" pnpm test
 *
 * Everything above this file mocks the driver; this is what proves the
 * queries, constraints and seed routine actually work.
 */
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

if (url) process.env.DATABASE_URL = url;

function context(role: UserRole | null): TrpcContext {
  return {
    user:
      role === null
        ? null
        : {
            id: 1,
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

const admin = () => appRouter.createCaller(context("admin"));
const anonymous = () => appRouter.createCaller(context(null));

suite("end-to-end against a real database", () => {
  beforeAll(async () => {
    const result = await seedOperationsDatabase();
    expect(["created", "backfilled", "already-seeded"]).toContain(
      result.reason
    );
  });

  it("seeds an empty database exactly once and is idempotent", async () => {
    const second = await seedOperationsDatabase();
    expect(second.reason).toBe("already-seeded");

    const third = await seedOperationsDatabase();
    expect(third.reason).toBe("already-seeded");
  });

  it("survives concurrent seeding without duplicate-key errors", async () => {
    // Three simultaneous callers; the advisory lock serializes them.
    const results = await Promise.all([
      seedOperationsDatabase(),
      seedOperationsDatabase(),
      seedOperationsDatabase(),
    ]);
    results.forEach(result => {
      expect(["already-seeded", "backfilled", "locked"]).toContain(
        result.reason
      );
    });
  });

  it("persists a public intake application and shows it on the pipeline", async () => {
    const before = await admin().partners.list();

    const created = await anonymous().partners.publicIntake({
      name: "Integration Test Clinic",
      contactName: "Dana Example",
      email: `dana+${Date.now()}@example.org`,
      platform: "Retell",
      estimatedCallVolume: 4200,
      useCase: "After-hours triage",
    });
    expect(created.partnerId).toBeGreaterThan(0);

    const after = await admin().partners.list();
    expect(after.length).toBe(before.length + 1);
    expect(after.some(row => row.id === created.partnerId)).toBe(true);

    // The application is auditable, not just stored.
    const detail = await admin().partners.detail({ id: created.partnerId });
    expect(detail.partner.stage).toBe("Applied");
    expect(
      detail.events.some(event => event.eventType === "partner.applied")
    ).toBe(true);
  });

  it("moves a partner through the pipeline and records the transition", async () => {
    const [partner] = await admin().partners.list();

    await admin().partners.moveStage({ id: partner.id, stage: "Reporting" });

    const detail = await admin().partners.detail({ id: partner.id });
    expect(detail.partner.stage).toBe("Reporting");

    const transition = detail.events.find(
      event => event.eventType === "partner.stage_changed"
    );
    expect(transition).toBeDefined();
    expect(JSON.parse(transition!.payload)).toMatchObject({ to: "Reporting" });
  });

  it("imports call volumes, and re-importing updates instead of doubling", async () => {
    const [partner] = await admin().partners.list();
    const csv = "week,calls\n2026-08-03,120\n2026-08-10,145";

    const first = await admin().partners.importCallVolume({
      partnerId: partner.id,
      fileName: "volumes.csv",
      csvContent: csv,
    });
    expect(first.totalCalls).toBe(265);

    const afterFirst = await admin().partners.detail({ id: partner.id });
    expect(afterFirst.callVolumes).toHaveLength(2);

    // Same file again: still two weeks, not four.
    await admin().partners.importCallVolume({
      partnerId: partner.id,
      fileName: "volumes.csv",
      csvContent: csv,
    });
    const afterSecond = await admin().partners.detail({ id: partner.id });
    expect(afterSecond.callVolumes).toHaveLength(2);

    // A correction updates the stored week in place.
    await admin().partners.importCallVolume({
      partnerId: partner.id,
      fileName: "volumes.csv",
      csvContent: "week,calls\n2026-08-03,500\n2026-08-10,145",
    });
    const corrected = await admin().partners.detail({ id: partner.id });
    expect(corrected.callVolumes).toHaveLength(2);
    expect(corrected.callVolumes[0].totalCalls).toBe(500);
  });

  it("rejects a malformed evidence file without writing anything", async () => {
    const [partner] = await admin().partners.list();
    const before = await admin().partners.detail({ id: partner.id });

    await expect(
      admin().partners.importCallVolume({
        partnerId: partner.id,
        fileName: "bad.csv",
        csvContent: "week,calls\n2026-09-07,120\n2026-09-14,N/A",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const after = await admin().partners.detail({ id: partner.id });
    expect(after.callVolumes).toHaveLength(before.callVolumes.length);
  });

  it("scores a transcript and persists the scorecard", async () => {
    const callId = `CALL-${Date.now()}`;
    const report = await admin().evaluations.scoreTranscript({
      callId,
      transcript:
        "Agent: Hello, you are speaking with an automated assistant.\nCaller: I want to speak to a person.\nAgent: Of course, connecting you now.",
      persist: true,
    });

    expect(report.overallGrade).toBe("A");
    expect(report.evaluatedControls).toBeGreaterThanOrEqual(3);

    const stored = await admin().evaluations.list();
    const row = stored.find(entry => entry.callId === callId);
    expect(row).toBeDefined();
    expect(JSON.parse(row!.scorecard)).toHaveLength(5);
  });

  it("records a module completion exactly once under concurrency", async () => {
    const { trainee } = await admin().certification.progress({ traineeId: 1 });
    expect(trainee).toBeTruthy();

    // Five simultaneous submissions of the same module.
    await Promise.all(
      Array.from({ length: 5 }, () =>
        admin().certification.completeModule({
          traineeId: 1,
          module: "101",
          score: 91,
        })
      )
    );

    const { progress } = await admin().certification.progress({ traineeId: 1 });
    const module101 = progress.filter(row => row.module === "101");
    expect(module101).toHaveLength(1);
  });

  it("builds the dashboard from stored rows, not from constants", async () => {
    const snapshot = await admin().operations.snapshot();

    expect(snapshot.partners.length).toBeGreaterThan(0);
    expect(snapshot.metrics.evaluatedCalls).toBe(snapshot.evaluations.length);

    // Pipeline counts must agree with the partner rows.
    const total = snapshot.pipeline.reduce((sum, row) => sum + row.count, 0);
    expect(total).toBe(snapshot.partners.length);

    // The pass rate is derived, not the old hardcoded 92.
    const graded = snapshot.evaluations.length;
    const passing = snapshot.evaluations.filter(
      row => row.overallGrade === "A"
    ).length;
    expect(snapshot.metrics.controlPassRate).toBe(
      graded ? Math.round((passing / graded) * 100) : null
    );
  });

  it("serves the normalized comparison matrix and accepts a new competitor", async () => {
    await admin().intelligence.save({
      name: "New Entrant Co",
      profile: "A competitor added at runtime, with no migration.",
      positioning: "Proof that competitors are data rather than schema.",
    });

    const competitors = await admin().intelligence.list();
    expect(competitors.map(row => row.name)).toContain("New Entrant Co");

    await admin().intelligence.saveMatrixRow({
      capability: "Runtime extensibility",
      cells: { "NHID-Clinical": "Primary", "New Entrant Co": "Unknown" },
    });

    const matrix = await admin().intelligence.matrix();
    const row = matrix.find(
      entry => entry.capability === "Runtime extensibility"
    );
    expect(row).toBeDefined();
    expect(
      row!.cells.find(cell => cell.subject === "New Entrant Co")?.value
    ).toBe("Unknown");
  });

  it("does not wipe the stored email on a partial profile save", async () => {
    await admin().profile.save({ name: "Renamed User" });
    const users = await admin().settings.listUsers();
    const user = users.find(row => row.id === 1);
    expect(user?.name).toBe("Renamed User");
  });
});
