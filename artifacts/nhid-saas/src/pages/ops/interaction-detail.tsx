/**
 * Interaction detail — the screen that has to answer "why did NHID flag this?"
 * without anyone reading source code.
 *
 * Every control result carries the explanation the engine produced, next to the
 * transcript turn it was drawn from.
 */
import { useQuery } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { useOpsKey } from "@/hooks/use-nhid";
import { monitorApi, CATEGORY_LABEL } from "@/lib/monitoring-api";
import { OpsShell, ResultPill, StatusPill, AttestationPill } from "./ops-ui";

export default function OpsInteractionDetail() {
  const apiKey = useOpsKey();
  const [, params] = useRoute("/ops/interactions/:id");
  const id = params?.id;

  const { data, isLoading } = useQuery({
    queryKey: ["ops-interaction", id],
    queryFn: () => monitorApi.getInteraction(apiKey!, id!),
    enabled: !!apiKey && !!id,
  });

  if (isLoading) {
    return <OpsShell title="Interaction" active="/ops/interactions"><div className="empty">Loading…</div></OpsShell>;
  }
  if (!data) {
    return <OpsShell title="Interaction" active="/ops/interactions"><div className="empty">Not found.</div></OpsShell>;
  }

  const f = data.facts;
  const disclosureTurn = f?.disclosure_turn_index ?? -1;

  return (
    <OpsShell title={`Interaction ${data.external_id}`} active="/ops/interactions"
      subtitle={<Link href="/ops/interactions">← Back to interactions</Link> as unknown as string}>

      {data.is_synthetic && (
        <div className="notice">
          This is a synthetic demonstration record, not observed traffic.
        </div>
      )}

      <div className="card">
        <h2>Interaction</h2>
        <dl className="kv">
          <dt>Occurred</dt><dd>{new Date(data.occurred_at).toLocaleString()}</dd>
          <dt>Source</dt><dd>{data.source_vendor} · {data.source_type}</dd>
          <dt>Non-human</dt><dd>{data.ai_assessment}</dd>
          <dt>Language</dt><dd>{data.language ?? <span className="muted">not supplied</span>}</dd>
          <dt>Interpreter present</dt>
          <dd>{data.interpreter_present === null || data.interpreter_present === undefined
            ? <span className="muted">not supplied</span>
            : data.interpreter_present ? "yes" : "no"}</dd>
          <dt>Transcription</dt>
          <dd><AttestationPill status={data.transcription_status} wer={data.transcription_wer} /></dd>
          <dt>Impersonation Latency</dt>
          <dd>{f?.impersonation_latency_turns ?? "—"} turns
            {f?.impersonation_latency_seconds != null && ` · ${f.impersonation_latency_seconds}s`}</dd>
        </dl>
      </div>

      {data.transcription_status === "unattested" && (
        <div className="notice">
          No transcription-quality figure was supplied for this interaction. NHID evaluates
          the transcript and does not establish how accurate it is, so every result below rests
          on a precision nobody has stated. A mis-transcribed disclosure reads as a missing one,
          and a mis-transcribed escalation request produces no finding at all.
        </div>
      )}

      <div className="card">
        <h2>Control results</h2>
        <table>
          <thead><tr><th style={{ width: 90 }}>Control</th><th style={{ width: 130 }}>Result</th><th>Why</th></tr></thead>
          <tbody>
            {data.evaluations.map((e) => (
              <tr key={e.control_id}>
                <td><strong>{e.control_id}</strong></td>
                <td><ResultPill result={e.result} /></td>
                <td>{e.explanation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Transcript</h2>
        <div className="transcript">
          {data.turns.map((t, i) => (
            <div className="turn" key={i}
              style={i === disclosureTurn ? { background: "var(--ops-pass-soft)" } : undefined}>
              <span className="muted">
                {t.offset_ms != null ? `${(t.offset_ms / 1000).toFixed(1)}s` : `#${i}`}
              </span>
              <span className={`who ${t.speaker}`}>{t.speaker}</span>
              <span>
                {t.text}
                {i === disclosureTurn && (
                  <span className="pill pill-pass" style={{ marginLeft: 8 }}>disclosure</span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Findings</h2>
        {data.findings.length === 0 ? (
          <div className="muted">No findings were raised on this interaction.</div>
        ) : (
          <table>
            <thead><tr><th>Category</th><th>Control</th><th>Status</th><th>Summary</th><th /></tr></thead>
            <tbody>
              {data.findings.map((fi) => (
                <tr key={fi.finding_id}>
                  <td>{CATEGORY_LABEL[fi.category] ?? fi.category}</td>
                  <td>{fi.control_id}</td>
                  <td><StatusPill status={fi.status} /></td>
                  <td>{fi.summary}</td>
                  <td><Link href={`/ops/findings/${fi.finding_id}`}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </OpsShell>
  );
}
