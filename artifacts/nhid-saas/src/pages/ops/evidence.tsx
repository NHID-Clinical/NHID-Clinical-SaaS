/**
 * Evidence view — "show me exactly what supports this finding".
 *
 * Evidence here is the interaction, the turn the control read, the control result
 * and its explanation, the transcription attestation, and the review history.
 * It deliberately reuses the existing audit chain rather than inventing a second
 * evidence store.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useApiKey } from "@/hooks/use-nhid";
import { monitorApi, CATEGORY_LABEL } from "@/lib/monitoring-api";
import { OpsShell, ResultPill, AttestationPill } from "./ops-ui";

export default function OpsEvidence() {
  const apiKey = useApiKey();
  const [selected, setSelected] = useState<string>("");

  const { data: findings } = useQuery({
    queryKey: ["ops-findings-evidence"],
    queryFn: () => monitorApi.listFindings(apiKey!),
    enabled: !!apiKey,
  });

  const finding = (findings?.findings ?? []).find((f) => f.finding_id === selected);

  const { data: interaction } = useQuery({
    queryKey: ["ops-evidence-interaction", finding?.interaction_id],
    queryFn: () => monitorApi.getInteraction(apiKey!, finding!.interaction_id),
    enabled: !!apiKey && !!finding,
  });

  const { data: full } = useQuery({
    queryKey: ["ops-evidence-finding", selected],
    queryFn: () => monitorApi.getFinding(apiKey!, selected),
    enabled: !!apiKey && !!selected,
  });

  const evaluation = interaction?.evaluations.find((e) => e.control_id === finding?.control_id);

  return (
    <OpsShell title="Evidence" active="/ops/evidence"
      subtitle="What supports a finding: the interaction, the control result, the transcript it was read from, and who reviewed it.">
      <div className="toolbar">
        <select value={selected} onChange={(e) => setSelected(e.target.value)} style={{ minWidth: 420 }}>
          <option value="">Select a finding…</option>
          {(findings?.findings ?? []).map((f) => (
            <option key={f.finding_id} value={f.finding_id}>
              {f.external_id} — {CATEGORY_LABEL[f.category] ?? f.category} ({f.control_id})
            </option>
          ))}
        </select>
      </div>

      {!finding && <div className="card"><div className="empty">Select a finding to inspect its evidence.</div></div>}

      {finding && interaction && (
        <>
          <div className="card">
            <h2>Evidence record</h2>
            <dl className="kv">
              <dt>Finding</dt><dd>{finding.finding_id}</dd>
              <dt>Category</dt><dd>{CATEGORY_LABEL[finding.category] ?? finding.category}</dd>
              <dt>Control</dt><dd>{finding.control_id}</dd>
              <dt>Result</dt><dd>{evaluation && <ResultPill result={evaluation.result} />}</dd>
              <dt>Interaction</dt>
              <dd><Link href={`/ops/interactions/${interaction.interaction_id}`}>{interaction.external_id}</Link></dd>
              <dt>Occurred</dt><dd>{new Date(interaction.occurred_at).toLocaleString()}</dd>
              <dt>Evaluated</dt><dd>{evaluation && new Date(evaluation.evaluated_at).toLocaleString()}</dd>
              <dt>Source</dt><dd>{interaction.source_vendor} · {interaction.source_type}</dd>
              <dt>Transcription</dt>
              <dd><AttestationPill status={interaction.transcription_status} wer={interaction.transcription_wer} /></dd>
            </dl>
          </div>

          <div className="card">
            <h2>Why the control reached this result</h2>
            <p>{evaluation?.explanation ?? finding.summary}</p>
            {interaction.transcription_status === "unattested" && (
              <div className="notice" style={{ marginTop: 12, marginBottom: 0 }}>
                The precision of this evidence is unstated: no transcription-quality figure was
                supplied for the path that produced this transcript.
              </div>
            )}
          </div>

          <div className="card">
            <h2>Transcript read by the control</h2>
            <div className="transcript">
              {interaction.turns.map((t, i) => (
                <div className="turn" key={i}>
                  <span className="muted">
                    {t.offset_ms != null ? `${(t.offset_ms / 1000).toFixed(1)}s` : `#${i}`}
                  </span>
                  <span className={`who ${t.speaker}`}>{t.speaker}</span>
                  <span>{t.text}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h2>Review history</h2>
            {!full?.review_history?.length ? (
              <div className="muted">No review activity recorded.</div>
            ) : (
              <table>
                <thead><tr><th>When</th><th>Action</th><th>Reviewer</th><th>Note</th></tr></thead>
                <tbody>
                  {full.review_history.map((r) => (
                    <tr key={r.review_event_id}>
                      <td className="muted">{new Date(r.created_at).toLocaleString()}</td>
                      <td>{r.action.replace("_", " ")}</td>
                      <td>{r.reviewer}</td>
                      <td>{r.note ?? <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </OpsShell>
  );
}
