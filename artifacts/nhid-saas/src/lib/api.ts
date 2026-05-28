/** Typed fetch helpers for the NHID Clinical SaaS gateway (Python FastAPI, port 8010). */

const BASE = "/saas-api";

export type Plan = "free" | "pro" | "enterprise";

export interface OrgProfile {
  org_id: string;
  org_name: string;
  plan: Plan;
  plan_details: PlanDetails;
  created_at: string;
  usage_count: number;
  rate_limit: RateLimit;
  upgrade: UpgradePath;
}

export interface PlanDetails {
  name: string;
  daily_limit: number | null;
  monthly_limit: number | null;
  rate_limit_rpm: number;
  features: string[];
  price_usd: number | null;
}

export interface RateLimit {
  allowed: boolean;
  remaining: number | null;
  limit: number | null;
  plan?: Plan;
}

export interface UpgradePath {
  upgrade_available: boolean;
  next_plan?: string;
  next_plan_details?: PlanDetails;
  stripe_checkout_url: string | null;
}

export interface UsageSummary {
  total_requests: number;
  today_requests: number;
  by_endpoint: Array<{ endpoint: string; count: number }>;
  rate_limit: RateLimit;
  plan: Plan;
}

export interface ActivityEntry {
  id: number;
  org_id: string;
  endpoint: string;
  method: string;
  status_code: number | null;
  session_id: string | null;
  timestamp: string;
}

export interface TraceRequest {
  session_id: string;
  event_type: string;
  state_before: string;
  state_after: string;
  input_text?: string;
  policy_action?: string;
  reason_code?: string;
  response_text?: string;
  request_id?: string;
}

export interface ProofResult {
  session_id: string;
  org_id: string;
  valid_chain: boolean;
  event_count: number;
  trace: Record<string, unknown>;
}

export interface CreateOrgResult {
  org_id: string;
  org_name: string;
  api_key: string;
  plan: Plan;
}

class ApiError extends Error {
  constructor(public status: number, public detail: string) {
    super(detail);
  }
}

async function req<T>(
  path: string,
  opts: RequestInit = {},
  apiKey?: string,
  adminKey?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string>),
  };
  if (apiKey) headers["X-API-Key"] = apiKey;
  if (adminKey) headers["X-Admin-Key"] = adminKey;

  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail ?? detail;
    } catch (_) {}
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  /** Check if the gateway is reachable. */
  health: () => req<{ ok: boolean; service: string }>("/saas/health"),

  /** Create a new org (admin operation). */
  createOrg: (orgName: string, plan: Plan = "free", adminKey: string): Promise<CreateOrgResult> =>
    req<CreateOrgResult>(
      "/saas/admin/orgs",
      { method: "POST", body: JSON.stringify({ org_name: orgName, plan }) },
      undefined,
      adminKey,
    ),

  /** Fetch the authenticated org's profile. */
  getMe: (apiKey: string) => req<OrgProfile>("/saas/orgs/me", {}, apiKey),

  /** Get usage summary. */
  getUsage: (apiKey: string) => req<UsageSummary>("/saas/usage", {}, apiKey),

  /** Get recent activity log (default 20 entries). */
  getRecent: (apiKey: string, limit = 20) =>
    req<{ activity: ActivityEntry[] }>(
      `/saas/usage/recent?limit=${limit}`,
      {},
      apiKey,
    ),

  /** Append a trace event to a session. */
  trace: (apiKey: string, data: TraceRequest) =>
    req<{ ok: boolean; session_id: string; request_id: string }>(
      "/saas/trace",
      { method: "POST", body: JSON.stringify(data) },
      apiKey,
    ),

  /** Retrieve the proof/audit trail for a session. */
  proof: (apiKey: string, sessionId: string) =>
    req<ProofResult>(`/saas/proof/${sessionId}`, {}, apiKey),

  /** Replay events for a session. */
  replay: (apiKey: string, sessionId: string) =>
    req<{ session_id: string; events: unknown[]; event_count: number }>(
      `/saas/replay/${sessionId}`,
      {},
      apiKey,
    ),
};
