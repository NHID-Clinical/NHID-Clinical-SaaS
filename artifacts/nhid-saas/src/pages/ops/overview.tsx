/**
 * Governance operations overview.
 *
 * Not an executive dashboard. Every figure is computed from stored rows and shows
 * the denominator it was computed over. There is no composite score, no trust
 * tier and no "AI safety" percentage — those were withdrawn, and nothing here
 * reintroduces them under a new name.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useApiKey } from "@/hooks/use-nhid";
import { monitorApi, fmtPct, CATEGORY_LABEL } from "@/lib/monitoring-api";
import { OpsShell, Metric, SyntheticNotice } from "./ops-ui";

export default function OpsOverview() {
  const apiKey = useApiKey();

  const { data: metrics, isLoading } = useQuery({
    queryKey: ["ops-metrics"],
    queryFn: () => monitorApi.metrics(apiKey!),
    enabled: !!apiKey,
  });

  const { data: interactions } = useQuery({
    queryKey: ["ops-interactions-synthetic"],
    queryFn: () => monitorApi.listInteractions(apiKey!),
    enabled: !!apiKey,
  });

  const synthetic = (interactions?.interactions ?? []).filter((i) => i.is_synthetic).length;

  if (isLoading) {
    return <OpsShell title="Governance operations" active="/ops"><div className="empty">Loading…</div></OpsShell>;
  }

  if (!metrics || metrics.interactions_analyzed === 0) {
    return (
      <OpsShell title="Governance operations" active="/ops"
        subtitle="Monitor voice-AI interactions against defined governance controls.">
        <div className="card">
          <h2>No interactions yet</h2>
          <p className="muted">
            Create an assessment and upload interactions you already have — call transcripts or
            event exports. Nothing in your production telephony needs to change.
          </p>
          <Link href="/ops/assessments"><button className="primary">Go to assessments</button></Link>
        </div>
      </OpsShell>
    );
  }

  const il = metrics.impersonation_latency;
  const esc = metrics.escalation;

  return (
    <OpsShell
      title="Governance operations"
      subtitle="Observed conduct at the interaction boundary. Every figure states its denominator."
      active="/ops"
    >
      <SyntheticNotice count={synthetic} />

      <div className="grid">
        <Metric label="Interactions analyzed" value={metrics.interactions_analyzed}
          denominator={`${metrics.interactions_evaluated} evaluated`} />
        <Metric label="Non-human interactions" value={metrics.non_human_interactions}
          denominator={`of ${metrics.non_human_denominator} evaluated`} />
        <Metric label="Disclosure rate" value={fmtPct(metrics.disclosure.rate)}
          denominator={`${metrics.disclosure.disclosed} of ${metrics.disclosure.denominator} non-human`} />
        <Metric label="Disclosed on opening turn" value={il.disclosed_on_opening_turn}
          denominator={`of ${il.measured_over} with a measurable latency`} />
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Impersonation Latency</h2>
        <p className="muted" style={{ fontSize: 12.5, marginTop: 0 }}>{il.definition}</p>
        <div className="grid">
          <Metric label="Median (turns)" value={il.turns_median ?? "—"}
            denominator={`over ${il.measured_over} disclosed interactions`} />
          <Metric label="Maximum (turns)" value={il.turns_max ?? "—"} />
          <Metric label="Median (seconds)" value={il.seconds_median ?? "—"}
            denominator="where turn offsets were supplied" />
        </div>
      </div>

      <div className="grid">
        <Metric label="Protected data before disclosure"
          value={metrics.phi_before_disclosure.count}
          denominator={`of ${metrics.phi_before_disclosure.denominator} evaluated`} />
        <Metric label="Escalation requested" value={esc.requested}
          denominator={`${esc.completed} completed · ${esc.not_completed} not completed`} />
        <Metric label="Escalation outcome unknown" value={esc.outcome_unknown}
          denominator={`of ${esc.requested} requested`} />
        <Metric label="Open findings" value={metrics.findings.open}
          denominator={`${metrics.findings.under_review} under review · ${metrics.findings.resolved} resolved`} />
      </div>

      <div className="grid">
        <Metric label="Evidence completeness"
          value={fmtPct(metrics.evidence_completeness.fraction)}
          denominator={`${metrics.evidence_completeness.evaluated} of ${metrics.evidence_completeness.denominator} evaluated`} />
        <Metric label="Transcription attested"
          value={fmtPct(metrics.transcription_attestation.fraction_attested)}
          denominator={`${metrics.transcription_attestation.unattested} unattested`} />
        <Metric label="Review effort recorded"
          value={`${metrics.review_effort_minutes.toFixed(0)} min`}
          denominator="measurement only — no saving is computed" />
      </div>

      {metrics.transcription_attestation.unattested > 0 && (
        <div className="notice">
          {metrics.transcription_attestation.unattested} interaction
          {metrics.transcription_attestation.unattested === 1 ? " carries" : "s carry"} no
          transcription-quality attestation. NHID evaluates transcripts and does not establish
          how accurate they are, so findings on those interactions rest on a precision nobody
          has stated.
        </div>
      )}

      {Object.keys(metrics.findings.by_category).length > 0 && (
        <div className="card">
          <h2>Findings by category</h2>
          <table>
            <thead><tr><th>Category</th><th style={{ width: 90 }}>Count</th><th /></tr></thead>
            <tbody>
              {Object.entries(metrics.findings.by_category)
                .sort((a, b) => b[1] - a[1])
                .map(([cat, n]) => (
                  <tr key={cat}>
                    <td>{CATEGORY_LABEL[cat] ?? cat}</td>
                    <td>{n}</td>
                    <td><Link href={`/ops/findings?category=${cat}`}>Review</Link></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </OpsShell>
  );
}
