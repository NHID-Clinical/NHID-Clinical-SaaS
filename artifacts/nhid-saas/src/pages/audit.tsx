import { useState } from "react";
import { Shield, CheckCircle, XCircle, AlertTriangle, ChevronDown, ChevronRight, Search, Lock } from "lucide-react";
import { useApiKey } from "@/hooks/use-nhid";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface AuditEvent {
  event_id: string;
  seq_num: number;
  session_id: string;
  event_type: string | null;
  state_before: string | null;
  state_after: string | null;
  policy_version: string | null;
  model_version: string | null;
  timestamp: string;
  event_hash: string;
  hmac_signature: string;
  hash_ok: boolean;
  hmac_ok: boolean;
}

interface VerifyResult {
  chain_valid: boolean;
  hmac_valid: boolean;
  event_count: number;
  breaks: Array<{ seq_num: number; event_id: string; reason: string }>;
  events: AuditEvent[];
}

function HashChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        padding: "2px 8px", borderRadius: 99,
        fontSize: 11, fontWeight: 600, letterSpacing: "0.03em",
        background: ok ? "rgba(0,194,168,0.15)" : "rgba(239,68,68,0.15)",
        color: ok ? "#00c2a8" : "#ef4444",
        border: `1px solid ${ok ? "rgba(0,194,168,0.3)" : "rgba(239,68,68,0.3)"}`,
      }}
    >
      {ok ? <CheckCircle size={10} /> : <XCircle size={10} />}
      {label}
    </span>
  );
}

function EventRow({ ev }: { ev: AuditEvent }) {
  const [open, setOpen] = useState(false);
  const bothOk = ev.hash_ok && ev.hmac_ok;
  return (
    <div
      style={{
        background: bothOk ? "rgba(255,255,255,0.03)" : "rgba(239,68,68,0.05)",
        border: `1px solid ${bothOk ? "rgba(255,255,255,0.07)" : "rgba(239,68,68,0.3)"}`,
        borderRadius: 8, marginBottom: 6, overflow: "hidden",
      }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 10,
          padding: "10px 14px", background: "none", border: "none",
          cursor: "pointer", textAlign: "left",
        }}
      >
        {open ? <ChevronDown size={14} color="#94a3b8" /> : <ChevronRight size={14} color="#94a3b8" />}
        <span style={{ fontFamily: "monospace", fontSize: 12, color: "#94a3b8", minWidth: 32 }}>
          #{ev.seq_num}
        </span>
        <span style={{ fontSize: 13, color: "#e2e8f0", flex: 1 }}>
          {ev.event_type || "event"}
        </span>
        <span style={{ fontSize: 11, color: "#64748b", marginRight: 10 }}>
          {new Date(ev.timestamp).toLocaleTimeString()}
        </span>
        <HashChip ok={ev.hash_ok} label="chain" />
        <span style={{ marginLeft: 4 }} />
        <HashChip ok={ev.hmac_ok} label="hmac" />
      </button>
      {open && (
        <div style={{ padding: "0 14px 12px", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
            {[
              ["Event ID", ev.event_id],
              ["Timestamp", ev.timestamp],
              ["State Before", ev.state_before],
              ["State After", ev.state_after],
              ["Policy Version", ev.policy_version],
              ["Model Version", ev.model_version],
            ].map(([label, val]) => val ? (
              <div key={label as string}>
                <div style={{ fontSize: 10, color: "#64748b", marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 12, color: "#cbd5e1", fontFamily: "monospace", wordBreak: "break-all" }}>
                  {val}
                </div>
              </div>
            ) : null)}
          </div>
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: 10, color: "#64748b" }}>Event Hash</div>
            <code style={{ fontSize: 11, color: "#53d8fb", wordBreak: "break-all" }}>{ev.event_hash}</code>
            <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>HMAC Signature</div>
            <code style={{ fontSize: 11, color: "#00c2a8", wordBreak: "break-all" }}>{ev.hmac_signature}</code>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AuditPage() {
  const { apiKey } = useApiKey();
  const [sessionId, setSessionId] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const verify = async () => {
    if (!sessionId.trim() || !apiKey) return;
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch(`${BASE}/saas-api/saas/audit/verify/${encodeURIComponent(sessionId.trim())}`, {
        headers: { "X-API-Key": apiKey },
      });
      if (res.status === 429) {
        setError("Rate limited — verify endpoint allows 10 calls/min. Wait a moment and retry.");
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.detail || `Error ${res.status}`);
        return;
      }
      const data = await res.json();
      setResult(data);
    } catch (e: any) {
      setError(e.message || "Network error");
    } finally {
      setLoading(false);
    }
  };

  const cardStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 12,
    padding: "20px 24px",
    marginBottom: 20,
  };

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "24px 0" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <div
          style={{
            width: 40, height: 40, borderRadius: 10,
            background: "linear-gradient(135deg, rgba(0,194,168,0.2), rgba(83,216,251,0.2))",
            border: "1px solid rgba(0,194,168,0.3)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          <Shield size={20} color="#00c2a8" />
        </div>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#f1f5f9", margin: 0 }}>
            Audit Verification
          </h1>
          <p style={{ fontSize: 13, color: "#64748b", margin: "2px 0 0" }}>
            Cryptographic chain + HMAC validation for any session
          </p>
        </div>
      </div>

      {/* Input */}
      <div style={cardStyle}>
        <label style={{ fontSize: 12, color: "#94a3b8", display: "block", marginBottom: 8 }}>
          SESSION ID
        </label>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && verify()}
            placeholder="e.g. session-abc123"
            style={{
              flex: 1, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 8, padding: "10px 14px", color: "#f1f5f9", fontSize: 14,
              outline: "none", fontFamily: "monospace",
            }}
          />
          <button
            onClick={verify}
            disabled={loading || !sessionId.trim() || !apiKey}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "10px 20px", borderRadius: 8, border: "none", cursor: "pointer",
              background: loading || !sessionId.trim() || !apiKey
                ? "rgba(255,255,255,0.06)"
                : "linear-gradient(135deg, #00c2a8, #53d8fb)",
              color: loading || !sessionId.trim() || !apiKey ? "#64748b" : "#070c17",
              fontWeight: 600, fontSize: 14, transition: "all 0.2s",
            }}
          >
            {loading ? (
              <div
                style={{
                  width: 14, height: 14, borderRadius: "50%",
                  border: "2px solid rgba(255,255,255,0.3)",
                  borderTopColor: "#fff",
                  animation: "spin 0.8s linear infinite",
                }}
              />
            ) : (
              <Search size={14} />
            )}
            {loading ? "Verifying…" : "Verify"}
          </button>
        </div>
        {!apiKey && (
          <p style={{ fontSize: 12, color: "#f59e0b", marginTop: 8, display: "flex", alignItems: "center", gap: 4 }}>
            <Lock size={11} /> No API key — go to Dashboard to set up your organisation first.
          </p>
        )}
      </div>

      {/* Error */}
      {error && (
        <div
          style={{
            ...cardStyle,
            background: "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.3)",
            display: "flex", gap: 10, alignItems: "flex-start",
          }}
        >
          <AlertTriangle size={16} color="#ef4444" style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 13, color: "#fca5a5" }}>{error}</span>
        </div>
      )}

      {/* Result */}
      {result && (
        <>
          {/* Summary banner */}
          <div
            style={{
              ...cardStyle,
              background: result.chain_valid && result.hmac_valid
                ? "rgba(0,194,168,0.08)"
                : "rgba(239,68,68,0.08)",
              borderColor: result.chain_valid && result.hmac_valid
                ? "rgba(0,194,168,0.3)"
                : "rgba(239,68,68,0.3)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {result.chain_valid && result.hmac_valid ? (
                <CheckCircle size={24} color="#00c2a8" />
              ) : (
                <XCircle size={24} color="#ef4444" />
              )}
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: result.chain_valid && result.hmac_valid ? "#00c2a8" : "#ef4444" }}>
                  {result.chain_valid && result.hmac_valid ? "Chain intact — no tampering detected" : "Integrity violation detected"}
                </div>
                <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 2 }}>
                  {result.event_count} event{result.event_count !== 1 ? "s" : ""} verified for session{" "}
                  <code style={{ color: "#53d8fb" }}>{sessionId}</code>
                </div>
              </div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                <HashChip ok={result.chain_valid} label="Hash chain" />
                <HashChip ok={result.hmac_valid} label="HMAC" />
              </div>
            </div>
          </div>

          {/* Breaks */}
          {result.breaks.length > 0 && (
            <div style={{ ...cardStyle, background: "rgba(239,68,68,0.06)", borderColor: "rgba(239,68,68,0.3)" }}>
              <h3 style={{ fontSize: 13, fontWeight: 600, color: "#ef4444", margin: "0 0 10px" }}>
                Integrity Breaks ({result.breaks.length})
              </h3>
              {result.breaks.map((b) => (
                <div
                  key={`${b.seq_num}-${b.event_id}`}
                  style={{
                    display: "flex", gap: 10, padding: "8px 0",
                    borderBottom: "1px solid rgba(239,68,68,0.15)", fontSize: 12,
                  }}
                >
                  <span style={{ color: "#64748b" }}>seq #{b.seq_num}</span>
                  <code style={{ color: "#fca5a5", flex: 1, wordBreak: "break-all" }}>{b.event_id}</code>
                  <span style={{ color: "#ef4444" }}>{b.reason}</span>
                </div>
              ))}
            </div>
          )}

          {/* Events */}
          {result.events.length > 0 && (
            <div>
              <h3 style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8", margin: "0 0 10px" }}>
                Events ({result.events.length})
              </h3>
              {result.events.map((ev) => (
                <EventRow key={ev.event_id} ev={ev} />
              ))}
            </div>
          )}

          {result.events.length === 0 && (
            <div
              style={{
                ...cardStyle, textAlign: "center", color: "#64748b", fontSize: 14, padding: "40px 24px",
              }}
            >
              No audit records found for this session ID.
            </div>
          )}
        </>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        input:focus { border-color: rgba(0,194,168,0.5) !important; box-shadow: 0 0 0 2px rgba(0,194,168,0.15); }
        input::placeholder { color: #475569; }
      `}</style>
    </div>
  );
}
