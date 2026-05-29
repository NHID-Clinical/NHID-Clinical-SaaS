import { useState, useMemo } from "react";
import {
  Shield, CheckCircle, XCircle, AlertTriangle, ChevronDown, ChevronRight,
  RefreshCw, Search, TerminalSquare, CheckCircle2, Copy, Check,
  Clock, Layers, ArrowRight,
} from "lucide-react";
import { useGetRecent, useAuditProof, useTrace, useApiKey } from "@/hooks/use-nhid";
import { api, AuditEvent, ActivityEntry, AuditVerifyResult, AuditBreak } from "@/lib/api";
import { Skeleton } from "@/components/ui/skeleton";
import { format, formatDistanceToNow } from "date-fns";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";

// ── Design tokens ──────────────────────────────────────────────────────────────

const EVENT_COLORS: Record<string, string> = {
  session_started: "#00c2a8",
  inference_requested: "#53d8fb",
  policy_evaluation: "#fbbd24",
  response_generated: "#a78bfa",
  session_ended: "#94a3b8",
};
const POLICY_COLORS: Record<string, { bg: string; fg: string }> = {
  allow:  { bg: "rgba(0,194,168,0.15)",  fg: "#00c2a8" },
  block:  { bg: "rgba(239,68,68,0.15)",  fg: "#ef4444" },
  review: { bg: "rgba(251,189,36,0.15)", fg: "#fbbd24" },
  flag:   { bg: "rgba(249,115,22,0.15)", fg: "#f97316" },
};

// ── Small shared atoms ─────────────────────────────────────────────────────────

function HashChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 3,
      padding: "2px 7px", borderRadius: 99, fontSize: 10, fontWeight: 700,
      letterSpacing: "0.04em", flexShrink: 0,
      background: ok ? "rgba(0,194,168,0.15)" : "rgba(239,68,68,0.15)",
      color: ok ? "#00c2a8" : "#ef4444",
      border: `1px solid ${ok ? "rgba(0,194,168,0.3)" : "rgba(239,68,68,0.3)"}`,
    }}>
      {ok ? <CheckCircle size={9} /> : <XCircle size={9} />}
      {label}
    </span>
  );
}

function EventTypeBadge({ type }: { type: string | null }) {
  const color = EVENT_COLORS[type ?? ""] ?? "#64748b";
  const short = (type ?? "event").replace(/_/g, " ");
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6,
      background: `${color}18`, color, border: `1px solid ${color}30`,
      whiteSpace: "nowrap", letterSpacing: "0.03em",
    }}>
      {short}
    </span>
  );
}

function PolicyChip({ action }: { action: string | null }) {
  if (!action) return <span style={{ color: "#475569", fontSize: 11 }}>—</span>;
  const c = POLICY_COLORS[action.toLowerCase()] ?? { bg: "rgba(148,163,184,0.12)", fg: "#94a3b8" };
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6,
      background: c.bg, color: c.fg, border: `1px solid ${c.fg}30`,
      letterSpacing: "0.03em",
    }}>
      {action}
    </span>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(value).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
      style={{ background: "none", border: "none", cursor: "pointer", color: "#475569", padding: "2px 4px", flexShrink: 0 }}
    >
      {copied ? <Check size={11} style={{ color: "#00c2a8" }} /> : <Copy size={11} />}
    </button>
  );
}

// ── Event row (table row + expandable detail) ──────────────────────────────────

function EventRow({ ev }: { ev: AuditEvent }) {
  const [open, setOpen] = useState(false);
  const intact = ev.hash_ok && ev.hmac_ok;
  const ts = new Date(ev.timestamp);

  const FIELD_ROWS = [
    ["Event ID", ev.event_id, true],
    ["Timestamp", ev.timestamp, false],
    ["Input Text", ev.input_text, false],
    ["Response Text", ev.response_text, false],
    ["Policy Version", ev.policy_version, false],
    ["Model Version", ev.model_version, false],
  ].filter(([, v]) => v) as [string, string, boolean][];

  return (
    <div style={{
      borderBottom: "1px solid rgba(255,255,255,0.04)",
      background: intact ? "transparent" : "rgba(239,68,68,0.03)",
    }}>
      {/* Summary row */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", display: "grid",
          gridTemplateColumns: "28px 90px 1fr 140px 100px 80px 80px",
          gap: 10, alignItems: "center",
          padding: "10px 16px", background: "none", border: "none",
          cursor: "pointer", textAlign: "left",
          transition: "background 0.1s",
        }}
        className="hover:bg-white/[0.02]"
      >
        <span style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          {open
            ? <ChevronDown size={13} color="#475569" />
            : <ChevronRight size={13} color="#475569" />
          }
        </span>
        <span style={{ fontFamily: "monospace", fontSize: 11, color: "#475569" }}>
          {format(ts, "HH:mm:ss")}
          <span style={{ display: "block", fontSize: 9, color: "#334155" }}>
            #{ev.seq_num}
          </span>
        </span>
        <EventTypeBadge type={ev.event_type} />
        <span style={{ fontSize: 11, color: "#94a3b8", display: "flex", alignItems: "center", gap: 4, fontFamily: "monospace", overflow: "hidden" }}>
          <span style={{ color: "#64748b", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {ev.state_before ?? "—"}
          </span>
          <ArrowRight size={10} style={{ flexShrink: 0, color: "#334155" }} />
          <span style={{ color: "#e2e8f0", flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {ev.state_after ?? "—"}
          </span>
        </span>
        <span style={{ fontSize: 11, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {ev.input_text ? `${ev.input_text.slice(0, 28)}${ev.input_text.length > 28 ? "…" : ""}` : "—"}
        </span>
        <PolicyChip action={ev.policy_action} />
        <span style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
          <HashChip ok={ev.hash_ok} label="chain" />
        </span>
      </button>

      {/* Expanded detail */}
      {open && (
        <div style={{
          padding: "14px 16px 16px 54px",
          borderTop: "1px solid rgba(255,255,255,0.04)",
          background: "rgba(0,0,0,0.15)",
        }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 24px", marginBottom: 14 }}>
            {FIELD_ROWS.map(([label, val, mono]) => (
              <div key={label}>
                <div style={{ fontSize: 9, color: "#475569", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 3 }}>
                  {label}
                </div>
                <div style={{ fontSize: mono ? 11 : 12, color: "#cbd5e1", fontFamily: mono ? "monospace" : "inherit", wordBreak: "break-all", lineHeight: 1.5 }}>
                  {val}
                </div>
              </div>
            ))}
            {ev.reason_code && (
              <div>
                <div style={{ fontSize: 9, color: "#475569", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 3 }}>
                  Reason Code
                </div>
                <code style={{ fontSize: 11, color: "#fbbd24", fontFamily: "monospace" }}>{ev.reason_code}</code>
              </div>
            )}
          </div>

          {/* Hashes */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { label: "Event Hash (SHA-256 chain)", value: ev.event_hash, color: "#53d8fb", ok: ev.hash_ok },
              { label: "HMAC Signature", value: ev.hmac_signature, color: "#00c2a8", ok: ev.hmac_ok },
            ].map(({ label, value, color, ok }) => (
              <div key={label}>
                <div style={{ fontSize: 9, color: "#475569", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
                  {label}
                  <HashChip ok={ok} label={ok ? "valid" : "TAMPERED"} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(0,0,0,0.3)", borderRadius: 6, padding: "7px 10px", border: "1px solid rgba(255,255,255,0.05)" }}>
                  <code style={{ flex: 1, fontSize: 10, color, fontFamily: "monospace", wordBreak: "break-all", lineHeight: 1.5 }}>
                    {value}
                  </code>
                  <CopyButton value={value} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sessions sidebar ───────────────────────────────────────────────────────────

function buildSessionList(activity: ActivityEntry[]): Array<{
  session_id: string;
  last_seen: string;
  call_count: number;
  last_endpoint: string;
}> {
  const map = new Map<string, { last_seen: string; call_count: number; last_endpoint: string }>();
  for (const e of activity) {
    if (!e.session_id) continue;
    const prev = map.get(e.session_id);
    if (!prev || e.timestamp > prev.last_seen) {
      map.set(e.session_id, {
        last_seen: e.timestamp,
        call_count: (prev?.call_count ?? 0) + 1,
        last_endpoint: e.endpoint,
      });
    } else {
      map.set(e.session_id, { ...prev, call_count: prev.call_count + 1 });
    }
  }
  return Array.from(map.entries())
    .map(([session_id, v]) => ({ session_id, ...v }))
    .sort((a, b) => b.last_seen.localeCompare(a.last_seen));
}

function SessionsPanel({
  selected,
  onSelect,
  manualId,
  onManualChange,
  onManualSubmit,
}: {
  selected: string | null;
  onSelect: (id: string) => void;
  manualId: string;
  onManualChange: (v: string) => void;
  onManualSubmit: () => void;
}) {
  const { data: recent, isLoading, refetch, isFetching } = useGetRecent(100);

  const sessions = useMemo(
    () => buildSessionList(recent?.activity ?? []),
    [recent],
  );

  const [search, setSearch] = useState("");
  const filtered = sessions.filter(s =>
    s.session_id.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{
      width: 260, flexShrink: 0,
      background: "rgba(255,255,255,0.015)",
      border: "1px solid var(--nhid-border)",
      borderRadius: 12,
      display: "flex", flexDirection: "column",
      overflow: "hidden",
      minHeight: 500,
    }}>
      {/* Panel header */}
      <div style={{ padding: "14px 14px 10px", borderBottom: "1px solid var(--nhid-border)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--nhid-text)" }}>Recent Sessions</div>
            <div style={{ fontSize: 10, color: "var(--nhid-muted)", marginTop: 1 }}>
              {sessions.length} session{sessions.length !== 1 ? "s" : ""} found
            </div>
          </div>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            title="Refresh"
            style={{
              background: "none", border: "1px solid var(--nhid-border)", borderRadius: 6,
              padding: "5px 6px", cursor: "pointer", color: "var(--nhid-muted)",
              display: "flex", alignItems: "center",
              opacity: isFetching ? 0.5 : 1,
            }}
          >
            <RefreshCw size={12} style={{ animation: isFetching ? "spin 1s linear infinite" : "none" }} />
          </button>
        </div>
        {/* Search */}
        <div style={{ position: "relative" }}>
          <Search size={11} style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", color: "#475569", pointerEvents: "none" }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter sessions…"
            style={{
              width: "100%", padding: "7px 8px 7px 26px", borderRadius: 7,
              background: "rgba(255,255,255,0.04)", border: "1px solid var(--nhid-border)",
              color: "var(--nhid-text)", fontSize: 11, outline: "none",
              fontFamily: "monospace", boxSizing: "border-box",
            }}
            onFocus={e => (e.target.style.borderColor = "rgba(0,194,168,0.4)")}
            onBlur={e => (e.target.style.borderColor = "var(--nhid-border)")}
          />
        </div>
      </div>

      {/* Manual session ID lookup */}
      <div style={{ padding: "8px 14px", borderBottom: "1px solid rgba(255,255,255,0.04)", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: 6 }}>
          <input
            value={manualId}
            onChange={e => onManualChange(e.target.value)}
            onKeyDown={e => e.key === "Enter" && onManualSubmit()}
            placeholder="Look up session ID…"
            style={{
              flex: 1, padding: "6px 8px", borderRadius: 6,
              background: "rgba(255,255,255,0.03)", border: "1px solid var(--nhid-border)",
              color: "var(--nhid-text)", fontSize: 10, outline: "none",
              fontFamily: "monospace",
            }}
            onFocus={e => (e.target.style.borderColor = "rgba(0,194,168,0.35)")}
            onBlur={e => (e.target.style.borderColor = "var(--nhid-border)")}
          />
          <button
            onClick={onManualSubmit}
            disabled={!manualId.trim()}
            style={{
              padding: "6px 10px", borderRadius: 6, fontSize: 10, fontWeight: 700,
              background: manualId.trim() ? "rgba(0,194,168,0.15)" : "rgba(255,255,255,0.03)",
              border: `1px solid ${manualId.trim() ? "rgba(0,194,168,0.3)" : "var(--nhid-border)"}`,
              color: manualId.trim() ? "var(--nhid-teal)" : "#475569",
              cursor: manualId.trim() ? "pointer" : "not-allowed",
              fontFamily: "'Raleway', sans-serif",
            }}
          >
            Load
          </button>
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {isLoading ? (
          <div style={{ padding: "14px" }}>
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 mb-2" style={{ borderRadius: 8 }} />)}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "32px 16px", textAlign: "center", color: "var(--nhid-muted)" }}>
            <Layers size={22} style={{ opacity: 0.25, margin: "0 auto 8px" }} />
            <div style={{ fontSize: 12 }}>
              {search ? "No sessions match" : "No sessions yet"}
            </div>
            <div style={{ fontSize: 10, opacity: 0.6, marginTop: 4, lineHeight: 1.5 }}>
              Submit a trace event to see sessions here.
            </div>
          </div>
        ) : (
          filtered.map((s) => {
            const active = selected === s.session_id;
            return (
              <button
                key={s.session_id}
                onClick={() => onSelect(s.session_id)}
                style={{
                  width: "100%", display: "flex", flexDirection: "column", gap: 4,
                  padding: "11px 14px", border: "none", borderBottom: "1px solid rgba(255,255,255,0.03)",
                  background: active ? "rgba(0,194,168,0.08)" : "transparent",
                  borderLeft: `2px solid ${active ? "#00c2a8" : "transparent"}`,
                  cursor: "pointer", textAlign: "left", transition: "all 0.12s",
                }}
                className={!active ? "hover:bg-white/[0.03]" : ""}
              >
                <span style={{ fontFamily: "monospace", fontSize: 11, color: active ? "#00c2a8" : "#e2e8f0", wordBreak: "break-all", lineHeight: 1.3 }}>
                  {s.session_id.length > 28 ? `${s.session_id.slice(0, 26)}…` : s.session_id}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Clock size={9} style={{ color: "#475569", flexShrink: 0 }} />
                  <span style={{ fontSize: 10, color: "#475569" }}>
                    {formatDistanceToNow(new Date(s.last_seen), { addSuffix: true })}
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 9, color: "#334155", fontFamily: "monospace" }}>
                    {s.call_count} call{s.call_count !== 1 ? "s" : ""}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// ── Verify banner ──────────────────────────────────────────────────────────────

function VerifyBanner({ result }: { result: AuditVerifyResult }) {
  const ok = result.chain_valid && result.hmac_valid;
  return (
    <div style={{
      borderRadius: 10, padding: "14px 18px",
      background: ok ? "rgba(0,194,168,0.07)" : "rgba(239,68,68,0.07)",
      border: `1px solid ${ok ? "rgba(0,194,168,0.28)" : "rgba(239,68,68,0.28)"}`,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {ok
          ? <CheckCircle size={20} color="#00c2a8" style={{ flexShrink: 0 }} />
          : <XCircle size={20} color="#ef4444" style={{ flexShrink: 0 }} />
        }
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: ok ? "#00c2a8" : "#ef4444", marginBottom: 2 }}>
            {ok ? "Chain intact — no tampering detected" : "Integrity violation detected"}
          </div>
          <div style={{ fontSize: 11, color: "var(--nhid-muted)" }}>
            {result.event_count} event{result.event_count !== 1 ? "s" : ""} verified
            {result.breaks.length > 0 && ` · ${result.breaks.length} break${result.breaks.length !== 1 ? "s" : ""} found`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <HashChip ok={result.chain_valid} label="Hash chain" />
          <HashChip ok={result.hmac_valid} label="HMAC" />
        </div>
      </div>

      {/* Breaks detail */}
      {result.breaks.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(239,68,68,0.2)" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#ef4444", marginBottom: 8 }}>
            Break Details
          </div>
          {result.breaks.map((b: AuditBreak) => (
            <div key={`${b.seq_num}-${b.event_id}`} style={{
              display: "flex", gap: 12, padding: "6px 0",
              borderBottom: "1px solid rgba(239,68,68,0.1)", fontSize: 11,
            }}>
              <span style={{ color: "#64748b", flexShrink: 0 }}>seq #{b.seq_num}</span>
              <code style={{ color: "#fca5a5", flex: 1, wordBreak: "break-all", fontFamily: "monospace" }}>{b.event_id}</code>
              <span style={{ color: "#ef4444", flexShrink: 0 }}>{b.reason}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Detail panel ───────────────────────────────────────────────────────────────

function DetailPanel({ sessionId }: { sessionId: string }) {
  const apiKey = useApiKey();
  const { data: proof, isLoading, isError, refetch, isFetching } = useAuditProof(sessionId);
  const [verifyResult, setVerifyResult] = useState<AuditVerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const verify = async () => {
    if (!apiKey) return;
    setVerifying(true);
    setVerifyResult(null);
    setVerifyError(null);
    try {
      const r = await api.auditVerify(apiKey, sessionId);
      setVerifyResult(r);
    } catch (e: any) {
      setVerifyError(e.message || "Verification failed");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      {/* Session header */}
      <div style={{
        background: "rgba(255,255,255,0.015)", border: "1px solid var(--nhid-border)",
        borderRadius: 10, padding: "14px 18px",
        display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "var(--nhid-muted)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>
            Selected Session
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <code style={{ fontSize: 13, color: "var(--nhid-teal)", fontFamily: "monospace", wordBreak: "break-all" }}>
              {sessionId}
            </code>
            <CopyButton value={sessionId} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "8px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600,
              background: "rgba(255,255,255,0.04)", border: "1px solid var(--nhid-border)",
              color: "var(--nhid-muted)", cursor: "pointer",
              fontFamily: "'Raleway', sans-serif",
              opacity: isFetching ? 0.5 : 1,
            }}
          >
            <RefreshCw size={12} style={{ animation: isFetching ? "spin 1s linear infinite" : "none" }} />
            Reload
          </button>
          <button
            onClick={verify}
            disabled={verifying}
            style={{
              display: "flex", alignItems: "center", gap: 7,
              padding: "8px 18px", borderRadius: 8, fontSize: 12, fontWeight: 700,
              background: verifying ? "rgba(0,194,168,0.3)" : "linear-gradient(135deg, #00c2a8, #53d8fb)",
              border: "none", color: "#070c17", cursor: verifying ? "not-allowed" : "pointer",
              fontFamily: "'Raleway', sans-serif",
              boxShadow: verifying ? "none" : "0 0 20px rgba(0,194,168,0.25)",
            }}
          >
            <Shield size={13} style={{ animation: verifying ? "spin 1s linear infinite" : "none" }} />
            {verifying ? "Verifying…" : "Verify Full Chain"}
          </button>
        </div>
      </div>

      {/* Verify result */}
      {verifyError && (
        <div style={{
          borderRadius: 10, padding: "12px 16px",
          background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.25)",
          display: "flex", gap: 10, alignItems: "flex-start",
        }}>
          <AlertTriangle size={14} color="#ef4444" style={{ flexShrink: 0, marginTop: 1 }} />
          <span style={{ fontSize: 12, color: "#fca5a5" }}>{verifyError}</span>
        </div>
      )}
      {verifyResult && <VerifyBanner result={verifyResult} />}

      {/* Events table */}
      <div style={{
        background: "rgba(255,255,255,0.015)", border: "1px solid var(--nhid-border)",
        borderRadius: 12, overflow: "hidden", flex: 1,
      }}>
        {/* Table header */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "28px 90px 1fr 140px 100px 80px 80px",
          gap: 10, padding: "10px 16px",
          borderBottom: "1px solid var(--nhid-border)",
          background: "rgba(0,0,0,0.15)",
        }}>
          {["", "Time / Seq", "Event Type", "State Transition", "Input Text", "Policy", "Integrity"].map((h) => (
            <span key={h} style={{
              fontSize: 9, fontWeight: 700, color: "var(--nhid-muted)",
              textTransform: "uppercase", letterSpacing: "0.1em",
            }}>
              {h}
            </span>
          ))}
        </div>

        {/* Table body */}
        {isLoading ? (
          <div style={{ padding: 16 }}>
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-11 mb-2" style={{ borderRadius: 6 }} />)}
          </div>
        ) : isError ? (
          <div style={{ padding: "32px 20px", textAlign: "center" }}>
            <AlertTriangle size={22} style={{ color: "#ef4444", opacity: 0.5, margin: "0 auto 10px" }} />
            <p style={{ fontSize: 13, color: "var(--nhid-muted)" }}>Could not load events for this session.</p>
            <p style={{ fontSize: 11, color: "#334155", marginTop: 4 }}>
              The session may not have any audit records yet, or the session ID may not exist in this org.
            </p>
          </div>
        ) : proof && proof.events.length > 0 ? (
          <div>
            {proof.events.map(ev => <EventRow key={ev.event_id} ev={ev} />)}
          </div>
        ) : (
          <div style={{ padding: "40px 20px", textAlign: "center" }}>
            <Shield size={26} style={{ color: "var(--nhid-muted)", opacity: 0.2, margin: "0 auto 10px" }} />
            <p style={{ fontSize: 13, color: "var(--nhid-muted)" }}>No audit events found for this session.</p>
          </div>
        )}

        {/* Footer: chain summary */}
        {proof && proof.events.length > 0 && (
          <div style={{
            padding: "10px 16px", borderTop: "1px solid var(--nhid-border)",
            background: "rgba(0,0,0,0.1)",
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <span style={{ fontSize: 11, color: "var(--nhid-muted)" }}>
              {proof.event_count} event{proof.event_count !== 1 ? "s" : ""} in this session
            </span>
            <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              <HashChip ok={proof.chain_valid} label={proof.chain_valid ? "Chain OK" : "Chain broken"} />
              <HashChip ok={proof.hmac_valid} label={proof.hmac_valid ? "HMAC OK" : "HMAC invalid"} />
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Collapsed trace form ───────────────────────────────────────────────────────

const traceSchema = z.object({
  session_id: z.string().min(1),
  event_type: z.string().min(1),
  state_before: z.string().min(1),
  state_after: z.string().min(1),
  input_text: z.string().optional(),
  policy_action: z.string().optional(),
  reason_code: z.string().optional(),
  response_text: z.string().optional(),
});
type TraceFormValues = z.infer<typeof traceSchema>;

const TRACE_EVENT_TYPES = [
  { value: "session_started", label: "Session Start", color: "#00c2a8" },
  { value: "inference_requested", label: "Inference", color: "#53d8fb" },
  { value: "policy_evaluation", label: "Policy Eval", color: "#fbbd24" },
  { value: "response_generated", label: "Response", color: "#a78bfa" },
  { value: "session_ended", label: "Session End", color: "#94a3b8" },
];

function StyledInput({ value, onChange, placeholder = "", style = {} as React.CSSProperties }: {
  value: string; onChange: (v: string) => void; placeholder?: string; style?: React.CSSProperties;
}) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: "100%", padding: "9px 12px", borderRadius: 7,
        background: "rgba(255,255,255,0.04)", border: "1px solid var(--nhid-border)",
        color: "var(--nhid-text)", fontSize: 12, outline: "none",
        fontFamily: "'Raleway', sans-serif", boxSizing: "border-box",
        transition: "border-color 0.15s", ...style,
      }}
      onFocus={e => (e.target.style.borderColor = "rgba(0,194,168,0.4)")}
      onBlur={e => (e.target.style.borderColor = "var(--nhid-border)")}
    />
  );
}

function TraceFormSection({ onIngested }: { onIngested: (sessionId: string) => void }) {
  const [open, setOpen] = useState(false);
  const trace = useTrace();
  const { toast } = useToast();

  const form = useForm<TraceFormValues>({
    resolver: zodResolver(traceSchema),
    defaultValues: {
      session_id: `sess_${Math.random().toString(36).substring(2, 9)}`,
      event_type: "inference_requested",
      state_before: "idle",
      state_after: "processing",
      input_text: "",
      policy_action: "",
      reason_code: "",
      response_text: "",
    },
  });

  const watchEventType = form.watch("event_type");

  const applyPreset = (preset: "inference" | "policy") => {
    const sess = form.getValues("session_id");
    if (preset === "inference") {
      form.reset({ session_id: sess, event_type: "inference_requested", state_before: "idle", state_after: "processing", input_text: "What is the recommended dosage for Aspirin?", policy_action: "", reason_code: "", response_text: "" });
    } else {
      form.reset({ session_id: sess, event_type: "policy_evaluation", state_before: "processing", state_after: "blocked", input_text: "What is the recommended dosage for Aspirin?", policy_action: "block", reason_code: "P01_MEDICAL_ADVICE", response_text: "I cannot provide medical advice." });
    }
  };

  const onSubmit = (data: TraceFormValues) => {
    trace.mutate(data, {
      onSuccess: (res) => {
        toast({ title: "Event ingested", description: `Session: ${res.session_id}` });
        onIngested(res.session_id);
      },
      onError: (err: any) => {
        toast({ title: "Ingest failed", description: err.message || "Unknown error", variant: "destructive" });
      },
    });
  };

  const activeColor = TRACE_EVENT_TYPES.find(e => e.value === watchEventType)?.color ?? "#00c2a8";

  return (
    <div style={{ border: "1px solid var(--nhid-border)", borderRadius: 12, overflow: "hidden" }}>
      {/* Collapse toggle */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 10,
          padding: "14px 18px", background: "rgba(255,255,255,0.015)",
          border: "none", cursor: "pointer", textAlign: "left",
          transition: "background 0.1s",
        }}
        className="hover:bg-white/[0.025]"
      >
        <TerminalSquare size={14} style={{ color: activeColor, flexShrink: 0 }} />
        <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "var(--nhid-text)" }}>
          Test: Ingest New Event
        </span>
        <span style={{ fontSize: 11, color: "var(--nhid-muted)", marginRight: 8 }}>
          Submit a test event to the audit chain
        </span>
        {open ? <ChevronDown size={14} color="#475569" /> : <ChevronRight size={14} color="#475569" />}
      </button>

      {open && (
        <div style={{ padding: "18px 18px 20px", borderTop: "1px solid var(--nhid-border)" }}>
          {/* Presets + event type pills */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
            <span style={{ fontSize: 10, color: "var(--nhid-muted)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em" }}>Presets:</span>
            {[
              { label: "Inference", preset: "inference" as const, color: "#53d8fb" },
              { label: "Policy Block", preset: "policy" as const, color: "#fbbd24" },
            ].map(({ label, preset, color }) => (
              <button key={preset} onClick={() => applyPreset(preset)} style={{
                padding: "5px 12px", borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: "pointer",
                background: `${color}10`, border: `1px solid ${color}25`, color,
                fontFamily: "'Raleway', sans-serif",
              }}>
                {label}
              </button>
            ))}
            <div style={{ display: "flex", gap: 5, marginLeft: 8, flexWrap: "wrap" }}>
              {TRACE_EVENT_TYPES.map(et => {
                const active = watchEventType === et.value;
                return (
                  <button key={et.value} type="button" onClick={() => form.setValue("event_type", et.value)} style={{
                    padding: "4px 10px", borderRadius: 20, fontSize: 10, fontWeight: 700,
                    cursor: "pointer", fontFamily: "'Raleway', sans-serif",
                    background: active ? `${et.color}18` : "rgba(255,255,255,0.03)",
                    border: `1px solid ${active ? et.color + "45" : "var(--nhid-border)"}`,
                    color: active ? et.color : "var(--nhid-muted)",
                  }}>
                    {et.label}
                  </button>
                );
              })}
            </div>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <FormField control={form.control} name="session_id" render={({ field }) => (
                  <FormItem>
                    <FormLabel style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--nhid-muted)" }}>Session ID</FormLabel>
                    <FormControl><StyledInput value={field.value} onChange={field.onChange} style={{ fontFamily: "monospace", fontSize: 11 }} /></FormControl>
                    <FormMessage style={{ fontSize: 10, color: "#ef4444" }} />
                  </FormItem>
                )} />
                <FormField control={form.control} name="event_type" render={({ field }) => (
                  <FormItem>
                    <FormLabel style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--nhid-muted)" }}>Event Type</FormLabel>
                    <FormControl>
                      <select value={field.value} onChange={e => field.onChange(e.target.value)} style={{
                        width: "100%", padding: "9px 12px", borderRadius: 7,
                        background: "rgba(255,255,255,0.04)", border: "1px solid var(--nhid-border)",
                        color: "var(--nhid-text)", fontSize: 12, outline: "none",
                        fontFamily: "'Raleway', sans-serif", cursor: "pointer",
                      }}>
                        {TRACE_EVENT_TYPES.map(et => (
                          <option key={et.value} value={et.value} style={{ background: "#0d1520" }}>{et.value}</option>
                        ))}
                      </select>
                    </FormControl>
                  </FormItem>
                )} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                <FormField control={form.control} name="state_before" render={({ field }) => (
                  <FormItem>
                    <FormLabel style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--nhid-muted)" }}>State Before</FormLabel>
                    <FormControl><StyledInput value={field.value} onChange={field.onChange} style={{ fontFamily: "monospace" }} /></FormControl>
                    <FormMessage style={{ fontSize: 10, color: "#ef4444" }} />
                  </FormItem>
                )} />
                <FormField control={form.control} name="state_after" render={({ field }) => (
                  <FormItem>
                    <FormLabel style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--nhid-muted)" }}>State After</FormLabel>
                    <FormControl><StyledInput value={field.value} onChange={field.onChange} style={{ fontFamily: "monospace" }} /></FormControl>
                    <FormMessage style={{ fontSize: 10, color: "#ef4444" }} />
                  </FormItem>
                )} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <FormField control={form.control} name="input_text" render={({ field }) => (
                  <FormItem>
                    <FormLabel style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--nhid-muted)" }}>Input Text</FormLabel>
                    <FormControl><StyledInput value={field.value ?? ""} onChange={field.onChange} placeholder="Optional" /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="policy_action" render={({ field }) => (
                  <FormItem>
                    <FormLabel style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--nhid-muted)" }}>Policy Action</FormLabel>
                    <FormControl><StyledInput value={field.value ?? ""} onChange={field.onChange} placeholder="allow, block, review" /></FormControl>
                  </FormItem>
                )} />
              </div>
              <button
                type="submit"
                disabled={trace.isPending}
                style={{
                  width: "100%", padding: "11px", borderRadius: 9,
                  background: trace.isPending ? "rgba(0,194,168,0.3)" : "linear-gradient(135deg, #00c2a8, #53d8fb)",
                  border: "none", color: "#070c17", fontSize: 13, fontWeight: 800,
                  cursor: trace.isPending ? "not-allowed" : "pointer",
                  fontFamily: "'Raleway', sans-serif",
                  boxShadow: trace.isPending ? "none" : "0 0 20px rgba(0,194,168,0.25)",
                }}
              >
                {trace.isPending ? "Submitting…" : "Submit Audit Event →"}
              </button>
            </form>
          </Form>
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function AuditPage() {
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [manualId, setManualId] = useState("");

  const handleSelectSession = (id: string) => {
    setSelectedSession(id);
    setManualId("");
  };

  const handleManualSubmit = () => {
    const id = manualId.trim();
    if (id) { setSelectedSession(id); setManualId(""); }
  };

  const handleIngested = (sessionId: string) => {
    setSelectedSession(sessionId);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-400">
      {/* Page header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12, flexShrink: 0,
          background: "linear-gradient(135deg, rgba(0,194,168,0.18), rgba(83,216,251,0.12))",
          border: "1px solid rgba(0,194,168,0.3)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Shield size={21} color="#00c2a8" />
        </div>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: "var(--nhid-text)", letterSpacing: "-0.02em", marginBottom: 4 }}>
            Audit Trail Explorer
          </h1>
          <p style={{ fontSize: 13, color: "var(--nhid-muted)", lineHeight: 1.5 }}>
            Tamper-evident, cryptographically verified logs · Select a session to inspect its event chain
          </p>
        </div>
      </div>

      {/* Two-panel explorer */}
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <SessionsPanel
          selected={selectedSession}
          onSelect={handleSelectSession}
          manualId={manualId}
          onManualChange={setManualId}
          onManualSubmit={handleManualSubmit}
        />

        {selectedSession ? (
          <DetailPanel key={selectedSession} sessionId={selectedSession} />
        ) : (
          <div style={{
            flex: 1, minHeight: 500,
            border: "1px dashed var(--nhid-border)", borderRadius: 12,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            gap: 10, padding: 40,
          }}>
            <div style={{
              width: 52, height: 52, borderRadius: 14,
              background: "rgba(0,194,168,0.06)", border: "1px solid rgba(0,194,168,0.15)",
              display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 4,
            }}>
              <Shield size={24} style={{ color: "var(--nhid-muted)", opacity: 0.4 }} />
            </div>
            <p style={{ fontSize: 14, fontWeight: 600, color: "var(--nhid-muted)" }}>
              Select a session to explore
            </p>
            <p style={{ fontSize: 12, color: "var(--nhid-muted)", opacity: 0.6, textAlign: "center", maxWidth: 280, lineHeight: 1.6 }}>
              Choose a session from the sidebar, or enter a session ID directly to load its audit trail and run chain verification.
            </p>
          </div>
        )}
      </div>

      {/* Collapsible trace form */}
      <TraceFormSection onIngested={handleIngested} />

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        input::placeholder, textarea::placeholder { color: #334155; }
      `}</style>
    </div>
  );
}
