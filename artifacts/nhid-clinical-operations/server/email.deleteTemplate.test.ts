import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const mocks = vi.hoisted(() => {
  const where = vi.fn(async () => ({ affectedRows: 1 }));
  const del = vi.fn(() => ({ where }));
  return { where, del, getDb: vi.fn(async () => ({ delete: del })) };
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

describe("email.deleteTemplate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes the selected template through the protected server procedure", async () => {
    const result = await appRouter
      .createCaller(context())
      .email.deleteTemplate({ id: 12 });
    expect(result).toEqual({ success: true });
    expect(mocks.del).toHaveBeenCalledTimes(1);
    expect(mocks.where).toHaveBeenCalledTimes(1);
  });
});
