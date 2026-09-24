/**
 * Healthcare Voice-AI Governance Assessment.
 *
 * An assessment of observed governance controls over a stated set of
 * interactions. It is not a certification, a compliance certificate, a trust
 * assessment or an approval, and the limitations section says so on the page
 * rather than in a footnote nobody reads.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApiKey } from "@/hooks/use-nhid";
import { monitorApi, fmtPct, CATEGORY_LABEL } from "@/lib/monitoring-api";
import { OpsShell, Metric } from "./ops-ui";

export default function OpsReports() {
  const apiKey = useApiKey();
  const initial = new URLSearchParams(window.location.search).get("assessment") ?? "";
  const [selected, setSelected] = useState(initial);

  const { data: assessments } = useQuery({
    queryKey: ["ops-assessments"],
    queryFn: () => monitorApi.listAssessments(apiKey!),
    enabled: !!apiKey,
  });

  const { data: report, isLoading } = useQuery({
    queryKey: ["ops-report", selected],
    queryFn: () => monitorApi.report(apiKey!, selected),
    enabled: !!apiKey && !!selected,
  });

  return (
    <OpsShell title="Reports" active="/ops/reports"
      subtitle="Generate a governance assessment over a selected monitoring run.">
      <div className="toolbar">
        <select value={selected} onChange={(e) => setSelected(e.target.value)} style={{ minWidth: 320 }}>
          <option value="">Select an assessment…</option>
          {(assessments?.assessments ?? []).map((a) => (
            <option key={a.assessment_id} value={a.assessment_id}>{a.name}</option>
          ))}
        </select>
        {report && <button onClick={() => window.print()}>Print</button>}
      </div>

      {!selected && <div className="card"><div className="empty">Select an assessment.</div></div>}
      {selected && isLoading && <div className="card"><div className="empty">Generating…</div></div>}

      {report && (
        <>
          <div className="card">
            <h1 style={{ marginBottom: 2 }}>{report.title}</h1>
            <div className="muted" style={{ fontSize: 13 }}>
              {report.assessment.name} · generated {new Date(report.generated_at).toLocaleString()}
            </div>
          </div>

          {report.synthetic_records > 0 && (
            <div className="notice">
              <strong>{report.synthetic_records}</strong> of the interactions in this assessment are
              synthetic demonstration records, not observed traffic.
            </div>
          )}

          <div className="grid">
            <Metric label="Interactions analyzed" value={report.metrics.interactions_analyzed}
              denominator={`${report.metrics.interactions_evaluated} evaluated`} />
            <Metric label="Non-human observations" value={report.metrics.non_human_interactions}
              denominator={`of ${report.metrics.non_human_denominator} evaluated`} />
            <Metric label="Disclosure observations" value={report.metrics.disclosure.disclosed}
              denominator={`of ${report.metrics.disclosure.denominator} · ${fmtPct(report.metrics.disclosure.rate)}`} />
            <Metric label="Protected data before disclosure"
              value={report.metrics.phi_before_disclosure.count}
              denominator={`of ${report.metrics.phi_before_disclosure.denominator}`} />
          </div>

          <div className="card">
            <h2>Impersonation Latency distribution</h2>
            <p className="muted" style={{ marginTop: 0, fontSize: 12.5 }}>
              {report.metrics.impersonation_latency.definition}
            </p>
            <table>
              <thead><tr><th>Measure</th><th>Value</th><th>Denominator</th></tr></thead>
              <tbody>
                <tr>
                  <td>Disclosed on the opening turn</td>
                  <td>{report.metrics.impersonation_latency.disclosed_on_opening_turn}</td>
                  <td className="muted">of {report.metrics.impersonation_latency.measured_over} measured</td>
                </tr>
                <tr>
                  <td>Median latency (turns)</td>
                  <td>{report.metrics.impersonation_latency.turns_median ?? "—"}</td>
                  <td className="muted">{report.metrics.impersonation_latency.measured_over} measured</td>
                </tr>
                <tr>
                  <td>Maximum latency (turns)</td>
                  <td>{report.metrics.impersonation_latency.turns_max ?? "—"}</td>
                  <td className="muted">—</td>
                </tr>
                <tr>
                  <td>Median latency (seconds)</td>
                  <td>{report.metrics.impersonation_latency.seconds_median ?? "—"}</td>
                  <td className="muted">where turn offsets were supplied</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="card">
            <h2>Escalation</h2>
            <table>
              <thead><tr><th>Outcome</th><th>Count</th></tr></thead>
              <tbody>
                <tr><td>Requested</td><td>{report.metrics.escalation.requested}</td></tr>
                <tr><td>Completed</td><td>{report.metrics.escalation.completed}</td></tr>
                <tr><td>Not completed</td><td>{report.metrics.escalation.not_completed}</td></tr>
                <tr>
                  <td>Outcome unknown</td>
                  <td>{report.metrics.escalation.outcome_unknown}</td>
                </tr>
              </tbody>
            </table>
            <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
              "Outcome unknown" is reported rather than resolved in either direction: completion
              was neither observed nor refused in the transcript.
            </p>
          </div>

          <div className="grid">
            <Metric label="Open findings" value={report.metrics.findings.open}
              denominator={`${report.metrics.findings.resolved} resolved`} />
            <Metric label="Evidence completeness"
              value={fmtPct(report.metrics.evidence_completeness.fraction)}
              denominator={`${report.metrics.evidence_completeness.evaluated} of ${report.metrics.evidence_completeness.denominator}`} />
            <Metric label="Transcription attested"
              value={fmtPct(report.metrics.transcription_attestation.fraction_attested)}
              denominator={`${report.metrics.transcription_attestation.unattested} unattested`} />
          </div>

          {Object.keys(report.metrics.findings.by_category).length > 0 && (
            <div className="card">
              <h2>Findings by category</h2>
              <table>
                <thead><tr><th>Category</th><th>Count</th></tr></thead>
                <tbody>
                  {Object.entries(report.metrics.findings.by_category).map(([c, n]) => (
                    <tr key={c}><td>{CATEGORY_LABEL[c] ?? c}</td><td>{n}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="card">
            <h2>Methodology</h2>
            <p>{report.methodology}</p>
          </div>

          <div className="card">
            <h2>Scope and limitations</h2>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {report.limitations.map((l, i) => (
                <li key={i} style={{ marginBottom: 8 }}>{l}</li>
              ))}
            </ul>
          </div>
        </>
      )}
    </OpsShell>
  );
}
