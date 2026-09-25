/**
 * Typed client for the monitoring and evidence product.
 *
 * BUSINESS HYPOTHESIS / NEEDS CUSTOMER VALIDATION: there are zero deployments and
 * zero pilots. Nothing in this UI may present the buyer, workflow or pricing as
 * validated.
 */

import demoFixture from "@/pages/ops/demo-fixture.json";

const BASE = "/saas-api";

export type ControlResult = "pass" | "exception" | "unknown" | "not_assessable";
export type FindingStatus = "open" | "under_review" | "resolved";
export type Resolution = "accepted" | "not_applicable" | "remediated";
export type AttestationStatus = "measured" | "attested" | "unattested";

export interface Assessment {
  assessment_id: string;
  name: string;
  period_start: string | null;
  period_end: string | null;
  status: string;
  is_synthetic: boolean;
  created_at: string;
  interaction_count?: number;
  open_findings?: number;
}

export interface InteractionFacts {
  turn_count: number;
  disclosed: boolean;
  disclosure_turn_index: number | null;
  impersonation_latency_turns: number | null;
  impersonation_latency_seconds: number | null;
  phi_requested: boolean;
  phi_before_disclosure: boolean;
  escalation_requested: boolean;
  escalation_state: string;
  transcription_status: AttestationStatus;
  transcription_wer: number | null;
}

export interface InteractionRow {
  interaction_id: string;
  external_id: string;
  occurred_at: string;
  source_vendor: string;
  source_type: string;
  ai_assessment: string;
  language: string | null;
  interpreter_present: boolean | null;
  transcription_status: AttestationStatus;
  transcription_wer: number | null;
  evaluation_status: string;
  is_synthetic: boolean;
  open_findings: number;
  facts: InteractionFacts | null;
}

export interface Turn {
  speaker: "agent" | "human" | "unknown";
  text: string;
  offset_ms: number | null;
}

export interface Evaluation {
  control_id: string;
  result: ControlResult;
  explanation: string;
  evaluated_at: string;
}

export interface Finding {
  finding_id: string;
  interaction_id: string;
  assessment_id: string;
  control_id: string;
  category: string;
  summary: string;
  status: FindingStatus;
  resolution: Resolution | null;
  reviewer: string | null;
  notes: string | null;
  remediation: string | null;
  created_at: string;
  resolved_at: string | null;
  external_id?: string;
  occurred_at?: string;
  source_vendor?: string;
  transcription_status?: AttestationStatus;
  transcription_wer?: number | null;
  review_history?: ReviewEvent[];
}

export interface ReviewEvent {
  review_event_id: string;
  action: string;
  reviewer: string;
  note: string | null;
  created_at: string;
}

export interface InteractionDetail extends InteractionRow {
  turns: Turn[];
  evaluations: Evaluation[];
  findings: Finding[];
  transcription_attestation: { status: AttestationStatus; wer: number | null; source: string | null } | null;
}

export interface Metrics {
  interactions_analyzed: number;
  interactions_evaluated: number;
  non_human_interactions: number;
  non_human_denominator: number;
  disclosure: { disclosed: number; denominator: number; rate: number | null };
  impersonation_latency: {
    definition: string;
    measured_over: number;
    turns_median: number | null;
    turns_max: number | null;
    disclosed_on_opening_turn: number;
    seconds_median: number | null;
  };
  phi_before_disclosure: { count: number; denominator: number; rate: number | null };
  escalation: {
    requested: number; completed: number; not_completed: number;
    outcome_unknown: number; completion_rate: number | null;
  };
  findings: {
    open: number; under_review: number; resolved: number;
    by_category: Record<string, number>;
  };
  evidence_completeness: { evaluated: number; denominator: number; fraction: number | null };
  transcription_attestation: {
    attested: number; denominator: number; unattested: number; fraction_attested: number | null;
  };
  review_effort_minutes: number;
}

export interface GovernanceReport {
  title: string;
  assessment: Assessment;
  generated_at: string;
  metrics: Metrics;
  methodology: string;
  limitations: string[];
  synthetic_records: number;
}

/**
 * Sentinel key that puts the Governance Ops screens into recorded-demo mode.
 *
 * The screens are entirely API-driven, so a build served without a reachable
 * backend renders empty and a visitor cannot even obtain a key -- registration
 * is itself an API call. Rather than reimplement the evaluator in TypeScript
 * (which would give the control engine a second opinion about its own controls,
 * free to drift), demo mode replays output the *real* Python evaluator actually
 * produced, recorded by `nhid-clinical/scripts/build_demo_fixture.py` and kept
 * honest by its `--check` mode in CI.
 */
export const DEMO_API_KEY = "__demo__";

export const isDemoKey = (apiKey: string | null | undefined) =>
  apiKey === DEMO_API_KEY;

/**
 * The recorded fixture, given the shape the screens expect.
 *
 * TypeScript infers the JSON's `details` map as an object with ten literal keys
 * (`"DEMO-0001"` and friends), which cannot be indexed by a runtime string. The
 * cast is through `unknown` because the JSON is generated from the API's own
 * responses -- the guarantee that the shapes agree comes from
 * `build_demo_fixture.py --check`, not from this file.
 */
const demo = demoFixture as unknown as {
  assessments: Assessment[];
  interactions: InteractionRow[];
  findings: Finding[];
  metrics: Metrics;
  report: GovernanceReport;
  details: Record<string, InteractionDetail>;
  finding_details: Finding[];
};

/** Serve a recorded response, or throw if the demo has nothing for this path. */
function demoResponse<T>(path: string, method: string): T {
  if (method !== "GET") {
    throw new Error(
      "This is a recorded demonstration, so it is read-only. Connect an " +
        "organization API key to ingest interactions, run an evaluation or " +
        "resolve a finding.",
    );
  }

  const [route] = path.split("?");
  const byId = new Map(
    demo.interactions.map((row) => [row.interaction_id, row.external_id]),
  );

  if (route === "/saas/monitor/assessments") return { assessments: demo.assessments } as T;
  if (route === "/saas/monitor/interactions") return { interactions: demo.interactions } as T;
  if (route === "/saas/monitor/findings") return { findings: demo.findings } as T;
  if (route === "/saas/monitor/metrics") return demo.metrics as T;

  const reportMatch = route.match(/^\/saas\/monitor\/assessments\/[^/]+\/report$/);
  if (reportMatch) return demo.report as T;

  const interactionMatch = route.match(/^\/saas\/monitor\/interactions\/(.+)$/);
  if (interactionMatch) {
    const externalId = byId.get(interactionMatch[1]);
    const detail = externalId ? demo.details[externalId] : undefined;
    if (detail) return detail as T;
    throw new Error("That interaction is not part of the recorded demonstration.");
  }

  const findingMatch = route.match(/^\/saas\/monitor\/findings\/(.+)$/);
  if (findingMatch) {
    const found = demo.finding_details.find((f) => f.finding_id === findingMatch[1]);
    if (found) return found as T;
    throw new Error("That finding is not part of the recorded demonstration.");
  }

  throw new Error(`No recorded response for ${route}.`);
}

async function req<T>(path: string, init: RequestInit, apiKey: string): Promise<T> {
  if (isDemoKey(apiKey)) return demoResponse<T>(path, init.method ?? "GET");

  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

const qs = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v && search.append(k, v));
  const s = search.toString();
  return s ? `?${s}` : "";
};

export const monitorApi = {
  listAssessments: (key: string) =>
    req<{ assessments: Assessment[] }>("/saas/monitor/assessments", {}, key),

  createAssessment: (key: string, body: { name: string; period_start?: string; period_end?: string; is_synthetic?: boolean }) =>
    req<Assessment>("/saas/monitor/assessments", { method: "POST", body: JSON.stringify(body) }, key),

  ingest: (key: string, body: { assessment_id: string; vendor: string; interactions: unknown[]; is_synthetic?: boolean }) =>
    req<{ ingested: number; interaction_ids: string[]; errors: { index: number; error: string }[] }>(
      "/saas/monitor/ingest", { method: "POST", body: JSON.stringify(body) }, key),

  evaluate: (key: string, assessmentId: string) =>
    req<{ evaluated: number; findings_created: number }>(
      `/saas/monitor/assessments/${assessmentId}/evaluate`, { method: "POST" }, key),

  listInteractions: (key: string, params: { assessment_id?: string; search?: string; status?: string } = {}) =>
    req<{ interactions: InteractionRow[] }>(`/saas/monitor/interactions${qs(params)}`, {}, key),

  getInteraction: (key: string, id: string) =>
    req<InteractionDetail>(`/saas/monitor/interactions/${id}`, {}, key),

  listFindings: (key: string, params: { assessment_id?: string; status?: string; category?: string } = {}) =>
    req<{ findings: Finding[] }>(`/saas/monitor/findings${qs(params)}`, {}, key),

  getFinding: (key: string, id: string) =>
    req<Finding>(`/saas/monitor/findings/${id}`, {}, key),

  updateFinding: (key: string, id: string, body: Partial<Pick<Finding, "status" | "resolution" | "reviewer" | "notes" | "remediation">>) =>
    req<Finding>(`/saas/monitor/findings/${id}`, { method: "PATCH", body: JSON.stringify(body) }, key),

  recordTime: (key: string, body: { assessment_id: string; activity: string; minutes: number; finding_id?: string; reviewer?: string }) =>
    req<{ time_entry_id: string }>("/saas/monitor/time-entries", { method: "POST", body: JSON.stringify(body) }, key),

  metrics: (key: string, assessmentId?: string) =>
    req<Metrics>(`/saas/monitor/metrics${qs({ assessment_id: assessmentId })}`, {}, key),

  report: (key: string, assessmentId: string) =>
    req<GovernanceReport>(`/saas/monitor/assessments/${assessmentId}/report`, {}, key),
};

/** Display helpers shared by the operations screens. */
export const RESULT_LABEL: Record<ControlResult, string> = {
  pass: "Pass",
  exception: "Exception",
  unknown: "Unknown",
  not_assessable: "Not assessable",
};

export const CATEGORY_LABEL: Record<string, string> = {
  disclosure_missing: "Disclosure missing",
  disclosure_delayed: "Disclosure delayed",
  phi_before_disclosure: "Protected data before disclosure",
  escalation_not_completed: "Escalation not completed",
  escalation_outcome_unknown: "Escalation outcome unknown",
  insufficient_evidence: "Insufficient evidence",
  transcription_quality_unattested: "Transcription quality unattested",
};

export const fmtPct = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : `${(v * 100).toFixed(1)}%`;

export const fmtNum = (v: number | null | undefined) =>
  v === null || v === undefined ? "—" : String(v);
