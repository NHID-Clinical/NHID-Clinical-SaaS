/**
 * The Security & audit page (trust center). Rendered against a mocked fetch,
 * the network boundary, so these test what a customer sees for a given API
 * answer: the posture, keys with their scope and expiry, the activity log with
 * an export, and the gaps stated as plainly as the controls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SecurityPanel } from "./security";

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

const SUMMARY = {
  keys: { active: 2, expiring_within_14_days: 1, by_scope: { read: 1, ingest: 1 },
          primary_key_prefix: "nhid_abc123" },
  members: { total: 2, by_role: { owner: 1, auditor: 1 } },
  retention: { effective_days: 30, policy_source: "server_default",
               transcripts_held: 4, oldest_held_at: null },
  activity: { events_last_30_days: 3 },
  controls: ["Scoped, expiring API keys", "Read-only auditor role"],
  gaps: [
    { id: "soc2", title: "No SOC 2 report", detail: "No audit has been performed." },
    { id: "baa", title: "No signed BAA", detail: "None is in place." },
    { id: "pentest", title: "No third-party penetration test", detail: "Automated checks only." },
  ],
};

const KEYS = {
  keys: [
    { key_id: "key_soon", label: "auditor laptop", key_prefix: "nhid_aaa111", scope: "read",
      created_at: inDays(-20), created_by: "owner@example.org", expires_at: inDays(5),
      revoked_at: null, revoked_by: null, last_used_at: null, active: true },
    { key_id: "key_later", label: "pipeline", key_prefix: "nhid_bbb222", scope: "ingest",
      created_at: inDays(-1), created_by: "owner@example.org", expires_at: inDays(80),
      revoked_at: null, revoked_by: null, last_used_at: inDays(0), active: true },
  ],
};

const ACTIVITY = {
  events: [
    { activity_id: "a1", occurred_at: inDays(0), actor: "owner@example.org",
      action: "key.created", target: "key_later", detail: { scope: "ingest" } },
  ],
  actions: ["key.created"],
};

function respond(routes: Record<string, unknown | (() => Response)>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [path, body] of Object.entries(routes)) {
      if (url.includes(path)) {
        if (typeof body === "function") return (body as () => Response)();
        return new Response(JSON.stringify(body), { status: 200,
          headers: { "Content-Type": "application/json" } });
      }
    }
    return new Response(JSON.stringify({ detail: "not mocked" }), { status: 404 });
  });
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SecurityPanel apiKey="nhid_test" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", respond({
    "/saas/orgs/security": SUMMARY,
    "/saas/orgs/keys": KEYS,
    "/saas/orgs/activity": ACTIVITY,
    "/saas/orgs/sso": { sso: null },
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Security & audit", () => {
  it("states the gaps as plainly as the controls", async () => {
    renderPanel();
    expect(await screen.findByText("No SOC 2 report")).toBeTruthy();
    expect(screen.getByText("No signed BAA")).toBeTruthy();
    expect(screen.getByText("No third-party penetration test")).toBeTruthy();
    expect(screen.getByText("Read-only auditor role")).toBeTruthy();
  });

  it("shows the posture figures", async () => {
    renderPanel();
    const activeKeys = await screen.findByTestId("posture-active-keys");
    expect(activeKeys.textContent).toContain("2");
    expect(screen.getByTestId("posture-expiring").textContent).toContain("1");
    expect(screen.getByTestId("posture-retention").textContent).toContain("30");
  });

  it("lists keys with their scope and flags one that expires soon", async () => {
    renderPanel();
    const soon = await screen.findByTestId("key-row-key_soon");
    expect(soon.textContent).toContain("read");
    expect(soon.textContent).toContain("Expires soon");
    const later = screen.getByTestId("key-row-key_later");
    expect(later.textContent).not.toContain("Expires soon");
  });

  it("shows the activity log and exports it as CSV", async () => {
    renderPanel();
    expect(await screen.findByText("key.created")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /export csv/i }));
    await waitFor(() => {
      const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
      expect(calls.some((u) => u.includes("/saas/orgs/activity") && u.includes("format=csv"))).toBe(true);
    });
  });

  it("says so when there are no keys and no activity yet", async () => {
    vi.stubGlobal("fetch", respond({
      "/saas/orgs/security": { ...SUMMARY, keys: { ...SUMMARY.keys, active: 0 } },
      "/saas/orgs/keys": { keys: [] },
      "/saas/orgs/activity": { events: [], actions: [] },
    }));
    renderPanel();
    expect(await screen.findByText(/no scoped keys yet/i)).toBeTruthy();
    expect(await screen.findByText(/no administrative activity recorded/i)).toBeTruthy();
  });

  it("shows an error rather than an empty page when the API refuses", async () => {
    vi.stubGlobal("fetch", respond({
      "/saas/orgs/security": () => new Response(JSON.stringify({ detail: "This API key's scope is 'ingest'" }), { status: 403 }),
      "/saas/orgs/keys": () => new Response("{}", { status: 403 }),
      "/saas/orgs/activity": () => new Response("{}", { status: 403 }),
    }));
    renderPanel();
    // Each section reports its own failure; none silently renders empty.
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBe(3));
    const texts = screen.getAllByRole("alert").map((a) => a.textContent ?? "");
    // The API's own reason reaches the reader, not a generic failure.
    expect(texts.some((t) => t.includes("scope is 'ingest'"))).toBe(true);
  });

  it("shows single sign-on as not configured, with a form to set it up", async () => {
    renderPanel();
    expect(await screen.findByText(/single sign-on is not configured/i)).toBeTruthy();
    expect(screen.getByLabelText(/issuer/i)).toBeTruthy();
    expect(screen.getByLabelText(/allowed email domains/i)).toBeTruthy();
  });

  it("shows the configured identity provider without any secret", async () => {
    vi.stubGlobal("fetch", respond({
      "/saas/orgs/security": SUMMARY, "/saas/orgs/keys": KEYS, "/saas/orgs/activity": ACTIVITY,
      "/saas/orgs/sso": { sso: { org_id: "o", issuer: "https://idp.lakeside.example",
        client_id: "nhid-console", authorization_endpoint: "https://idp.lakeside.example/a",
        token_endpoint: "https://idp.lakeside.example/t", jwks_uri: "https://idp.lakeside.example/k",
        allowed_domains: ["lakeside.example"], default_role: "auditor", has_client_secret: true,
        updated_at: inDays(0), updated_by: "owner@example.org" } },
    }));
    renderPanel();
    const card = await screen.findByTestId("sso-status");
    expect(card.textContent).toContain("https://idp.lakeside.example");
    expect(card.textContent).toContain("lakeside.example");
    expect(card.textContent).toContain("auditor");
    expect(card.textContent).toContain("Client secret stored");
  });
});
