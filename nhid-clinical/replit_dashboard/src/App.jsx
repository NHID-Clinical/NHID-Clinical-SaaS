import { useState, useCallback } from "react";
import { getHealth, getTrace, getProof, getSchema } from "../../replit_api_client.js";

// ── JSON renderer ────────────────────────────────────────────────────────────
function JsonBlock({ data }) {
  const str = JSON.stringify(data, null, 2).replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+\.?\d*)/g,
    (m) => {
      if (/^"/.test(m)) return /:$/.test(m) ? `<span style="color:#7dd3fc">${m}</span>` : `<span style="color:#86efac">${m}</span>`;
      if (/true|false/.test(m)) return `<span style="color:#f472b6">${m}</span>`;
      if (/null/.test(m)) return `<span style="color:#64748b">${m}</span>`;
      return `<span style="color:#fbbf24">${m}</span>`;
    }
  );
  return <pre className="json-out" dangerouslySetInnerHTML={{ __html: str }} />;
}

// ── Shared input row ─────────────────────────────────────────────────────────
function SessionInput({ label, value, onChange, onFetch, loading, placeholder }) {
  return (
    <div className="input-row">
      <div className="input-group">
        <label>{label}</label>
        <input
          type="text"
          placeholder={placeholder || "Enter session ID…"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !loading && onFetch()}
        />
      </div>
      <button className="btn-primary" onClick={onFetch} disabled={!value.trim() || loading}>
        {loading ? "Loading…" : "Fetch"}
      </button>
    </div>
  );
}

// ── HEALTH VIEW ──────────────────────────────────────────────────────────────
function HealthView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  async function fetch() {
    setLoading(true); setErr(null);
    const res = await getHealth();
    setLoading(false);
    if (!res.ok) { setErr(res.error); return; }
    setData(res);
  }

  return (
    <div>
      <div className="card">
        <div className="card-title">System Health</div>
        <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 14 }}>
          Checks that the bridge can reach the NHID-Clinical core modules.
        </p>
        <button className="btn-primary" onClick={fetch} disabled={loading}>
          {loading ? "Checking…" : "Check Health"}
        </button>

        {err && <div className="error-box">{err}</div>}

        {data && (
          <>
            <div className="health-grid section-gap">
              <div className="health-item">
                <div className="health-item-label">Bridge</div>
                <div className="health-item-value">
                  <span className="pill pill-green">
                    <span className="dot" style={{ width: 5, height: 5, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />
                    {data.bridge}
                  </span>
                </div>
              </div>
              <div className="health-item">
                <div className="health-item-label">Version</div>
                <div className="health-item-value" style={{ fontFamily: "var(--mono)" }}>{data.version}</div>
              </div>
              {Object.entries(data.modules || {}).map(([k, v]) => (
                <div className="health-item" key={k}>
                  <div className="health-item-label">{k}</div>
                  <div className="health-item-value">
                    <span className={`pill ${v === "ok" ? "pill-green" : "pill-red"}`}>{v}</span>
                  </div>
                </div>
              ))}
              <div className="health-item">
                <div className="health-item-label">Schema file</div>
                <div className="health-item-value">
                  <span className={`pill ${data.schema_file_exists ? "pill-green" : "pill-red"}`}>
                    {data.schema_file_exists ? "present" : "missing"}
                  </span>
                </div>
              </div>
            </div>
            <div className="json-wrap">
              <JsonBlock data={data} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── TRACE VIEW ───────────────────────────────────────────────────────────────
function TraceView() {
  const [sessionId, setSessionId] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  async function fetch() {
    setLoading(true); setErr(null); setData(null);
    const res = await getTrace(sessionId);
    setLoading(false);
    if (!res.ok) { setErr(res.error); return; }
    setData(res);
  }

  const events = data?.trace?.events || [];

  return (
    <div>
      <div className="card">
        <div className="card-title">Trace Viewer</div>
        <SessionInput
          label="Session ID"
          placeholder="e.g. CA1234567890abcdef"
          value={sessionId}
          onChange={setSessionId}
          onFetch={fetch}
          loading={loading}
        />
        {err && <div className="error-box">{err}</div>}
      </div>

      {data && (
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>Session: {data.session_id}</div>
            <span className="pill pill-blue">{events.length} events</span>
            {data.trace?.reconstructed_state?.state && (
              <span className="pill pill-muted">state: {data.trace.reconstructed_state.state}</span>
            )}
          </div>

          {events.length > 0 ? (
            <>
              <div className="events-header">
                <span>Event Type</span>
                <span>State Before</span>
                <span>State After</span>
                <span>Policy Action</span>
              </div>
              <div className="event-list">
                {events.map((ev, i) => (
                  <div className="event-row" key={i}>
                    <span className="event-row-type">{ev.event_type}</span>
                    <span className="event-row-state">{ev.state_before || "—"}</span>
                    <span className="event-row-state">{ev.state_after || "—"}</span>
                    <span className="event-row-action">{ev.policy_action || ev.reason_code || "—"}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="empty">No events for this session.</div>
          )}

          <div className="json-wrap">
            <JsonBlock data={data.trace} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── PROOF VIEW ───────────────────────────────────────────────────────────────
function ProofView() {
  const [sessionId, setSessionId] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  async function fetch() {
    setLoading(true); setErr(null); setData(null);
    const res = await getProof(sessionId);
    setLoading(false);
    if (!res.ok) { setErr(res.error); return; }
    setData(res);
  }

  return (
    <div>
      <div className="card">
        <div className="card-title">Proof Viewer</div>
        <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 14 }}>
          Retrieves the ordered event list for a session and verifies state-chain integrity.
        </p>
        <SessionInput
          label="Session ID"
          placeholder="e.g. CA1234567890abcdef"
          value={sessionId}
          onChange={setSessionId}
          onFetch={fetch}
          loading={loading}
        />
        {err && <div className="error-box">{err}</div>}
      </div>

      {data && (
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>Proof: {data.session_id}</div>
            <span className="pill pill-blue">{data.event_count} events</span>
            <span className={data.chain_valid ? "chain-valid" : "chain-invalid"}>
              {data.chain_valid ? "✓ Chain Valid" : "✗ Chain Invalid"}
            </span>
          </div>

          {(data.events || []).length > 0 ? (
            <>
              <div className="events-header">
                <span>Event Type</span>
                <span>State Before</span>
                <span>State After</span>
                <span>Timestamp</span>
              </div>
              <div className="event-list">
                {data.events.map((ev, i) => (
                  <div className="event-row" key={i}>
                    <span className="event-row-type">{ev.event_type}</span>
                    <span className="event-row-state">{ev.state_before || "—"}</span>
                    <span className="event-row-state">{ev.state_after || "—"}</span>
                    <span className="event-row-ts">{(ev.timestamp || "").slice(0, 19)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="empty">No events found.</div>
          )}

          <div className="json-wrap">
            <JsonBlock data={data} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── SCHEMA VIEW ──────────────────────────────────────────────────────────────
function SchemaView() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [raw, setRaw] = useState(false);

  async function fetch() {
    setLoading(true); setErr(null);
    const res = await getSchema();
    setLoading(false);
    if (!res.ok) { setErr(res.error); return; }
    setData(res.schema);
  }

  const props = data?.properties || {};
  const required = new Set(data?.required || []);

  return (
    <div>
      <div className="card">
        <div className="card-title">Schema Viewer</div>
        <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 14 }}>
          Displays <code style={{ fontFamily: "var(--mono)", color: "#7dd3fc" }}>nhid_trace_schema_v1.json</code> verbatim — read from disk, no modification.
        </p>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn-primary" onClick={fetch} disabled={loading}>
            {loading ? "Loading…" : "Load Schema"}
          </button>
          {data && (
            <button className="btn-primary" style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)" }} onClick={() => setRaw(r => !r)}>
              {raw ? "Table View" : "Raw JSON"}
            </button>
          )}
        </div>
        {err && <div className="error-box">{err}</div>}
      </div>

      {data && !raw && (
        <div className="card">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>{data.title}</div>
            <span className="pill pill-muted">{data["$id"]?.split("/").pop()}</span>
            <span className="pill pill-blue">{Object.keys(props).length} properties</span>
          </div>
          <p style={{ color: "var(--muted)", fontSize: 12, marginBottom: 14 }}>{data.description}</p>
          <div style={{ background: "#0d1220", border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "180px 90px 1fr", gap: 10, padding: "8px 10px", borderBottom: "1px solid var(--border)", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--muted)" }}>
              <span>Property</span><span>Type</span><span>Description</span>
            </div>
            {Object.entries(props).map(([key, prop]) => (
              <div className="schema-prop" key={key}>
                <span className="schema-key">
                  {key}
                  {required.has(key) && <span className="schema-required">*</span>}
                </span>
                <span className="schema-type">
                  {Array.isArray(prop.type) ? prop.type.join("|") : (prop.type || (prop.enum ? "enum" : "object"))}
                </span>
                <span className="schema-desc">{prop.description || "—"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data && raw && (
        <div className="card">
          <div className="json-wrap" style={{ marginTop: 0 }}>
            <JsonBlock data={data} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── ROOT APP ─────────────────────────────────────────────────────────────────
const VIEWS = [
  { id: "health", icon: "♡", label: "System Health" },
  { id: "trace",  icon: "⌗", label: "Trace Viewer" },
  { id: "proof",  icon: "✓", label: "Proof Viewer" },
  { id: "schema", icon: "⊞", label: "Schema Viewer" },
];

export default function App() {
  const [view, setView] = useState("health");

  return (
    <>
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">N</div>
          <div className="sidebar-logo-text">
            <h2>NHID-Clinical</h2>
            <p>Viewer Layer</p>
          </div>
        </div>
        <div className="sidebar-badge">
          <span className="dot" /> Read-Only
        </div>
        <nav>
          {VIEWS.map((v) => (
            <div
              key={v.id}
              className={`nav-item ${view === v.id ? "active" : ""}`}
              onClick={() => setView(v.id)}
            >
              <span className="nav-icon">{v.icon}</span>
              <span>{v.label}</span>
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          Bridge on :8001<br />
          Core is source of truth
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <h1>{VIEWS.find((v) => v.id === view)?.label}</h1>
          <div className="topbar-right">
            <span className="read-only-badge">READ ONLY</span>
          </div>
        </div>
        <div className="content">
          {view === "health" && <HealthView />}
          {view === "trace"  && <TraceView />}
          {view === "proof"  && <ProofView />}
          {view === "schema" && <SchemaView />}
        </div>
      </div>
    </>
  );
}
