/** Interaction queue — what a QA analyst works through. */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useApiKey } from "@/hooks/use-nhid";
import { monitorApi } from "@/lib/monitoring-api";
import { OpsShell, AttestationPill, SyntheticNotice } from "./ops-ui";

const ESCALATION_LABEL: Record<string, string> = {
  escalation_not_requested: "—",
  escalation_requested: "requested",
  escalation_completed: "completed",
  escalation_not_completed: "not completed",
  escalation_outcome_unknown: "unknown",
};

export default function OpsInteractions() {
  const apiKey = useApiKey();
  const [search, setSearch] = useState("");
  const [assessment, setAssessment] = useState("");

  const { data: assessments } = useQuery({
    queryKey: ["ops-assessments"],
    queryFn: () => monitorApi.listAssessments(apiKey!),
    enabled: !!apiKey,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["ops-interactions", search, assessment],
    queryFn: () => monitorApi.listInteractions(apiKey!, {
      search: search || undefined,
      assessment_id: assessment || undefined,
    }),
    enabled: !!apiKey,
  });

  const rows = data?.interactions ?? [];
  const synthetic = rows.filter((r) => r.is_synthetic).length;

  return (
    <OpsShell title="Interactions" active="/ops/interactions"
      subtitle="Every interaction ingested, with what each control observed.">
      <SyntheticNotice count={synthetic} />

      <div className="toolbar">
        <input placeholder="Search by interaction ID or vendor…" value={search}
          onChange={(e) => setSearch(e.target.value)} style={{ minWidth: 280 }} />
        <select value={assessment} onChange={(e) => setAssessment(e.target.value)}>
          <option value="">All assessments</option>
          {(assessments?.assessments ?? []).map((a) => (
            <option key={a.assessment_id} value={a.assessment_id}>{a.name}</option>
          ))}
        </select>
        <span className="muted">{rows.length} shown</span>
      </div>

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        {isLoading ? <div className="empty">Loading…</div>
         : rows.length === 0 ? <div className="empty">No interactions match.</div>
         : (
          <table>
            <thead>
              <tr>
                <th>Occurred</th>
                <th>Interaction</th>
                <th>Vendor</th>
                <th>Non-human</th>
                <th>Disclosed</th>
                <th>Imp. latency</th>
                <th>PHI before</th>
                <th>Escalation</th>
                <th>Transcription</th>
                <th>Findings</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.interaction_id}>
                  <td className="muted">{new Date(r.occurred_at).toLocaleString()}</td>
                  <td>
                    <Link href={`/ops/interactions/${r.interaction_id}`}>{r.external_id}</Link>
                    {r.is_synthetic && <span className="pill pill-neutral" style={{ marginLeft: 6 }}>synthetic</span>}
                  </td>
                  <td>{r.source_vendor}</td>
                  <td>{r.ai_assessment === "non_human" ? "yes"
                      : r.ai_assessment === "human" ? "no" : <span className="muted">unknown</span>}</td>
                  <td>{r.facts ? (r.facts.disclosed ? "yes" : <span className="pill pill-exception">no</span>) : "—"}</td>
                  <td>{r.facts?.impersonation_latency_turns ?? "—"}
                    {r.facts?.impersonation_latency_turns === 0 && <span className="muted"> turns</span>}</td>
                  <td>{r.facts?.phi_before_disclosure
                    ? <span className="pill pill-exception">yes</span>
                    : <span className="muted">no</span>}</td>
                  <td>{r.facts
                    ? (r.facts.escalation_state === "escalation_outcome_unknown"
                        ? <span className="pill pill-unknown">unknown</span>
                        : ESCALATION_LABEL[r.facts.escalation_state] ?? "—")
                    : "—"}</td>
                  <td><AttestationPill status={r.transcription_status} wer={r.transcription_wer} /></td>
                  <td>{r.open_findings > 0
                    ? <span className="pill pill-exception">{r.open_findings} open</span>
                    : <span className="muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </OpsShell>
  );
}
