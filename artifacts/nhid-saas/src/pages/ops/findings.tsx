/**
 * Findings queue and finding detail.
 *
 * These are governance exceptions, not regulatory violations. Nothing here
 * asserts that a law was broken — that is a legal conclusion this product cannot
 * reach from a transcript.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { useOpsKey } from "@/hooks/use-nhid";
import { monitorApi, CATEGORY_LABEL, Finding } from "@/lib/monitoring-api";
import { OpsShell, StatusPill, AttestationPill } from "./ops-ui";

export function OpsFindings() {
  const apiKey = useOpsKey();
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState(
    new URLSearchParams(window.location.search).get("category") ?? "",
  );

  const { data, isLoading } = useQuery({
    queryKey: ["ops-findings", status, category],
    queryFn: () => monitorApi.listFindings(apiKey!, {
      status: status || undefined,
      category: category || undefined,
    }),
    enabled: !!apiKey,
  });

  const rows = data?.findings ?? [];

  return (
    <OpsShell title="Findings" active="/ops/findings"
      subtitle="Governance exceptions raised by the controls. Each one is something a human should look at.">
      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="under_review">Under review</option>
          <option value="resolved">Resolved</option>
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <span className="muted">{rows.length} shown</span>
      </div>

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        {isLoading ? <div className="empty">Loading…</div>
         : rows.length === 0 ? <div className="empty">No findings match.</div>
         : (
          <table>
            <thead>
              <tr>
                <th>Raised</th><th>Category</th><th>Control</th><th>Interaction</th>
                <th>Transcription</th><th>Status</th><th>Reviewer</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.finding_id}>
                  <td className="muted">{new Date(f.created_at).toLocaleDateString()}</td>
                  <td>{CATEGORY_LABEL[f.category] ?? f.category}</td>
                  <td>{f.control_id}</td>
                  <td><Link href={`/ops/interactions/${f.interaction_id}`}>{f.external_id}</Link></td>
                  <td>{f.transcription_status && <AttestationPill status={f.transcription_status} />}</td>
                  <td><StatusPill status={f.status} /></td>
                  <td className="muted">{f.reviewer ?? "—"}</td>
                  <td><Link href={`/ops/findings/${f.finding_id}`}>Review</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </OpsShell>
  );
}

export function OpsFindingDetail() {
  const apiKey = useOpsKey();
  const qc = useQueryClient();
  const [, params] = useRoute("/ops/findings/:id");
  const id = params?.id;

  const [reviewer, setReviewer] = useState("");
  const [notes, setNotes] = useState("");
  const [remediation, setRemediation] = useState("");
  const [minutes, setMinutes] = useState("");

  const { data: finding, isLoading } = useQuery({
    queryKey: ["ops-finding", id],
    queryFn: () => monitorApi.getFinding(apiKey!, id!),
    enabled: !!apiKey && !!id,
  });

  const update = useMutation({
    mutationFn: (body: Partial<Finding>) => monitorApi.updateFinding(apiKey!, id!, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ops-finding", id] });
      qc.invalidateQueries({ queryKey: ["ops-findings"] });
      qc.invalidateQueries({ queryKey: ["ops-metrics"] });
    },
  });

  const logTime = useMutation({
    mutationFn: () => monitorApi.recordTime(apiKey!, {
      assessment_id: finding!.assessment_id,
      activity: "finding_review",
      minutes: Number(minutes),
      finding_id: id,
      reviewer: reviewer || undefined,
    }),
    onSuccess: () => { setMinutes(""); qc.invalidateQueries({ queryKey: ["ops-metrics"] }); },
  });

  if (isLoading) return <OpsShell title="Finding" active="/ops/findings"><div className="empty">Loading…</div></OpsShell>;
  if (!finding) return <OpsShell title="Finding" active="/ops/findings"><div className="empty">Not found.</div></OpsShell>;

  return (
    <OpsShell title={CATEGORY_LABEL[finding.category] ?? finding.category} active="/ops/findings">
      <div className="card">
        <h2>Finding</h2>
        <dl className="kv">
          <dt>Control</dt><dd>{finding.control_id}</dd>
          <dt>Interaction</dt>
          <dd><Link href={`/ops/interactions/${finding.interaction_id}`}>{finding.external_id}</Link></dd>
          <dt>Raised</dt><dd>{new Date(finding.created_at).toLocaleString()}</dd>
          <dt>Status</dt><dd><StatusPill status={finding.status} /></dd>
          <dt>Resolution</dt><dd>{finding.resolution ?? <span className="muted">—</span>}</dd>
          <dt>Transcription</dt>
          <dd>{finding.transcription_status && (
            <AttestationPill status={finding.transcription_status} wer={finding.transcription_wer} />
          )}</dd>
        </dl>
        <p style={{ marginTop: 14 }}><strong>Why this was raised:</strong> {finding.summary}</p>
      </div>

      <div className="card">
        <h2>Review</h2>
        <div className="toolbar">
          <input placeholder="Reviewer" value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
        </div>
        <textarea placeholder="Review notes" value={notes} rows={3}
          onChange={(e) => setNotes(e.target.value)} style={{ width: "100%", marginBottom: 8 }} />
        <textarea placeholder="Remediation taken (if any)" value={remediation} rows={2}
          onChange={(e) => setRemediation(e.target.value)} style={{ width: "100%", marginBottom: 10 }} />
        <div className="toolbar">
          <button disabled={update.isPending}
            onClick={() => update.mutate({ status: "under_review", reviewer, notes })}>
            Mark under review
          </button>
          <button className="primary" disabled={update.isPending}
            onClick={() => update.mutate({
              status: "resolved", resolution: "remediated", reviewer, notes, remediation,
            })}>
            Resolve — remediated
          </button>
          <button disabled={update.isPending}
            onClick={() => update.mutate({ status: "resolved", resolution: "accepted", reviewer, notes })}>
            Resolve — accepted
          </button>
          <button disabled={update.isPending}
            onClick={() => update.mutate({ status: "resolved", resolution: "not_applicable", reviewer, notes })}>
            Resolve — not applicable
          </button>
        </div>
        <div className="toolbar" style={{ marginTop: 10 }}>
          <input type="number" placeholder="Minutes spent" value={minutes} style={{ width: 130 }}
            onChange={(e) => setMinutes(e.target.value)} />
          <button disabled={!minutes || logTime.isPending} onClick={() => logTime.mutate()}>
            Record review time
          </button>
          <span className="muted" style={{ fontSize: 12 }}>
            Recorded as effort. No saving is computed from it.
          </span>
        </div>
      </div>

      <div className="card">
        <h2>Review history</h2>
        {!finding.review_history?.length ? (
          <div className="muted">No review activity yet.</div>
        ) : (
          <table>
            <thead><tr><th>When</th><th>Action</th><th>Reviewer</th><th>Note</th></tr></thead>
            <tbody>
              {finding.review_history.map((r) => (
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
    </OpsShell>
  );
}
