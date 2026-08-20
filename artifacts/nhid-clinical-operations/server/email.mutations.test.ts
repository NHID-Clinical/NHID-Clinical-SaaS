import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => {
  const where = vi.fn(async () => ({ affectedRows: 1 }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  const values = vi.fn(async () => ({ insertId: 1 }));
  const insert = vi.fn(() => ({ values }));
  return {
    where,
    set,
    update,
    values,
    insert,
    getDb: vi.fn(async () => ({ update, insert })),
  };
});

vi.mock("./db", () => ({ getDb: mocks.getDb }));

import { appRouter } from "./routers";

function context(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "admin-test",
      name: "Admin",
      email: "admin@example.org",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("email mutation workflows", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists an approved inbound category", async () => {
    const result = await appRouter
      .createCaller(context())
      .email.applyCategory({ id: 9, category: "Integration" });
    expect(result).toEqual({ success: true });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.set).toHaveBeenCalledWith({ category: "Integration" });
  });

  it("creates a reusable response template", async () => {
    const result = await appRouter.createCaller(context()).email.saveTemplate({
      type: "Pilot Inquiry",
      name: "Pilot triage",
      subject: "Shadow Pilot next steps",
      body: "Thank you for your interest in the 30-day Shadow Pilot.",
    });
    expect(result).toEqual({ success: true });
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(mocks.values).toHaveBeenCalledWith({
      type: "Pilot Inquiry",
      name: "Pilot triage",
      subject: "Shadow Pilot next steps",
      body: "Thank you for your interest in the 30-day Shadow Pilot.",
    });
  });
});
