/**
 * The trust-center endpoints: the security summary, scoped keys and the
 * organization activity log. Every call carries the organization key and the
 * session cookie (`credentials: "include"`), because minting and revoking keys
 * need an owner's session as well as the key.
 */
import { apiUrl } from "./config";

export type KeyScope = "ingest" | "read" | "full";

export interface SecuritySummary {
  keys: { active: number; expiring_within_14_days: number;
          by_scope: Partial<Record<KeyScope, number>>; primary_key_prefix: string | null };
  members: { total: number; by_role: Record<string, number> };
  retention: { effective_days: number; policy_source: string;
               transcripts_held: number; oldest_held_at: string | null };
  activity: { events_last_30_days: number };
  controls: string[];
  gaps: { id: string; title: string; detail: string }[];
}

export interface ScopedKey {
  key_id: string; label: string; key_prefix: string; scope: KeyScope;
  created_at: string; created_by: string | null; expires_at: string;
  revoked_at: string | null; revoked_by: string | null;
  last_used_at: string | null; active: boolean;
}

export interface ActivityEvent {
  activity_id: string; occurred_at: string; actor: string; action: string;
  target: string | null; detail: Record<string, unknown>;
}

export class SecurityApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "SecurityApiError";
  }
}

async function call(path: string, apiKey: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(apiUrl(path), {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-API-Key": apiKey,
               ...(init.headers || {}) },
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`.trim();
    try {
      const body = await res.json();
      if (body?.detail) detail = String(body.detail);
    } catch { /* the status still says what went wrong */ }
    throw new SecurityApiError(res.status, detail);
  }
  return res;
}

export const securityApi = {
  summary: async (apiKey: string) =>
    (await call("/saas/orgs/security", apiKey)).json() as Promise<SecuritySummary>,
  keys: async (apiKey: string) =>
    ((await (await call("/saas/orgs/keys", apiKey)).json()) as { keys: ScopedKey[] }).keys,
  activity: async (apiKey: string) =>
    ((await (await call("/saas/orgs/activity?limit=200", apiKey)).json()) as
      { events: ActivityEvent[] }).events,
  exportActivity: async (apiKey: string, format: "csv" | "json") => {
    const res = await call(`/saas/orgs/activity?format=${format}&limit=10000`, apiKey);
    return format === "csv" ? res.text() : JSON.stringify(await res.json(), null, 2);
  },
  createKey: async (apiKey: string, body: { label: string; scope: KeyScope; expires_in_days: number }) =>
    (await call("/saas/orgs/keys", apiKey, { method: "POST", body: JSON.stringify(body) })).json() as
      Promise<ScopedKey & { api_key: string }>,
  revokeKey: async (apiKey: string, keyId: string) =>
    (await call(`/saas/orgs/keys/${encodeURIComponent(keyId)}`, apiKey, { method: "DELETE" })).json(),
};
