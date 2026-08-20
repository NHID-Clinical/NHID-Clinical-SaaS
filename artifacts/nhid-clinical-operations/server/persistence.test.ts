import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

/**
 * Persistence coverage for the paths that previously looked like they worked
 * but wrote nothing: public intake and call-volume import.
 */

type Captured = { table: string; values: unknown };

const mocks = vi.hoisted(() => {
  const inserts: Captured[] = [];
  const selectResults: unknown[][] = [];

  const tableName = (table: unknown) => {
    const symbols = Object.getOwnPropertySymbols(table as object);
    for (const symbol of symbols) {
      if (String(symbol).includes("Name")) {
        return String((table as Record<symbol, unknown>)[symbol]);
      }
    }
    return "unknown";
  };

  const thenable = (rows: unknown[]) => {
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      where: vi.fn(() => thenable(rows)),
      limit: vi.fn(() => thenable(rows)),
      orderBy: vi.fn(() => thenable(rows)),
    });
    return Object.assign(Promise.resolve(rows), chain);
  };

  const select = vi.fn(() => ({
    from: vi.fn((table: unknown) => thenable(selectResults.shift() ?? [])),
  }));

  const insert = vi.fn((table: unknown) => ({
    values: vi.fn((values: unknown) => {
      inserts.push({ table: tableName(table), values });
      return Object.assign(Promise.resolve([{ insertId: 4242 }]), {
        onDuplicateKeyUpdate: vi.fn(() =>
          Promise.resolve([{ insertId: 4242 }])
        ),
      });
    }),
  }));

  return {
    inserts,
    selectResults,
    select,
    insert,
    getDb: vi.fn(async () => ({
      select,
      insert,
      update: vi.fn(() => ({ set: vi.fn(() => Promise.resolve([])) })),
      delete: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })),
    })),
  };
});

vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./storage", () => ({
  storagePut: vi.fn(async (key: string) => ({
    key,
    url: `/manus-storage/${key}`,
  })),
}));

import { appRouter } from "./routers";
import { storagePut } from "./storage";

const anonymous: TrpcContext = {
  user: null,
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: {} as TrpcContext["res"],
};

const staff: TrpcContext = {
  user: {
    id: 3,
    openId: "open-consultant",
    name: "Consultant",
    email: "consultant@example.org",
    loginMethod: "manus",
    role: "consultant",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  },
  req: { protocol: "https", headers: {} } as TrpcContext["req"],
  res: {} as TrpcContext["res"],
};

describe("partners.publicIntake", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inserts.length = 0;
    mocks.selectResults.length = 0;
  });

  it("persists the application instead of echoing it back", async () => {
    const result = await appRouter
      .createCaller(anonymous)
      .partners.publicIntake({
        name: "Acme Clinic",
        contactName: "Jane Doe",
        email: "jane@acme.example",
        phone: "+1 555 0100",
        platform: "Twilio",
        estimatedCallVolume: 900,
        useCase: "Appointment scheduling",
      });

    expect(result).toMatchObject({
      success: true,
      partnerId: 4242,
      stage: "Applied",
    });

    const partnerInsert = mocks.inserts.find(entry =>
      entry.table.includes("partners")
    );
    expect(partnerInsert).toBeDefined();
    expect(partnerInsert!.values).toMatchObject({
      name: "Acme Clinic",
      contactName: "Jane Doe",
      email: "jane@acme.example",
      stage: "Applied",
    });
  });

  it("records an auditable intake event alongside the partner", async () => {
    await appRouter.createCaller(anonymous).partners.publicIntake({
      name: "Acme Clinic",
      contactName: "Jane Doe",
      email: "jane@acme.example",
      platform: "VAPI",
      estimatedCallVolume: 10,
      useCase: "Nurse line",
    });

    const event = mocks.inserts.find(entry =>
      entry.table.includes("eventLogs")
    );
    expect(event).toBeDefined();
    expect(event!.values).toMatchObject({
      partnerId: 4242,
      eventType: "partner.applied",
    });
  });
});

describe("partners.importCallVolume", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inserts.length = 0;
    mocks.selectResults.length = 0;
  });

  it("writes a callVolumes row per week", async () => {
    mocks.selectResults.push([{ id: 1, name: "Acme Clinic" }]); // partner lookup

    const result = await appRouter
      .createCaller(staff)
      .partners.importCallVolume({
        partnerId: 1,
        fileName: "volumes.csv",
        csvContent: "week,calls\n2026-08-03,120\n2026-08-10,145",
      });

    expect(result).toMatchObject({ rows: 2, weeks: 2, totalCalls: 265 });

    const volumeInserts = mocks.inserts.filter(entry =>
      entry.table.includes("callVolumes")
    );
    expect(volumeInserts).toHaveLength(2);
    expect(volumeInserts[0].values).toMatchObject({
      partnerId: 1,
      totalCalls: 120,
    });
  });

  it("rejects a malformed file with the offending row named", async () => {
    mocks.selectResults.push([{ id: 1, name: "Acme Clinic" }]);

    await expect(
      appRouter.createCaller(staff).partners.importCallVolume({
        partnerId: 1,
        fileName: "volumes.csv",
        csvContent: "week,calls\n2026-08-03,120\n2026-08-10,N/A",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // Nothing is stored or persisted when the evidence cannot be trusted.
    expect(storagePut).not.toHaveBeenCalled();
    expect(
      mocks.inserts.filter(entry => entry.table.includes("callVolumes"))
    ).toHaveLength(0);
  });

  it("keeps a crafted filename inside the partner's storage prefix", async () => {
    mocks.selectResults.push([{ id: 1, name: "Acme Clinic" }]);

    await appRouter.createCaller(staff).partners.importCallVolume({
      partnerId: 1,
      fileName: "../../../etc/evil.csv",
      csvContent: "week,calls\n2026-08-03,10",
    });

    const key = vi.mocked(storagePut).mock.calls[0][0];
    expect(key).toBe("partner-call-volumes/1/evil.csv");
    expect(key).not.toContain("..");
  });

  it("refuses a non-CSV filename", async () => {
    await expect(
      appRouter.createCaller(staff).partners.importCallVolume({
        partnerId: 1,
        fileName: "volumes.xlsx",
        csvContent: "week,calls\n2026-08-03,10",
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("profile.save", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inserts.length = 0;
  });

  it("does not wipe the stored email when the field is omitted", async () => {
    const set = vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) }));
    mocks.getDb.mockResolvedValueOnce({
      select: mocks.select,
      insert: mocks.insert,
      update: vi.fn(() => ({ set })),
      delete: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })),
    } as never);

    await appRouter.createCaller(staff).profile.save({ name: "New Name" });

    expect(set).toHaveBeenCalledWith({ name: "New Name" });
    expect(set.mock.calls[0][0]).not.toHaveProperty("email");
  });

  it("clears the email only when null is passed explicitly", async () => {
    const set = vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) }));
    mocks.getDb.mockResolvedValueOnce({
      select: mocks.select,
      insert: mocks.insert,
      update: vi.fn(() => ({ set })),
      delete: vi.fn(() => ({ where: vi.fn(() => Promise.resolve([])) })),
    } as never);

    await appRouter
      .createCaller(staff)
      .profile.save({ name: "New Name", email: null });

    expect(set).toHaveBeenCalledWith({ name: "New Name", email: null });
  });
});
