/**
 * Assessments — the repeated-monitoring model, plus ingestion.
 *
 * An assessment is a named, date-ranged run. Running one every quarter is what
 * turns this from a report generator into a monitoring service.
 *
 * Ingestion is upload-based on purpose: requiring a production telephony
 * integration before a payer can see anything would destroy the only property
 * that makes this adoptable, which is that nothing in production has to change.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { useOpsKey } from "@/hooks/use-nhid";
import { monitorApi } from "@/lib/monitoring-api";
import { OpsShell } from "./ops-ui";
import { DEMO_INTERACTIONS } from "./demo-data";

export default function OpsAssessments() {
  const apiKey = useOpsKey();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [vendor, setVendor] = useState("generic");
  const [payload, setPayload] = useState("");
  const [target, setTarget] = useState("");
  const [message, setMessage] = useState("");

  const { data } = useQuery({
    queryKey: ["ops-assessments"],
    queryFn: () => monitorApi.listAssessments(apiKey!),
    enabled: !!apiKey,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["ops-assessments"] });
    qc.invalidateQueries({ queryKey: ["ops-metrics"] });
    qc.invalidateQueries({ queryKey: ["ops-interactions"] });
    qc.invalidateQueries({ queryKey: ["ops-findings"] });
  };

  const create = useMutation({
    mutationFn: () => monitorApi.createAssessment(apiKey!, { name }),
    onSuccess: () => { setName(""); refresh(); },
  });

  const ingest = useMutation({
    mutationFn: async (interactions: unknown[]) => {
      const res = await monitorApi.ingest(apiKey!, {
        assessment_id: target, vendor, interactions,
        is_synthetic: interactions === DEMO_INTERACTIONS,
      });
      const evalRes = await monitorApi.evaluate(apiKey!, target);
      return { res, evalRes };
    },
    onSuccess: ({ res, evalRes }) => {
      setMessage(
        `Ingested ${res.ingested}, evaluated ${evalRes.evaluated}, ` +
        `${evalRes.findings_created} finding(s) raised.` +
        (res.errors.length ? ` ${res.errors.length} rejected.` : ""),
      );
      setPayload("");
      refresh();
    },
    onError: (e: Error) => setMessage(`Failed: ${e.message}`),
  });

  const uploadPasted = () => {
    try {
      const parsed = JSON.parse(payload);
      ingest.mutate(Array.isArray(parsed) ? parsed : [parsed]);
    } catch (e) {
      setMessage(`Could not parse JSON: ${(e as Error).message}`);
    }
  };

  const assessments = data?.assessments ?? [];

  return (
    <OpsShell title="Assessments" active="/ops/assessments"
      subtitle="A named, date-ranged monitoring run. Run one each quarter and compare.">

      <div className="card">
        <h2>New assessment</h2>
        <div className="toolbar">
          <input placeholder="e.g. Q3 2026 inbound baseline" value={name} style={{ minWidth: 320 }}
            onChange={(e) => setName(e.target.value)} />
          <button className="primary" disabled={!name || create.isPending}
            onClick={() => create.mutate()}>Create</button>
        </div>
      </div>

      <div className="card">
        <h2>Ingest interactions</h2>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          Upload transcripts or event exports you already have. Paste an array of interactions,
          or load the synthetic demonstration set to see the workflow end to end.
        </p>
        <div className="toolbar">
          <select value={target} onChange={(e) => setTarget(e.target.value)} style={{ minWidth: 260 }}>
            <option value="">Select assessment…</option>
            {assessments.map((a) => (
              <option key={a.assessment_id} value={a.assessment_id}>{a.name}</option>
            ))}
          </select>
          <select value={vendor} onChange={(e) => setVendor(e.target.value)}>
            <option value="generic">generic</option>
            <option value="twilio">twilio</option>
            <option value="vapi">vapi</option>
          </select>
          <button disabled={!target || ingest.isPending}
            onClick={() => { setVendor("generic"); ingest.mutate(DEMO_INTERACTIONS); }}>
            Load synthetic demo set ({DEMO_INTERACTIONS.length})
          </button>
        </div>
        <textarea rows={7} value={payload} onChange={(e) => setPayload(e.target.value)}
          placeholder='[{"external_id":"CALL-1","occurred_at":"2026-09-01T10:00:00Z","ai_assessment":"non_human","turns":[{"speaker":"agent","text":"I am an automated system.","offset_ms":0}]}]'
          style={{ width: "100%", fontFamily: "ui-monospace, monospace", fontSize: 12 }} />
        <div className="toolbar" style={{ marginTop: 8 }}>
          <button className="primary" disabled={!target || !payload || ingest.isPending}
            onClick={uploadPasted}>Ingest and evaluate</button>
          {message && <span className="muted">{message}</span>}
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {assessments.length === 0 ? <div className="empty">No assessments yet.</div> : (
          <table>
            <thead>
              <tr><th>Name</th><th>Period</th><th>Interactions</th><th>Open findings</th>
                <th>Created</th><th /></tr>
            </thead>
            <tbody>
              {assessments.map((a) => (
                <tr key={a.assessment_id}>
                  <td>
                    {a.name}
                    {a.is_synthetic && <span className="pill pill-neutral" style={{ marginLeft: 6 }}>synthetic</span>}
                  </td>
                  <td className="muted">
                    {a.period_start ? new Date(a.period_start).toLocaleDateString() : "—"}
                    {" – "}
                    {a.period_end ? new Date(a.period_end).toLocaleDateString() : "—"}
                  </td>
                  <td>{a.interaction_count ?? 0}</td>
                  <td>{a.open_findings ? <span className="pill pill-exception">{a.open_findings}</span> : "—"}</td>
                  <td className="muted">{new Date(a.created_at).toLocaleDateString()}</td>
                  <td><Link href={`/ops/reports?assessment=${a.assessment_id}`}>Report</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </OpsShell>
  );
}
