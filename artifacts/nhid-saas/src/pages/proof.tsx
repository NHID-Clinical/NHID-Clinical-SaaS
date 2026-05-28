import { useState } from "react";
import { Search, ShieldAlert, ShieldCheck, ChevronDown, ChevronRight, Hash } from "lucide-react";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { useProof } from "@/hooks/use-nhid";

const EVENT_TYPE_COLORS: Record<string, string> = {
  session_started: "#00c2a8",
  inference_requested: "#53d8fb",
  policy_evaluation: "#fbbd24",
  response_generated: "#a78bfa",
  session_ended: "#94a3b8",
};

function EventCard({ evt, idx }: { evt: any; idx: number }) {
  const [expanded, setExpanded] = useState(idx === 0);
  const color = EVENT_TYPE_COLORS[evt.event_type] ?? "var(--nhid-teal)";

  return (
    <div
      style={{
        background: "var(--nhid-surface)",
        border: `1px solid ${expanded ? `${color}30` : "var(--nhid-border)"}`,
        borderRadius: 12,
        transition: "border-color 0.2s",
        overflow: "hidden",
      }}
    >
      {/* Event header */}
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: "100%", padding: "12px 16px",
          display: "flex", alignItems: "center", gap: 10,
          background: "none", border: "none", cursor: "pointer",
          textAlign: "left",
        }}
      >
        {/* Colored dot */}
        <span
          style={{
            width: 8, height: 8, borderRadius: "50%",
            background: color, flexShrink: 0,
            boxShadow: `0 0 8px ${color}60`,
          }}
        />
        {/* Event type */}
        <span
          style={{
            fontSize: 12, fontWeight: 700, fontFamily: "monospace", color,
          }}
        >
          {evt.event_type}
        </span>
        {/* State transition badge */}
        {evt.state_before && evt.state_after && (
          <span
            style={{
              fontSize: 10, fontFamily: "monospace", color: "var(--nhid-muted)",
              background: "rgba(255,255,255,0.04)", borderRadius: 4, padding: "2px 7px",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            {evt.state_before} → {evt.state_after}
          </span>
        )}
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          {evt.timestamp && (
            <span style={{ fontSize: 10, color: "var(--nhid-muted)", fontFamily: "monospace" }}>
              {format(new Date(evt.timestamp), "HH:mm:ss.SSS")}
            </span>
          )}
          {expanded
            ? <ChevronDown size={13} style={{ color: "var(--nhid-muted)" }} />
            : <ChevronRight size={13} style={{ color: "var(--nhid-muted)" }} />
          }
        </span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div style={{ borderTop: "1px solid var(--nhid-border)", padding: "14px 16px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: evt.input_text || evt.response_text ? 12 : 0 }}>
            {evt.policy_action && (
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--nhid-muted)", marginBottom: 4 }}>
                  Policy Action
                </div>
                <span
                  style={{
                    display: "inline-block", fontSize: 11, fontWeight: 700,
                    padding: "3px 8px", borderRadius: 4,
                    background: evt.policy_action === "allow" ? "rgba(0,194,168,0.1)" : "rgba(239,68,68,0.1)",
                    color: evt.policy_action === "allow" ? "var(--nhid-teal)" : "#ef4444",
                    border: `1px solid ${evt.policy_action === "allow" ? "rgba(0,194,168,0.25)" : "rgba(239,68,68,0.25)"}`,
                    textTransform: "uppercase",
                  }}
                >
                  {evt.policy_action} {evt.reason_code ? `· ${evt.reason_code}` : ""}
                </span>
              </div>
            )}
            {evt.agent_id && (
              <div>
                <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--nhid-muted)", marginBottom: 4 }}>
                  Agent ID
                </div>
                <code style={{ fontSize: 11, color: "var(--nhid-cyan)", fontFamily: "monospace" }}>{evt.agent_id}</code>
              </div>
            )}
          </div>
          {evt.input_text && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--nhid-muted)", marginBottom: 6 }}>
                Input
              </div>
              <div
                style={{
                  background: "rgba(0,0,0,0.25)", border: "1px solid var(--nhid-border)",
                  borderRadius: 6, padding: "8px 12px",
                  fontSize: 12, color: "var(--nhid-text)", lineHeight: 1.6,
                }}
              >
                {evt.input_text}
              </div>
            </div>
          )}
          {evt.response_text && (
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--nhid-muted)", marginBottom: 6 }}>
                Response
              </div>
              <div
                style={{
                  background: "rgba(0,0,0,0.25)", border: "1px solid var(--nhid-border)",
                  borderRadius: 6, padding: "8px 12px",
                  fontSize: 12, color: "var(--nhid-text)", lineHeight: 1.6,
                }}
              >
                {evt.response_text}
              </div>
            </div>
          )}
          {evt.hash && (
            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6 }}>
              <Hash size={10} style={{ color: "var(--nhid-muted)", flexShrink: 0 }} />
              <code style={{ fontSize: 9, color: "var(--nhid-muted)", fontFamily: "monospace", wordBreak: "break-all" }}>
                {evt.hash}
              </code>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Proof() {
  const [searchInput, setSearchInput] = useState("");
  const [activeSession, setActiveSession] = useState("");

  const { data: proof, isLoading, isError, error } = useProof(activeSession);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchInput.trim()) setActiveSession(searchInput.trim());
  };

  const events: any[] = Array.isArray((proof?.trace as any)?.events)
    ? (proof?.trace as any).events
    : Array.isArray(proof?.trace)
      ? (proof?.trace as any)
      : [];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-400">
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--nhid-text)", letterSpacing: "-0.02em", marginBottom: 4 }}>
          Audit Trail Proof
        </h1>
        <p style={{ fontSize: 13, color: "var(--nhid-muted)" }}>
          Verify cryptographic integrity of session event chains.
        </p>
      </div>

      {/* Search card */}
      <div
        style={{
          background: "var(--nhid-surface)", border: "1px solid var(--nhid-border)",
          borderRadius: 14, padding: "20px",
        }}
      >
        <form onSubmit={handleSearch} style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1, position: "relative" }}>
            <Search
              size={14}
              style={{
                position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)",
                color: "var(--nhid-muted)", pointerEvents: "none",
              }}
            />
            <input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="Enter Session ID (e.g. sess_abc123)"
              style={{
                width: "100%", paddingLeft: 36, paddingRight: 14, paddingTop: 11, paddingBottom: 11,
                borderRadius: 9, background: "rgba(255,255,255,0.05)",
                border: "1px solid var(--nhid-border)", color: "var(--nhid-text)",
                fontSize: 13, fontFamily: "monospace", outline: "none",
                transition: "border-color 0.2s",
              }}
              onFocus={e => e.target.style.borderColor = "rgba(0,194,168,0.4)"}
              onBlur={e => e.target.style.borderColor = "var(--nhid-border)"}
            />
          </div>
          <button
            type="submit"
            disabled={!searchInput.trim()}
            style={{
              padding: "11px 20px", borderRadius: 9,
              background: searchInput.trim() ? "linear-gradient(135deg, #00c2a8, #53d8fb)" : "rgba(255,255,255,0.06)",
              border: "none", color: searchInput.trim() ? "#070c17" : "var(--nhid-muted)",
              fontSize: 13, fontWeight: 700, cursor: searchInput.trim() ? "pointer" : "not-allowed",
              fontFamily: "'Raleway', sans-serif",
              boxShadow: searchInput.trim() ? "0 0 20px rgba(0,194,168,0.25)" : "none",
              flexShrink: 0, transition: "all 0.2s",
              whiteSpace: "nowrap",
            }}
          >
            Verify Chain
          </button>
        </form>
      </div>

      {/* Results */}
      {activeSession && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {isLoading && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Skeleton style={{ height: 80, borderRadius: 14 }} />
              {[...Array(3)].map((_, i) => <Skeleton key={i} style={{ height: 56, borderRadius: 12 }} />)}
            </div>
          )}

          {isError && (
            <div
              style={{
                background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.25)",
                borderRadius: 14, padding: "20px 22px",
                display: "flex", alignItems: "center", gap: 12,
              }}
            >
              <div
                style={{
                  width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                  background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                <ShieldAlert size={16} style={{ color: "#ef4444" }} />
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#ef4444", marginBottom: 3 }}>
                  Verification Failed
                </div>
                <div style={{ fontSize: 12, color: "var(--nhid-muted)" }}>
                  {(error as any)?.message || "Session not found or chain integrity could not be verified."}
                </div>
              </div>
            </div>
          )}

          {proof && (
            <>
              {/* Chain status banner */}
              <div
                style={{
                  background: proof.valid_chain
                    ? "rgba(0,194,168,0.07)"
                    : "rgba(239,68,68,0.06)",
                  border: `1px solid ${proof.valid_chain ? "rgba(0,194,168,0.3)" : "rgba(239,68,68,0.25)"}`,
                  borderRadius: 14, padding: "18px 22px",
                  boxShadow: proof.valid_chain ? "0 0 40px rgba(0,194,168,0.08)" : "none",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div
                      style={{
                        width: 42, height: 42, borderRadius: 12, flexShrink: 0,
                        background: proof.valid_chain ? "rgba(0,194,168,0.12)" : "rgba(239,68,68,0.1)",
                        border: `1px solid ${proof.valid_chain ? "rgba(0,194,168,0.25)" : "rgba(239,68,68,0.2)"}`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}
                    >
                      {proof.valid_chain
                        ? <ShieldCheck size={18} style={{ color: "var(--nhid-teal)" }} />
                        : <ShieldAlert size={18} style={{ color: "#ef4444" }} />}
                    </div>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: proof.valid_chain ? "var(--nhid-teal)" : "#ef4444", marginBottom: 3 }}>
                        {proof.valid_chain ? "Chain Integrity Verified" : "Chain Integrity Broken"}
                      </div>
                      <code style={{ fontSize: 11, color: "var(--nhid-muted)", fontFamily: "monospace" }}>
                        {proof.session_id}
                      </code>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 22, fontWeight: 800, color: "var(--nhid-text)", letterSpacing: "-0.02em" }}>
                        {proof.event_count}
                      </div>
                      <div style={{ fontSize: 10, color: "var(--nhid-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                        Events
                      </div>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--nhid-text)", fontFamily: "monospace" }}>
                        {proof.org_id?.slice(0, 8)}…
                      </div>
                      <div style={{ fontSize: 10, color: "var(--nhid-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                        Org ID
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Timeline */}
              {events.length > 0 ? (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--nhid-muted)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>
                    Event Ledger — {events.length} records
                  </div>
                  <div style={{ position: "relative" }}>
                    {/* Connecting line */}
                    <div
                      style={{
                        position: "absolute", left: 6, top: 12, bottom: 12,
                        width: 1, background: "linear-gradient(to bottom, var(--nhid-teal), rgba(0,194,168,0.1))",
                        opacity: 0.35,
                      }}
                    />
                    <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingLeft: 24 }}>
                      {events.map((evt: any, i: number) => (
                        <EventCard key={i} evt={evt} idx={i} />
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  style={{
                    textAlign: "center", padding: "40px 20px",
                    border: "1px dashed var(--nhid-border)", borderRadius: 14,
                    color: "var(--nhid-muted)",
                  }}
                >
                  <div style={{ fontSize: 13 }}>No events found in this session.</div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
