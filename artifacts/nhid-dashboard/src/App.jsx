import { useState } from "react";
import { signup, login, sendTrace, getProof } from "./api.js";
import "./styles.css";

function formatTime() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function JsonBlock({ data }) {
  const str = JSON.stringify(data, null, 2)
    .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+\.?\d*)/g,
      (match) => {
        if (/^"/.test(match)) {
          if (/:$/.test(match)) return `<span class="key">${match}</span>`;
          return `<span class="str">${match}</span>`;
        }
        if (/true|false/.test(match)) return `<span class="bool">${match}</span>`;
        if (/null/.test(match)) return `<span class="null">${match}</span>`;
        return `<span class="num">${match}</span>`;
      });
  return <pre className="json-out" dangerouslySetInnerHTML={{ __html: str }} />;
}

export default function App() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [org, setOrg] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(null);

  function addLog(label, tag, data) {
    setLogs((prev) => [{ id: Date.now(), label, tag, data, time: formatTime() }, ...prev]);
  }

  async function handleSignup() {
    if (!email || !password) return;
    setLoading("signup");
    try {
      const res = await signup({ email, password, orgName: org });
      setApiKey(res.api_key);
      addLog("Signup", "success", res);
    } catch (e) {
      addLog("Signup Error", "error", { error: e.message });
    } finally {
      setLoading(null);
    }
  }

  async function handleLogin() {
    if (!email || !password) return;
    setLoading("login");
    try {
      const res = await login({ email, password });
      setApiKey(res.api_key);
      addLog("Login", "success", res);
    } catch (e) {
      addLog("Login Error", "error", { error: e.message });
    } finally {
      setLoading(null);
    }
  }

  async function handleTrace(type) {
    if (!apiKey || !sessionId) return;
    setLoading(type);
    const event = { type, timestamp: new Date().toISOString() };
    try {
      const res = await sendTrace({ apiKey, sessionId, event });
      addLog(`Trace: ${type}`, "trace", { event, ...res });
    } catch (e) {
      addLog("Trace Error", "error", { error: e.message });
    } finally {
      setLoading(null);
    }
  }

  async function handleProof() {
    if (!apiKey || !sessionId) return;
    setLoading("proof");
    try {
      const res = await getProof({ apiKey, sessionId });
      addLog(`Proof: ${sessionId}`, "proof", res);
    } catch (e) {
      addLog("Proof Error", "error", { error: e.message });
    } finally {
      setLoading(null);
    }
  }

  const isReady = !!apiKey && !!sessionId;

  return (
    <>
      <div className="header">
        <div className="header-logo">N</div>
        <div>
          <h1>
            NHID Audit Core
            {apiKey && (
              <span className="status-pill active">
                <span className="dot" /> authenticated
              </span>
            )}
          </h1>
          <p>Tamper-evident audit logging for AI/agent healthcare workflows</p>
        </div>
      </div>

      {/* ── 1. Auth Section ── */}
      <div className="section">
        <div className="section-title">01 — Authentication</div>

        <div className="form-row">
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>

        <div className="form-row single">
          <div className="form-group">
            <label>Org Name (optional)</label>
            <input
              type="text"
              placeholder="Acme Health Systems"
              value={org}
              onChange={(e) => setOrg(e.target.value)}
            />
          </div>
        </div>

        <div className="btn-row">
          <button
            className="btn-success"
            onClick={handleSignup}
            disabled={!email || !password || loading === "signup"}
          >
            {loading === "signup" ? "Signing up…" : "Sign Up"}
          </button>
          <button
            className="btn-primary"
            onClick={handleLogin}
            disabled={!email || !password || loading === "login"}
          >
            {loading === "login" ? "Logging in…" : "Log In"}
          </button>
        </div>

        {apiKey && (
          <div className="api-key-box">
            <span className="api-key-label">API Key</span>
            <span className="api-key-value">{apiKey}</span>
          </div>
        )}
      </div>

      {/* ── 2. Session + Trace Section ── */}
      <div className="section">
        <div className="section-title">02 — Session & Trace Events</div>

        <div className="session-row">
          <div className="form-group">
            <label>Session ID</label>
            <input
              type="text"
              placeholder="session-001  (any string)"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
            />
          </div>
          <button
            className="btn-outline"
            style={{ flexShrink: 0, marginBottom: 0 }}
            onClick={() => setSessionId(`session-${Date.now()}`)}
          >
            Generate
          </button>
        </div>

        <div className="trace-btn-grid">
          <button
            className="btn-outline"
            onClick={() => handleTrace("agent_speaking")}
            disabled={!isReady || !!loading}
          >
            {loading === "agent_speaking" ? "…" : "agent_speaking"}
          </button>
          <button
            className="btn-outline"
            onClick={() => handleTrace("data_request")}
            disabled={!isReady || !!loading}
          >
            {loading === "data_request" ? "…" : "data_request"}
          </button>
          <button
            className="btn-outline"
            onClick={() => handleTrace("payer_response")}
            disabled={!isReady || !!loading}
          >
            {loading === "payer_response" ? "…" : "payer_response"}
          </button>
          <button
            className="btn-success"
            onClick={handleProof}
            disabled={!isReady || !!loading}
          >
            {loading === "proof" ? "…" : "Export Proof"}
          </button>
        </div>

        {!apiKey && (
          <p style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 14 }}>
            Sign up or log in to enable trace events.
          </p>
        )}
        {apiKey && !sessionId && (
          <p style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 14 }}>
            Enter or generate a Session ID to start logging.
          </p>
        )}
      </div>

      {/* ── 3. Output Section ── */}
      <div className="section">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 20,
          }}
        >
          <div className="section-title" style={{ marginBottom: 0 }}>
            03 — Response Output
          </div>
          {logs.length > 0 && (
            <button
              className="btn-outline"
              style={{ fontSize: 11, padding: "5px 12px" }}
              onClick={() => setLogs([])}
            >
              Clear
            </button>
          )}
        </div>

        <div className="log-list">
          {logs.length === 0 ? (
            <div className="empty-state">
              No responses yet — sign up, send events, or export a proof.
            </div>
          ) : (
            logs.map((entry) => (
              <div className="log-entry" key={entry.id}>
                <div className="log-entry-header">
                  <span className={`log-tag tag-${entry.tag}`}>{entry.tag}</span>
                  <span className="log-time">{entry.time}</span>
                  <span className="log-label">{entry.label}</span>
                </div>

                {entry.tag === "proof" && entry.data.valid_chain !== undefined && (
                  <div style={{ marginBottom: 8, fontSize: 13 }}>
                    Chain integrity:{" "}
                    <span className={entry.data.valid_chain ? "chain-valid" : "chain-invalid"}>
                      {entry.data.valid_chain ? "✓ VALID" : "✗ TAMPERED"}
                    </span>{" "}
                    · {entry.data.events?.length ?? 0} events
                  </div>
                )}

                <JsonBlock data={entry.data} />
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
