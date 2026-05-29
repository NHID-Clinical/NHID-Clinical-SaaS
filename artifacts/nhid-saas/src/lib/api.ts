/** Typed fetch helpers for the NHID Clinical SaaS gateway (Python FastAPI, port 8010). */

const BASE = "/saas-api";

export type Plan = "free" | "l1" | "l2" | "l3";
export type OrgStatus = "active" | "canceled" | "past_due";

export interface OrgProfile {
  org_id: string;
  org_name: string;
  plan: Plan;
  status: OrgStatus;
  billing_active: boolean;
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

export interface AuditEvent {
  event_id: string;
  seq_num: number;
  session_id: string;
  event_type: string | null;
  state_before: string | null;
  state_after: string | null;
  input_text: string | null;
  policy_action: string | null;
  reason_code: string | null;
  response_text: string | null;
  policy_version: string | null;
  model_version: string | null;
  timestamp: string;
  event_hash: string;
  hmac_signature: string;
  hash_ok: boolean;
  hmac_ok: boolean;
}

export interface AuditBreak {
  seq_num: number;
  event_id: string;
  reason: string;
}

export interface AuditProofResult {
  session_id: string;
  org_id: string;
  chain_valid: boolean;
  hmac_valid: boolean;
  event_count: number;
  breaks: AuditBreak[];
  events: AuditEvent[];
}

export interface AuditVerifyResult {
  session_id: string;
  org_id: string;
  chain_valid: boolean;
  hmac_valid: boolean;
  event_count: number;
  breaks: AuditBreak[];
}

export interface CreateOrgResult {
  org_id: string;
  org_name: string;
  api_key: string;
  plan: Plan;
}

export interface StripePlanEntry {
  plan: Plan;
  name: string;
  price_usd: number | null;
  amount_cents?: number;
  daily_limit: number | null;
  features: string[];
  price_id?: string;
}

export interface CheckoutResult {
  checkout_url: string;
  plan: Plan;
}

class ApiError extends Error {
  constructor(public status: number, public detail: string) {
    super(detail);
  }
}

export { ApiError };

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

export interface VoiceIncomingResult {
  session_id: string;
  action: "disclose";
  disclosure_text: string;
}

export interface VoiceTranscriptResult {
  action: "allow" | "disclose" | "escalate" | "block";
  reason_code: string | null;
  session_id: string;
  event_hash: string;
}

export interface VoicePolicyHistoryEntry {
  id: number;
  phrases: string[];
  version: string;
  created_at: string;
}

export interface VoicePolicyConfig {
  org_id: string;
  phrases: string[];
  version: string;
  is_custom: boolean;
  created_at: string | null;
  history: VoicePolicyHistoryEntry[];
}

export interface VoicePolicySaveResult {
  phrases: string[];
  version: string;
  created_at: string;
  is_custom: boolean;
}

export const api = {
  /** Check if the gateway is reachable. */
  health: () => req<{ ok: boolean; service: string }>("/saas/health"),

  /** Self-service org registration — free tier, no admin key required. */
  registerOrg: (orgName: string): Promise<CreateOrgResult> =>
    req<CreateOrgResult>(
      "/saas/orgs/register",
      { method: "POST", body: JSON.stringify({ org_name: orgName }) },
    ),

  /** Create a new org (admin operation, internal only). */
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

  /** Full audit proof with per-event HMAC + chain verification. */
  auditProof: (apiKey: string, sessionId: string) =>
    req<AuditProofResult>(`/saas/audit/proof/${sessionId}`, {}, apiKey),

  /** Cryptographic chain + HMAC verification (no event payloads). */
  auditVerify: (apiKey: string, sessionId: string) =>
    req<AuditVerifyResult>(`/saas/audit/verify/${sessionId}`, {}, apiKey),

  /** Replay events for a session. */
  replay: (apiKey: string, sessionId: string) =>
    req<{ session_id: string; events: unknown[]; event_count: number }>(
      `/saas/replay/${sessionId}`,
      {},
      apiKey,
    ),

  /** List available subscription plans with Stripe price data. */
  getPlans: () =>
    req<{ plans: StripePlanEntry[] }>("/saas/billing/plans"),

  /** Get the Stripe publishable key for client-side Stripe.js. */
  getPublishableKey: () =>
    req<{ publishable_key: string }>("/saas/billing/publishable-key"),

  /** Create a Stripe Checkout session for the given plan. Returns checkout URL. */
  createCheckout: (
    apiKey: string,
    plan: Plan,
    successUrl: string,
    cancelUrl: string,
  ): Promise<CheckoutResult> =>
    req<CheckoutResult>(
      "/saas/billing/checkout",
      {
        method: "POST",
        body: JSON.stringify({ plan, success_url: successUrl, cancel_url: cancelUrl }),
      },
      apiKey,
    ),

  /** Register an inbound voice call and get the opening disclosure. */
  voiceIncoming: (
    apiKey: string,
    payload: { caller_id?: string; metadata?: Record<string, unknown> },
  ): Promise<VoiceIncomingResult> =>
    req<VoiceIncomingResult>(
      "/saas/voice/incoming",
      { method: "POST", body: JSON.stringify(payload) },
      apiKey,
    ),

  /** Process a transcript chunk through the voice policy engine. */
  voiceTranscript: (
    apiKey: string,
    payload: { session_id: string; transcript_text: string; turn_number: number },
  ): Promise<VoiceTranscriptResult> =>
    req<VoiceTranscriptResult>(
      "/saas/voice/transcript",
      { method: "POST", body: JSON.stringify(payload) },
      apiKey,
    ),

  /** Get the org's current voice policy config (phrases + version history). */
  getVoicePolicy: (apiKey: string): Promise<VoicePolicyConfig> =>
    req<VoicePolicyConfig>("/saas/voice/policy", {}, apiKey),

  /** Save a new voice policy config for the org. */
  saveVoicePolicy: (apiKey: string, phrases: string[]): Promise<VoicePolicySaveResult> =>
    req<VoicePolicySaveResult>(
      "/saas/voice/policy",
      { method: "PUT", body: JSON.stringify({ phrases }) },
      apiKey,
    ),
};
