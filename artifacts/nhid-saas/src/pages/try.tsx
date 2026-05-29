import { useState, useCallback, useEffect, useRef } from "react";
import { Link } from "wouter";
import {
  Shield, CheckCircle, XCircle, Copy, Check, ArrowRight,
  Zap, RefreshCw, ChevronDown, ChevronRight, ExternalLink,
  AlertTriangle, Layers, Lock, Phone, User, Bot, Link2, Globe,
} from "lucide-react";

const SAAS = "/saas-api/saas";

// ── Types ──────────────────────────────────────────────────────────────────────

interface DemoOrg {
  org_id: string;
  org_name: string;
  api_key: string;
  plan: string;
}

interface SentEvent {
  preset_id: string;
  preset_label: string;
  color: string;
  request_id: string;
  session_id: string;
  timestamp: string;
}

interface AuditEvent {
  event_id: string;
  seq_num: number;
  event_type: string | null;
  state_before: string | null;
  state_after: string | null;
  input_text: string | null;
  policy_action: string | null;
  reason_code: string | null;
  event_hash: string;
  hmac_signature: string;
  hash_ok: boolean;
  hmac_ok: boolean;
  timestamp: string;
}

interface ProofData {
  chain_valid: boolean;
  hmac_valid: boolean;
  event_count: number;
  breaks: Array<{ seq_num: number; event_id: string; reason: string }>;
  events: AuditEvent[];
}

// ── Demo event presets ─────────────────────────────────────────────────────────

const PRESETS = [
  {
    id: "session_start",
    label: "Session Start",
    color: "#00c2a8",
    desc: "A new clinical AI session is opened",
    badge: "lifecycle",
    payload: {
      event_type: "session_started",
      state_before: "inactive",
      state_after: "active",
      input_text: null,
      policy_action: "allow",
      reason_code: null,
      response_text: null,
    },
  },
  {
    id: "inference",
    label: "Inference Request",
    color: "#53d8fb",
    desc: "User query sent to the AI model",
    badge: "ai",
    payload: {
      event_type: "inference_requested",
      state_before: "idle",
      state_after: "processing",
      input_text: "What medications interact with warfarin?",
      policy_action: null,
      reason_code: null,
      response_text: null,
    },
  },
  {
    id: "policy_block",
    label: "Policy Block",
    color: "#ef4444",
    desc: "Governance layer blocks a medical advice request",
    badge: "governance",
    payload: {
      event_type: "policy_evaluation",
      state_before: "processing",
      state_after: "blocked",
      input_text: "Recommend a dosage adjustment for my patient.",
      policy_action: "block",
      reason_code: "P01_MEDICAL_ADVICE",
      response_text: "I cannot provide dosage recommendations.",
    },
  },
  {
    id: "response",
    label: "Response Generated",
    color: "#a78bfa",
    desc: "AI generates an approved, logged response",
    badge: "ai",
    payload: {
      event_type: "response_generated",
      state_before: "processing",
      state_after: "delivered",
      input_text: "What are common warfarin drug interactions?",
      policy_action: "allow",
      reason_code: null,
      response_text: "Common warfarin interactions include NSAIDs, antibiotics, and vitamin K supplements.",
    },
  },
  {
    id: "session_end",
    label: "Session End",
    color: "#94a3b8",
    desc: "Session is closed and the chain is sealed",
    badge: "lifecycle",
    payload: {
      event_type: "session_ended",
      state_before: "active",
      state_after: "closed",
      input_text: null,
      policy_action: "allow",
      reason_code: null,
      response_text: null,
    },
  },
] as const;

type PresetId = typeof PRESETS[number]["id"];

// ── Scripted call turns ────────────────────────────────────────────────────────

const VOICE_TURNS = [
  { text: "Hello, I need help understanding my discharge instructions.", label: "Opening" },
  { text: "Can you explain what medications I should take?", label: "Inquiry" },
  { text: "What are the side effects of the prescribed medication?", label: "Follow-up" },
  { text: "I want to speak to a real person about this.", label: "Escalation trigger" },
  { text: "Thank you for your help today.", label: "Closing" },
] as const;

type VoiceTurnResult = {
  text: string;
  label: string;
  action: "allow" | "disclose" | "escalate" | "block";
  reason_code: string | null;
  event_hash: string;
};

type WebhookProvider = "retell" | "vapi" | "twilio" | "generic";

type WebhookTurnResult = {
  text: string;
  label: string;
  action: string;
  reason_code: string | null;
  event_hash: string;
};

type WebhookIncomingResult = {
  session_id: string;
  provider: string;
  provider_call_id: string | null;
  action: string;
  disclosure_text: string;
};

// ── Webhook payload factories ──────────────────────────────────────────────────
// Produce the exact JSON body each provider posts to your webhook URL.

function makeIncomingPayload(provider: WebhookProvider, callId: string): object {
  switch (provider) {
    case "retell":
      return { call_id: callId, event: "call_started", agent_id: "agent_nhid_demo", from_number: "+12025551234", to_number: "+18005550100", call_type: "phone_call" };
    case "vapi":
      return { message: { type: "call-start", call: { id: callId, assistantId: "asst_nhid_demo", customer: { number: "+12025551234" }, type: "inboundPhoneCall", phoneNumberId: "pn_demo_001" } } };
    case "twilio":
      return { CallSid: callId, CallStatus: "initiated", From: "+12025551234", To: "+18005550100", Direction: "inbound", ApiVersion: "2010-04-01" };
    default:
      return { caller_id: "+12025551234", metadata: { source: "generic", demo: true } };
  }
}

function makeTranscriptPayload(provider: WebhookProvider, callId: string, text: string, turn: number, sessionId: string): object {
  switch (provider) {
    case "retell":
      return { call_id: callId, event: "transcript", turn_number: turn, transcript: [{ role: "user", content: text }] };
    case "vapi":
      return { message: { type: "transcript", transcript: text, sequenceId: turn, call: { id: callId } } };
    case "twilio":
      return { CallSid: callId, SpeechResult: text, SequenceNumber: String(turn), Confidence: "0.95" };
    default:
      return { session_id: sessionId, transcript_text: text, turn_number: turn };
  }
}

// ── Small components ───────────────────────────────────────────────────────────

function CopyBtn({ value, size = 12 }: { value: string; size?: number }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(value).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      }}
      title="Copy"
      style={{
        background: "none", border: "none", cursor: "pointer",
        color: copied ? "#00c2a8" : "#475569", padding: "2px 4px", flexShrink: 0,
      }}
    >
      {copied ? <Check size={size} /> : <Copy size={size} />}
    </button>
  );
}

function HashChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 3,
      padding: "2px 7px", borderRadius: 99, fontSize: 10, fontWeight: 700,
      letterSpacing: "0.04em",
      background: ok ? "rgba(0,194,168,0.15)" : "rgba(239,68,68,0.15)",
      color: ok ? "#00c2a8" : "#ef4444",
      border: `1px solid ${ok ? "rgba(0,194,168,0.3)" : "rgba(239,68,68,0.3)"}`,
    }}>
      {ok ? <CheckCircle size={9} /> : <XCircle size={9} />}
      {label}
    </span>
  );
}

function SectionCard({ children, style = {} as React.CSSProperties }: {
  children: React.ReactNode; style?: React.CSSProperties;
}) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: 16, ...style,
    }}>
      {children}
    </div>
  );
}

function StepBadge({ n, done }: { n: number; done: boolean }) {
  return (
    <div style={{
      width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
      background: done ? "rgba(0,194,168,0.2)" : "rgba(255,255,255,0.07)",
      border: `1px solid ${done ? "rgba(0,194,168,0.4)" : "rgba(255,255,255,0.12)"}`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 12, fontWeight: 800,
      color: done ? "#00c2a8" : "#64748b",
    }}>
      {done ? <CheckCircle size={14} /> : n}
    </div>
  );
}

// ── Proof viewer (inline) ──────────────────────────────────────────────────────

function ProofViewer({ proof }: { proof: ProofData }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const ok = proof.chain_valid && proof.hmac_valid;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Chain summary */}
      <div style={{
        borderRadius: 10, padding: "12px 16px",
        background: ok ? "rgba(0,194,168,0.07)" : "rgba(239,68,68,0.07)",
        border: `1px solid ${ok ? "rgba(0,194,168,0.25)" : "rgba(239,68,68,0.25)"}`,
        display: "flex", alignItems: "center", gap: 12,
      }}>
        {ok ? <CheckCircle size={18} color="#00c2a8" /> : <XCircle size={18} color="#ef4444" />}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: ok ? "#00c2a8" : "#ef4444" }}>
            {ok ? "Chain intact — no tampering detected" : "Integrity violation detected"}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
            {proof.event_count} event{proof.event_count !== 1 ? "s" : ""} cryptographically verified
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <HashChip ok={proof.chain_valid} label="Hash chain" />
          <HashChip ok={proof.hmac_valid} label="HMAC" />
        </div>
      </div>

      {/* Event list */}
      {proof.events.map((ev) => (
        <div key={ev.event_id} style={{
          border: "1px solid rgba(255,255,255,0.06)",
          borderRadius: 10, overflow: "hidden",
          background: ev.hash_ok && ev.hmac_ok ? "rgba(255,255,255,0.02)" : "rgba(239,68,68,0.04)",
        }}>
          <button
            onClick={() => setExpanded(x => x === ev.event_id ? null : ev.event_id)}
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 10,
              padding: "10px 14px", background: "none", border: "none",
              cursor: "pointer", textAlign: "left",
            }}
          >
            {expanded === ev.event_id
              ? <ChevronDown size={13} color="#475569" />
              : <ChevronRight size={13} color="#475569" />
            }
            <span style={{
              fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 5,
              background: "rgba(255,255,255,0.06)", color: "#94a3b8",
            }}>
              #{ev.seq_num}
            </span>
            <span style={{
              fontSize: 11, fontWeight: 600, color: "#e2e8f0", flex: 1,
            }}>
              {ev.event_type?.replace(/_/g, " ") ?? "event"}
            </span>
            <span style={{ fontSize: 10, color: "#475569", fontFamily: "monospace" }}>
              {ev.state_before} → {ev.state_after}
            </span>
            <div style={{ display: "flex", gap: 5, marginLeft: 8 }}>
              <HashChip ok={ev.hash_ok} label="chain" />
              <HashChip ok={ev.hmac_ok} label="hmac" />
            </div>
          </button>
          {expanded === ev.event_id && (
            <div style={{ padding: "10px 14px 14px", borderTop: "1px solid rgba(255,255,255,0.05)", background: "rgba(0,0,0,0.2)" }}>
              {ev.input_text && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 9, color: "#475569", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>Input Text</div>
                  <div style={{ fontSize: 12, color: "#cbd5e1", fontStyle: "italic" }}>"{ev.input_text}"</div>
                </div>
              )}
              {[
                { label: "Event Hash (SHA-256)", value: ev.event_hash, color: "#53d8fb" },
                { label: "HMAC Signature", value: ev.hmac_signature, color: "#00c2a8" },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 9, color: "#475569", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>{label}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(0,0,0,0.3)", borderRadius: 6, padding: "6px 10px", border: "1px solid rgba(255,255,255,0.05)" }}>
                    <code style={{ flex: 1, fontSize: 9, color, fontFamily: "monospace", wordBreak: "break-all", lineHeight: 1.5 }}>{value}</code>
                    <CopyBtn value={value} size={10} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Main TryPage ───────────────────────────────────────────────────────────────

function genSessionId() {
  return `demo_sess_${Math.random().toString(36).substring(2, 10)}`;
}
function genOrgName() {
  return `Demo-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
}

export default function TryPage() {
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);

  // ── State
  const [orgNameInput, setOrgNameInput] = useState(genOrgName);
  const [org, setOrg] = useState<DemoOrg | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [sessionId, setSessionId] = useState(genSessionId);
  const [selectedPresetId, setSelectedPresetId] = useState<PresetId>("policy_block");
  const [sentEvents, setSentEvents] = useState<SentEvent[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const [proof, setProof] = useState<ProofData | null>(null);
  const [loadingProof, setLoadingProof] = useState(false);
  const [proofError, setProofError] = useState<string | null>(null);
  const [proofOpen, setProofOpen] = useState(false);

  const [verifyResult, setVerifyResult] = useState<{ chain_valid: boolean; hmac_valid: boolean; event_count: number; breaks: any[] } | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const selectedPreset = PRESETS.find(p => p.id === selectedPresetId)!;

  // ── Create demo org
  const createOrg = useCallback(async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch(`${SAAS}/orgs/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ org_name: orgNameInput.trim() || genOrgName() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Error ${res.status}`);
      }
      const data: DemoOrg = await res.json();
      setOrg(data);
      // Store in localStorage so the full app works immediately
      localStorage.setItem("nhid_api_key", data.api_key);
      localStorage.setItem("nhid_org", JSON.stringify({ org_id: data.org_id, org_name: data.org_name }));
      window.dispatchEvent(new Event("storage"));
    } catch (e: any) {
      setCreateError(e.message || "Failed to create demo workspace");
    } finally {
      setCreating(false);
    }
  }, [orgNameInput]);

  // ── Send test event
  const sendEvent = useCallback(async () => {
    if (!org) return;
    setSending(true);
    setSendError(null);
    // Reset proof/verify when sending new events
    setProof(null);
    setProofOpen(false);
    setVerifyResult(null);
    try {
      const res = await fetch(`${SAAS}/trace`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": org.api_key },
        body: JSON.stringify({ session_id: sessionId, ...selectedPreset.payload }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Error ${res.status}`);
      }
      const data = await res.json();
      setSentEvents(prev => [...prev, {
        preset_id: selectedPreset.id,
        preset_label: selectedPreset.label,
        color: selectedPreset.color,
        request_id: data.request_id,
        session_id: data.session_id,
        timestamp: new Date().toISOString(),
      }]);
    } catch (e: any) {
      setSendError(e.message || "Failed to send event");
    } finally {
      setSending(false);
    }
  }, [org, sessionId, selectedPreset]);

  // ── View proof
  const loadProof = useCallback(async () => {
    if (!org) return;
    setLoadingProof(true);
    setProofError(null);
    setVerifyResult(null);
    try {
      const res = await fetch(`${SAAS}/audit/proof/${encodeURIComponent(sessionId)}`, {
        headers: { "X-API-Key": org.api_key },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Error ${res.status}`);
      }
      const data: ProofData = await res.json();
      setProof(data);
      setProofOpen(true);
    } catch (e: any) {
      setProofError(e.message || "Failed to load proof");
    } finally {
      setLoadingProof(false);
    }
  }, [org, sessionId]);

  // ── Verify chain
  const verifyChain = useCallback(async () => {
    if (!org) return;
    setVerifying(true);
    setVerifyError(null);
    try {
      const res = await fetch(`${SAAS}/audit/verify/${encodeURIComponent(sessionId)}`, {
        headers: { "X-API-Key": org.api_key },
      });
      if (res.status === 429) throw new Error("Rate limited (10 calls/min). Wait a moment and retry.");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Error ${res.status}`);
      }
      const data = await res.json();
      setVerifyResult(data);
    } catch (e: any) {
      setVerifyError(e.message || "Verification failed");
    } finally {
      setVerifying(false);
    }
  }, [org, sessionId]);

  // ── Voice demo state
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [voiceRunning, setVoiceRunning] = useState(false);
  const [voiceSessionId, setVoiceSessionId] = useState<string | null>(null);
  const [voiceDisclosure, setVoiceDisclosure] = useState<string | null>(null);
  const [voiceTurns, setVoiceTurns] = useState<VoiceTurnResult[]>([]);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceProofOpen, setVoiceProofOpen] = useState(false);
  const [voiceProof, setVoiceProof] = useState<ProofData | null>(null);
  const [voiceProofLoading, setVoiceProofLoading] = useState(false);
  const voiceAbort = useRef(false);

  const [webhookOpen, setWebhookOpen] = useState(false);
  const [webhookProvider, setWebhookProvider] = useState<WebhookProvider>("retell");
  const [webhookRunning, setWebhookRunning] = useState(false);
  const [webhookIncoming, setWebhookIncoming] = useState<WebhookIncomingResult | null>(null);
  const [webhookTurns, setWebhookTurns] = useState<WebhookTurnResult[]>([]);
  const [webhookError, setWebhookError] = useState<string | null>(null);
  const webhookAbort = useRef(false);

  const startVoiceCall = useCallback(async () => {
    if (!org) return;
    voiceAbort.current = false;
    setVoiceRunning(true);
    setVoiceError(null);
    setVoiceTurns([]);
    setVoiceSessionId(null);
    setVoiceDisclosure(null);
    setVoiceProof(null);
    setVoiceProofOpen(false);

    try {
      // Step 1: register the call
      const inRes = await fetch(`${SAAS}/voice/incoming`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": org.api_key },
        body: JSON.stringify({ caller_id: "demo-caller-001" }),
      });
      if (!inRes.ok) {
        const b = await inRes.json().catch(() => ({}));
        throw new Error(b.detail || `Error ${inRes.status}`);
      }
      const inData = await inRes.json();
      const sid: string = inData.session_id;
      setVoiceSessionId(sid);
      setVoiceDisclosure(inData.disclosure_text);

      // Step 2: play through each scripted turn with 800ms gaps
      for (let i = 0; i < VOICE_TURNS.length; i++) {
        if (voiceAbort.current) break;
        await new Promise(r => setTimeout(r, 800));
        if (voiceAbort.current) break;

        const turn = VOICE_TURNS[i];
        const txRes = await fetch(`${SAAS}/voice/transcript`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-API-Key": org.api_key },
          body: JSON.stringify({ session_id: sid, transcript_text: turn.text, turn_number: i + 1 }),
        });
        if (!txRes.ok) {
          const b = await txRes.json().catch(() => ({}));
          throw new Error(b.detail || `Error ${txRes.status}`);
        }
        const txData = await txRes.json();
        setVoiceTurns(prev => [...prev, {
          text: turn.text,
          label: turn.label,
          action: txData.action,
          reason_code: txData.reason_code,
          event_hash: txData.event_hash,
        }]);
      }
    } catch (e: any) {
      setVoiceError(e.message || "Voice simulation failed");
    } finally {
      setVoiceRunning(false);
    }
  }, [org]);

  const loadVoiceProof = useCallback(async () => {
    if (!org || !voiceSessionId) return;
    setVoiceProofLoading(true);
    try {
      const res = await fetch(`${SAAS}/audit/proof/${encodeURIComponent(voiceSessionId)}`, {
        headers: { "X-API-Key": org.api_key },
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.detail || `Error ${res.status}`);
      }
      const data: ProofData = await res.json();
      setVoiceProof(data);
      setVoiceProofOpen(true);
    } catch (e: any) {
      setVoiceError(e.message || "Failed to load proof");
    } finally {
      setVoiceProofLoading(false);
    }
  }, [org, voiceSessionId]);

  const startWebhookSim = useCallback(async () => {
    if (!org) return;
    webhookAbort.current = false;
    setWebhookRunning(true);
    setWebhookError(null);
    setWebhookIncoming(null);
    setWebhookTurns([]);

    const callId = `${webhookProvider}_${Math.random().toString(36).slice(2, 10)}`;
    const WHBASE = `${SAAS}/voice/webhook`;

    try {
      const inRes = await fetch(`${WHBASE}/incoming?api_key=${org.api_key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(makeIncomingPayload(webhookProvider, callId)),
      });
      if (!inRes.ok) {
        const b = await inRes.json().catch(() => ({}));
        throw new Error((b as any).detail || `Error ${inRes.status}`);
      }
      const inData: WebhookIncomingResult = await inRes.json();
      setWebhookIncoming(inData);

      for (let i = 0; i < VOICE_TURNS.length; i++) {
        if (webhookAbort.current) break;
        await new Promise(r => setTimeout(r, 800));
        if (webhookAbort.current) break;
        const turn = VOICE_TURNS[i];
        const txRes = await fetch(`${WHBASE}/transcript?api_key=${org.api_key}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(makeTranscriptPayload(webhookProvider, callId, turn.text, i + 1, inData.session_id)),
        });
        if (!txRes.ok) {
          const b = await txRes.json().catch(() => ({}));
          throw new Error((b as any).detail || `Error ${txRes.status}`);
        }
        const txData = await txRes.json();
        setWebhookTurns(prev => [...prev, {
          text: turn.text,
          label: turn.label,
          action: txData.action,
          reason_code: txData.reason_code,
          event_hash: txData.event_hash,
        }]);
      }
    } catch (e: any) {
      setWebhookError(e.message || "Webhook simulation failed");
    } finally {
      setWebhookRunning(false);
    }
  }, [org, webhookProvider]);

  const resetSession = () => {
    setSessionId(genSessionId());
    setSentEvents([]);
    setProof(null);
    setProofOpen(false);
    setProofError(null);
    setVerifyResult(null);
    setVerifyError(null);
  };

  const hasSentEvents = sentEvents.length > 0;

  // ── Layout helpers
  const card = (style: React.CSSProperties = {}) => ({
    background: "rgba(255,255,255,0.025)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 16, ...style,
  });

  return (
    <div style={{
      minHeight: "100dvh",
      background: "var(--nhid-bg)",
      fontFamily: "'Raleway', sans-serif",
      color: "var(--nhid-text)",
    }}>
      {/* ── Top header */}
      <header style={{
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        background: "rgba(7,12,23,0.9)",
        backdropFilter: "blur(14px)",
        position: "sticky", top: 0, zIndex: 30,
        padding: "0 24px",
        display: "flex", alignItems: "center", height: 56, gap: 14,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: 9,
          background: "linear-gradient(135deg, #00c2a8, #53d8fb)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 900, fontSize: 15, color: "#070c17",
          boxShadow: "0 0 14px rgba(0,194,168,0.4)",
          flexShrink: 0,
        }}>
          N
        </div>
        <div>
          <span style={{ fontWeight: 800, fontSize: 13, color: "var(--nhid-text)" }}>NHID Clinical</span>
          <span style={{ marginLeft: 8, fontSize: 10, color: "#334155", fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase" }}>Demo</span>
        </div>
        <div style={{ flex: 1 }} />
        <Link
          href="/dashboard"
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "7px 14px", borderRadius: 8, textDecoration: "none",
            background: "rgba(0,194,168,0.1)", border: "1px solid rgba(0,194,168,0.25)",
            color: "#00c2a8", fontSize: 12, fontWeight: 700,
            transition: "all 0.15s",
          }}
        >
          <Lock size={11} />
          Sign In for Full Access
          <ExternalLink size={10} />
        </Link>
      </header>

      {/* ── Content */}
      <div style={{ maxWidth: 780, margin: "0 auto", padding: "40px 24px 80px" }}>

        {/* ── Hero */}
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 7,
            padding: "5px 14px", borderRadius: 99, marginBottom: 20,
            background: "rgba(0,194,168,0.1)", border: "1px solid rgba(0,194,168,0.25)",
            fontSize: 11, fontWeight: 700, color: "#00c2a8", letterSpacing: "0.08em",
          }}>
            <Zap size={11} />
            LIVE DEMO — NO ACCOUNT NEEDED
          </div>
          <h1 style={{
            fontSize: 40, fontWeight: 900, color: "var(--nhid-text)",
            letterSpacing: "-0.03em", lineHeight: 1.15, marginBottom: 16,
          }}>
            Try NHID-Clinical
            <br />
            <span style={{ background: "linear-gradient(135deg, #00c2a8, #53d8fb)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
              Test the Governance Layer
            </span>
          </h1>
          <p style={{
            fontSize: 15, color: "#64748b", maxWidth: 520, margin: "0 auto", lineHeight: 1.7,
          }}>
            Send real audit events, get back signed cryptographic proofs,
            and verify the tamper-evident chain — all without an account.
          </p>
        </div>

        {/* ── Feature pills */}
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", marginBottom: 44 }}>
          {[
            { label: "SHA-256 hash chaining", color: "#53d8fb" },
            { label: "HMAC signatures", color: "#00c2a8" },
            { label: "Policy enforcement", color: "#fbbd24" },
            { label: "Tamper detection", color: "#a78bfa" },
          ].map(({ label, color }) => (
            <span key={label} style={{
              fontSize: 11, fontWeight: 600, padding: "5px 12px", borderRadius: 99,
              background: `${color}10`, border: `1px solid ${color}25`, color,
            }}>
              {label}
            </span>
          ))}
        </div>

        {/* ── Step 1: Create workspace */}
        <div style={{ ...card(), marginBottom: 16 }}>
          <div style={{ padding: "18px 22px", borderBottom: org ? "1px solid rgba(255,255,255,0.05)" : undefined }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: org ? 0 : 18 }}>
              <StepBadge n={1} done={!!org} />
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--nhid-text)" }}>
                  {org ? "Demo Workspace Ready" : "Create Your Demo Workspace"}
                </div>
                {!org && (
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                    Instant free-tier org — generates a real API key
                  </div>
                )}
              </div>
            </div>

            {!org && (
              <div>
                <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                  <input
                    value={orgNameInput}
                    onChange={e => setOrgNameInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && createOrg()}
                    placeholder="Workspace name (auto-generated)"
                    style={{
                      flex: 1, padding: "11px 14px", borderRadius: 9,
                      background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
                      color: "var(--nhid-text)", fontSize: 14, outline: "none",
                      fontFamily: "'Raleway', sans-serif",
                    }}
                    onFocus={e => (e.target.style.borderColor = "rgba(0,194,168,0.5)")}
                    onBlur={e => (e.target.style.borderColor = "rgba(255,255,255,0.1)")}
                  />
                  <button
                    onClick={createOrg}
                    disabled={creating}
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "11px 22px", borderRadius: 9, fontSize: 14, fontWeight: 800,
                      background: creating ? "rgba(0,194,168,0.3)" : "linear-gradient(135deg, #00c2a8, #53d8fb)",
                      border: "none", color: "#070c17", cursor: creating ? "not-allowed" : "pointer",
                      fontFamily: "'Raleway', sans-serif",
                      boxShadow: creating ? "none" : "0 0 24px rgba(0,194,168,0.3)",
                      transition: "all 0.2s", flexShrink: 0,
                    }}
                  >
                    {creating
                      ? <RefreshCw size={14} style={{ animation: "spin 1s linear infinite" }} />
                      : <Zap size={14} />
                    }
                    {creating ? "Creating…" : "Start Demo"}
                  </button>
                </div>
                {createError && (
                  <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <AlertTriangle size={13} color="#ef4444" style={{ flexShrink: 0, marginTop: 1 }} />
                    <span style={{ fontSize: 12, color: "#fca5a5" }}>{createError}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Org details after creation */}
          {org && (
            <div style={{ padding: "16px 22px", display: "flex", flexWrap: "wrap", gap: "12px 32px" }}>
              {[
                { label: "Workspace", value: org.org_name, mono: false, color: "#e2e8f0" },
                { label: "Plan", value: "Free tier · 100 calls/day", mono: false, color: "#64748b" },
              ].map(({ label, value, mono, color }) => (
                <div key={label}>
                  <div style={{ fontSize: 9, color: "#475569", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>{label}</div>
                  <div style={{ fontSize: 13, color, fontFamily: mono ? "monospace" : "inherit" }}>{value}</div>
                </div>
              ))}
              <div>
                <div style={{ fontSize: 9, color: "#475569", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>API Key</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <code style={{ fontSize: 12, color: "#00c2a8", fontFamily: "monospace" }}>
                    {`${org.api_key.slice(0, 14)}••••••${org.api_key.slice(-4)}`}
                  </code>
                  <CopyBtn value={org.api_key} />
                </div>
              </div>
              <div>
                <div style={{ fontSize: 9, color: "#475569", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 4 }}>Session ID</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <code style={{ fontSize: 11, color: "#53d8fb", fontFamily: "monospace" }}>{sessionId}</code>
                  <CopyBtn value={sessionId} size={10} />
                  <button
                    onClick={resetSession}
                    title="New session"
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#334155", padding: "2px 4px" }}
                  >
                    <RefreshCw size={10} />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Step 2: Pick an event */}
        {org && (
          <div style={{ ...card(), marginBottom: 16 }}>
            <div style={{ padding: "18px 22px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <StepBadge n={2} done={hasSentEvents} />
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "var(--nhid-text)" }}>Send an Audit Event</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                    Pick a preset — each sends a real signed event to the chain
                  </div>
                </div>
              </div>

              {/* Preset cards */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8, marginBottom: 18 }}>
                {PRESETS.map(p => {
                  const active = selectedPresetId === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setSelectedPresetId(p.id as PresetId)}
                      style={{
                        padding: "12px 12px", borderRadius: 10, cursor: "pointer",
                        background: active ? `${p.color}12` : "rgba(255,255,255,0.03)",
                        border: `1px solid ${active ? p.color + "40" : "rgba(255,255,255,0.07)"}`,
                        color: active ? p.color : "#64748b",
                        fontFamily: "'Raleway', sans-serif",
                        textAlign: "left",
                        boxShadow: active ? `0 0 16px ${p.color}18` : "none",
                        transition: "all 0.15s",
                      }}
                    >
                      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4, color: active ? p.color : "#94a3b8" }}>
                        {p.label}
                      </div>
                      <div style={{ fontSize: 10, color: active ? `${p.color}cc` : "#334155", lineHeight: 1.4 }}>
                        {p.desc}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Selected event preview */}
              <div style={{
                background: "rgba(0,0,0,0.2)", borderRadius: 10, padding: "14px 16px",
                border: "1px solid rgba(255,255,255,0.05)", marginBottom: 14,
              }}>
                <div style={{ fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10, fontWeight: 700 }}>
                  Event Payload Preview
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 20px" }}>
                  {[
                    { label: "event_type", value: selectedPreset.payload.event_type },
                    { label: "state", value: `${selectedPreset.payload.state_before} → ${selectedPreset.payload.state_after}` },
                    { label: "policy_action", value: selectedPreset.payload.policy_action ?? "—" },
                    { label: "reason_code", value: selectedPreset.payload.reason_code ?? "—" },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <div style={{ fontSize: 9, color: "#334155", marginBottom: 2 }}>{label}</div>
                      <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "monospace" }}>{value}</div>
                    </div>
                  ))}
                  {selectedPreset.payload.input_text && (
                    <div style={{ gridColumn: "span 2" }}>
                      <div style={{ fontSize: 9, color: "#334155", marginBottom: 2 }}>input_text</div>
                      <div style={{ fontSize: 11, color: "#94a3b8", fontStyle: "italic" }}>
                        "{selectedPreset.payload.input_text}"
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Send button */}
              <button
                onClick={sendEvent}
                disabled={sending}
                style={{
                  width: "100%", padding: "13px", borderRadius: 10, fontSize: 14, fontWeight: 800,
                  background: sending ? "rgba(0,194,168,0.3)" : "linear-gradient(135deg, #00c2a8, #53d8fb)",
                  border: "none", color: "#070c17", cursor: sending ? "not-allowed" : "pointer",
                  fontFamily: "'Raleway', sans-serif",
                  boxShadow: sending ? "none" : "0 0 28px rgba(0,194,168,0.3)",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
                  transition: "all 0.2s",
                }}
              >
                {sending
                  ? <RefreshCw size={15} style={{ animation: "spin 1s linear infinite" }} />
                  : <Shield size={15} />
                }
                {sending ? "Signing & Appending to Chain…" : `Send Audit Event: ${selectedPreset.label}`}
              </button>

              {sendError && (
                <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <AlertTriangle size={13} color="#ef4444" style={{ flexShrink: 0, marginTop: 1 }} />
                  <span style={{ fontSize: 12, color: "#fca5a5" }}>{sendError}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Step 3: Sent events + proof/verify */}
        {hasSentEvents && (
          <div style={{ ...card(), marginBottom: 16 }}>
            <div style={{ padding: "18px 22px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <StepBadge n={3} done={!!proof || !!verifyResult} />
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: "var(--nhid-text)" }}>
                    {sentEvents.length} Event{sentEvents.length !== 1 ? "s" : ""} Appended to Chain
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                    Each event is cryptographically signed and hash-chained
                  </div>
                </div>
              </div>

              {/* Event receipt list */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 18 }}>
                {sentEvents.map((ev, i) => (
                  <div
                    key={i}
                    style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "10px 14px", borderRadius: 9,
                      background: "rgba(0,194,168,0.05)", border: "1px solid rgba(0,194,168,0.15)",
                      animation: i === sentEvents.length - 1 ? "slideIn 0.3s ease" : "none",
                    }}
                  >
                    <CheckCircle size={14} color="#00c2a8" style={{ flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: ev.color }}>
                      {ev.preset_label}
                    </span>
                    <ArrowRight size={10} color="#334155" />
                    <code style={{ fontSize: 10, color: "#53d8fb", fontFamily: "monospace", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {ev.request_id}
                    </code>
                    <CopyBtn value={ev.request_id} size={10} />
                    <span style={{ fontSize: 9, color: "#334155", flexShrink: 0 }}>
                      {new Date(ev.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>

              {/* Action buttons */}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  onClick={loadProof}
                  disabled={loadingProof}
                  style={{
                    flex: 1, minWidth: 160, display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                    padding: "11px 18px", borderRadius: 9, fontSize: 13, fontWeight: 700,
                    background: loadingProof ? "rgba(83,216,251,0.15)" : "rgba(83,216,251,0.1)",
                    border: "1px solid rgba(83,216,251,0.3)", color: "#53d8fb",
                    cursor: loadingProof ? "not-allowed" : "pointer",
                    fontFamily: "'Raleway', sans-serif", transition: "all 0.15s",
                  }}
                >
                  {loadingProof ? <RefreshCw size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Layers size={13} />}
                  {loadingProof ? "Loading…" : "View Full Proof"}
                </button>
                <button
                  onClick={verifyChain}
                  disabled={verifying}
                  style={{
                    flex: 1, minWidth: 160, display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                    padding: "11px 18px", borderRadius: 9, fontSize: 13, fontWeight: 700,
                    background: verifying ? "rgba(0,194,168,0.15)" : "rgba(0,194,168,0.1)",
                    border: "1px solid rgba(0,194,168,0.3)", color: "#00c2a8",
                    cursor: verifying ? "not-allowed" : "pointer",
                    fontFamily: "'Raleway', sans-serif", transition: "all 0.15s",
                  }}
                >
                  {verifying ? <RefreshCw size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Shield size={13} />}
                  {verifying ? "Verifying…" : "Verify Full Chain"}
                </button>
              </div>

              {(proofError || verifyError) && (
                <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <AlertTriangle size={13} color="#ef4444" style={{ flexShrink: 0, marginTop: 1 }} />
                  <span style={{ fontSize: 12, color: "#fca5a5" }}>{proofError || verifyError}</span>
                </div>
              )}

              {/* Verify result banner */}
              {verifyResult && (
                <div style={{
                  marginTop: 14, borderRadius: 10, padding: "12px 16px",
                  background: verifyResult.chain_valid && verifyResult.hmac_valid ? "rgba(0,194,168,0.07)" : "rgba(239,68,68,0.07)",
                  border: `1px solid ${verifyResult.chain_valid && verifyResult.hmac_valid ? "rgba(0,194,168,0.25)" : "rgba(239,68,68,0.25)"}`,
                  display: "flex", alignItems: "center", gap: 12,
                }}>
                  {verifyResult.chain_valid && verifyResult.hmac_valid
                    ? <CheckCircle size={18} color="#00c2a8" />
                    : <XCircle size={18} color="#ef4444" />
                  }
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: verifyResult.chain_valid && verifyResult.hmac_valid ? "#00c2a8" : "#ef4444" }}>
                      {verifyResult.chain_valid && verifyResult.hmac_valid
                        ? "Chain intact — cryptographic integrity confirmed"
                        : "Integrity violation detected"
                      }
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                      {verifyResult.event_count} event{verifyResult.event_count !== 1 ? "s" : ""} verified in this session
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <HashChip ok={verifyResult.chain_valid} label="Hash chain" />
                    <HashChip ok={verifyResult.hmac_valid} label="HMAC" />
                  </div>
                </div>
              )}

              {/* Proof viewer */}
              {proof && proofOpen && (
                <div style={{ marginTop: 14 }}>
                  <button
                    onClick={() => setProofOpen(o => !o)}
                    style={{
                      background: "none", border: "none", cursor: "pointer",
                      display: "flex", alignItems: "center", gap: 6,
                      fontSize: 11, fontWeight: 700, color: "#64748b",
                      padding: "4px 0", marginBottom: 10,
                      fontFamily: "'Raleway', sans-serif",
                    }}
                  >
                    <ChevronDown size={13} />
                    Full proof — {proof.event_count} event{proof.event_count !== 1 ? "s" : ""}
                  </button>
                  <ProofViewer proof={proof} />
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Voice Simulation card */}
        {org && (
          <div style={{ ...card(), marginBottom: 16, overflow: "hidden" }}>
            {/* Header / toggle */}
            <button
              onClick={() => setVoiceOpen(o => !o)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 12,
                padding: "18px 22px", background: "none", border: "none", cursor: "pointer",
                textAlign: "left", fontFamily: "'Raleway', sans-serif",
              }}
            >
              <div style={{
                width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                background: voiceTurns.length > 0 ? "rgba(0,194,168,0.2)" : "rgba(255,255,255,0.07)",
                border: `1px solid ${voiceTurns.length > 0 ? "rgba(0,194,168,0.4)" : "rgba(255,255,255,0.12)"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Phone size={13} color={voiceTurns.length > 0 ? "#00c2a8" : "#64748b"} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--nhid-text)" }}>
                  Simulate Voice Call
                </div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                  6-turn scripted call with real-time policy enforcement logged to the audit trail
                </div>
              </div>
              {voiceOpen
                ? <ChevronDown size={16} color="#475569" />
                : <ChevronRight size={16} color="#475569" />
              }
            </button>

            {voiceOpen && (
              <div style={{ padding: "0 22px 22px", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                {/* Disclosure banner (shown after call starts) */}
                {voiceDisclosure && (
                  <div style={{
                    margin: "16px 0 12px", padding: "12px 14px", borderRadius: 10,
                    background: "rgba(251,189,36,0.08)", border: "1px solid rgba(251,189,36,0.25)",
                    display: "flex", gap: 10, alignItems: "flex-start",
                  }}>
                    <Bot size={14} color="#fbbd24" style={{ flexShrink: 0, marginTop: 1 }} />
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#fbbd24", letterSpacing: "0.08em", marginBottom: 4 }}>
                        AI DISCLOSURE · auto-played on call open
                      </div>
                      <div style={{ fontSize: 12, color: "#e2e8f0", lineHeight: 1.6 }}>
                        "{voiceDisclosure}"
                      </div>
                    </div>
                  </div>
                )}

                {/* Turn bubbles */}
                {voiceTurns.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                    {voiceTurns.map((turn, i) => {
                      const actionColor =
                        turn.action === "allow" ? "#00c2a8" :
                        turn.action === "escalate" ? "#ef4444" :
                        turn.action === "disclose" ? "#fbbd24" : "#94a3b8";
                      const actionBg =
                        turn.action === "allow" ? "rgba(0,194,168,0.08)" :
                        turn.action === "escalate" ? "rgba(239,68,68,0.08)" :
                        turn.action === "disclose" ? "rgba(251,189,36,0.08)" : "rgba(148,163,184,0.08)";
                      return (
                        <div
                          key={i}
                          style={{
                            display: "flex", alignItems: "flex-start", gap: 10,
                            animation: "slideIn 0.3s ease",
                          }}
                        >
                          {/* Caller bubble */}
                          <div style={{ flexShrink: 0 }}>
                            <User size={13} color="#64748b" style={{ marginTop: 3 }} />
                          </div>
                          <div style={{
                            flex: 1, padding: "10px 13px", borderRadius: 10,
                            background: "rgba(255,255,255,0.04)",
                            border: "1px solid rgba(255,255,255,0.07)",
                          }}>
                            <div style={{ fontSize: 10, color: "#475569", fontWeight: 700, marginBottom: 4, letterSpacing: "0.06em" }}>
                              {turn.label.toUpperCase()} · Turn {i + 1}
                            </div>
                            <div style={{ fontSize: 12, color: "#cbd5e1", lineHeight: 1.5 }}>
                              "{turn.text}"
                            </div>
                            {turn.event_hash && (
                              <div style={{ marginTop: 6, fontSize: 9, color: "#334155", fontFamily: "monospace", display: "flex", alignItems: "center", gap: 4 }}>
                                <span style={{ color: "#475569" }}>hash</span>
                                <code style={{ color: "#53d8fb" }}>{turn.event_hash.slice(0, 16)}…</code>
                                <CopyBtn value={turn.event_hash} size={9} />
                              </div>
                            )}
                          </div>
                          {/* Policy action badge */}
                          <span style={{
                            flexShrink: 0, padding: "4px 10px", borderRadius: 99, fontSize: 10, fontWeight: 800,
                            background: actionBg, color: actionColor,
                            border: `1px solid ${actionColor}30`,
                            letterSpacing: "0.06em", marginTop: 2,
                            textTransform: "uppercase",
                          }}>
                            {turn.action}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Summary box after escalation */}
                {!voiceRunning && voiceTurns.some(t => t.action === "escalate") && (
                  <div style={{
                    marginBottom: 16, padding: "14px 16px", borderRadius: 10,
                    background: "rgba(0,194,168,0.06)", border: "1px solid rgba(0,194,168,0.2)",
                    display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
                  }}>
                    <CheckCircle size={16} color="#00c2a8" style={{ flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0" }}>
                        {voiceTurns.length} policy decision{voiceTurns.length !== 1 ? "s" : ""} logged · Chain verified
                      </div>
                      <div style={{ fontSize: 11, color: "#64748b", marginTop: 3, fontFamily: "monospace" }}>
                        Session: {voiceSessionId}
                      </div>
                    </div>
                    <button
                      onClick={loadVoiceProof}
                      disabled={voiceProofLoading}
                      style={{
                        display: "flex", alignItems: "center", gap: 7,
                        padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 700,
                        background: "rgba(83,216,251,0.1)", border: "1px solid rgba(83,216,251,0.3)",
                        color: "#53d8fb", cursor: voiceProofLoading ? "not-allowed" : "pointer",
                        fontFamily: "'Raleway', sans-serif",
                      }}
                    >
                      {voiceProofLoading
                        ? <RefreshCw size={12} style={{ animation: "spin 1s linear infinite" }} />
                        : <Layers size={12} />
                      }
                      View Full Proof
                    </button>
                  </div>
                )}

                {/* Proof viewer for voice session */}
                {voiceProof && voiceProofOpen && (
                  <div style={{ marginBottom: 16 }}>
                    <button
                      onClick={() => setVoiceProofOpen(o => !o)}
                      style={{
                        background: "none", border: "none", cursor: "pointer",
                        display: "flex", alignItems: "center", gap: 6,
                        fontSize: 11, fontWeight: 700, color: "#64748b",
                        padding: "4px 0", marginBottom: 10,
                        fontFamily: "'Raleway', sans-serif",
                      }}
                    >
                      <ChevronDown size={13} />
                      Voice audit trail — {voiceProof.event_count} event{voiceProof.event_count !== 1 ? "s" : ""}
                    </button>
                    <ProofViewer proof={voiceProof} />
                  </div>
                )}

                {voiceError && (
                  <div style={{ marginBottom: 12, display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <AlertTriangle size={13} color="#ef4444" style={{ flexShrink: 0, marginTop: 2 }} />
                    <span style={{ fontSize: 12, color: "#fca5a5" }}>{voiceError}</span>
                  </div>
                )}

                {/* Start button */}
                <button
                  onClick={startVoiceCall}
                  disabled={voiceRunning}
                  style={{
                    width: "100%", padding: "13px", borderRadius: 10, fontSize: 14, fontWeight: 800,
                    background: voiceRunning
                      ? "rgba(0,194,168,0.3)"
                      : "linear-gradient(135deg, #00c2a8, #53d8fb)",
                    border: "none", color: "#070c17",
                    cursor: voiceRunning ? "not-allowed" : "pointer",
                    fontFamily: "'Raleway', sans-serif",
                    boxShadow: voiceRunning ? "none" : "0 0 28px rgba(0,194,168,0.3)",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
                    transition: "all 0.2s",
                  }}
                >
                  {voiceRunning
                    ? <RefreshCw size={15} style={{ animation: "spin 1s linear infinite" }} />
                    : <Phone size={15} />
                  }
                  {voiceRunning ? "Running call simulation…" : "Start Simulated Call"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── Webhook Integration card */}
        {org && (
          <div style={{ ...card(), marginBottom: 16, overflow: "hidden" }}>
            <button
              onClick={() => setWebhookOpen(o => !o)}
              style={{
                width: "100%", display: "flex", alignItems: "center", gap: 12,
                padding: "18px 22px", background: "none", border: "none", cursor: "pointer",
                textAlign: "left", fontFamily: "'Raleway', sans-serif",
              }}
            >
              <div style={{
                width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                background: webhookTurns.length > 0 ? "rgba(83,216,251,0.2)" : "rgba(255,255,255,0.07)",
                border: `1px solid ${webhookTurns.length > 0 ? "rgba(83,216,251,0.4)" : "rgba(255,255,255,0.12)"}`,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                <Link2 size={13} color={webhookTurns.length > 0 ? "#53d8fb" : "#64748b"} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--nhid-text)" }}>
                  Webhook Integration
                </div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                  Connect Retell AI, Vapi, or Twilio — payloads auto-detected and normalised
                </div>
              </div>
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
                padding: "3px 8px", borderRadius: 5,
                background: "rgba(83,216,251,0.1)", color: "#53d8fb",
                border: "1px solid rgba(83,216,251,0.2)", marginRight: 8,
              }}>
                INTEGRATION
              </span>
              {webhookOpen ? <ChevronDown size={16} color="#475569" /> : <ChevronRight size={16} color="#475569" />}
            </button>

            {webhookOpen && (
              <div style={{ padding: "0 22px 22px", borderTop: "1px solid rgba(255,255,255,0.05)" }}>

                {/* Provider tabs */}
                <div style={{ marginTop: 18, marginBottom: 18 }}>
                  <div style={{ fontSize: 10, color: "#475569", fontWeight: 700, letterSpacing: "0.08em", marginBottom: 10 }}>
                    SELECT VOICE PLATFORM
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {(["retell", "vapi", "twilio", "generic"] as WebhookProvider[]).map(p => {
                      const labels: Record<WebhookProvider, string> = { retell: "Retell AI", vapi: "Vapi", twilio: "Twilio", generic: "Generic / Custom" };
                      const colors: Record<WebhookProvider, string> = { retell: "#a78bfa", vapi: "#53d8fb", twilio: "#ef4444", generic: "#00c2a8" };
                      const active = webhookProvider === p;
                      return (
                        <button
                          key={p}
                          onClick={() => { setWebhookProvider(p); setWebhookIncoming(null); setWebhookTurns([]); setWebhookError(null); }}
                          style={{
                            padding: "7px 16px", borderRadius: 8, fontSize: 12, fontWeight: 700,
                            fontFamily: "'Raleway', sans-serif", cursor: "pointer",
                            background: active ? `${colors[p]}18` : "rgba(255,255,255,0.03)",
                            border: `1px solid ${active ? colors[p] + "50" : "rgba(255,255,255,0.08)"}`,
                            color: active ? colors[p] : "#475569",
                            transition: "all 0.15s",
                          }}
                        >
                          {labels[p]}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Payload preview */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 10, color: "#475569", fontWeight: 700, letterSpacing: "0.08em", marginBottom: 8 }}>
                    INCOMING CALL PAYLOAD · what {webhookProvider === "generic" ? "your app" : webhookProvider.charAt(0).toUpperCase() + webhookProvider.slice(1)} sends
                  </div>
                  <div style={{
                    background: "rgba(0,0,0,0.3)", borderRadius: 10, padding: "12px 14px",
                    border: "1px solid rgba(255,255,255,0.06)", position: "relative",
                  }}>
                    <CopyBtn value={JSON.stringify(makeIncomingPayload(webhookProvider, `${webhookProvider}_call_example`), null, 2)} size={11} />
                    <pre style={{
                      margin: 0, fontSize: 10, color: "#94a3b8", fontFamily: "monospace",
                      lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-all",
                    }}>
                      {JSON.stringify(makeIncomingPayload(webhookProvider, `${webhookProvider}_call_example`), null, 2)}
                    </pre>
                  </div>
                </div>

                {/* Disclosure banner */}
                {webhookIncoming && (
                  <div style={{
                    marginBottom: 14, padding: "12px 14px", borderRadius: 10,
                    background: "rgba(83,216,251,0.06)", border: "1px solid rgba(83,216,251,0.2)",
                    display: "flex", gap: 10, alignItems: "flex-start",
                  }}>
                    <Bot size={14} color="#53d8fb" style={{ flexShrink: 0, marginTop: 2 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: "#53d8fb", letterSpacing: "0.08em", marginBottom: 4 }}>
                        NHID RESPONSE · session created · provider: {webhookIncoming.provider}
                      </div>
                      <div style={{ fontSize: 11, color: "#e2e8f0", lineHeight: 1.6, marginBottom: 6 }}>
                        "{webhookIncoming.disclosure_text}"
                      </div>
                      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                        <div>
                          <span style={{ fontSize: 9, color: "#475569" }}>session_id </span>
                          <code style={{ fontSize: 9, color: "#53d8fb", fontFamily: "monospace" }}>{webhookIncoming.session_id}</code>
                        </div>
                        {webhookIncoming.provider_call_id && (
                          <div>
                            <span style={{ fontSize: 9, color: "#475569" }}>provider_call_id </span>
                            <code style={{ fontSize: 9, color: "#a78bfa", fontFamily: "monospace" }}>{webhookIncoming.provider_call_id}</code>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Turn results */}
                {webhookTurns.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 14 }}>
                    {webhookTurns.map((turn, i) => {
                      const aC = turn.action === "allow" ? "#00c2a8" : turn.action === "escalate" ? "#ef4444" : turn.action === "disclose" ? "#fbbd24" : "#94a3b8";
                      const aBg = turn.action === "allow" ? "rgba(0,194,168,0.07)" : turn.action === "escalate" ? "rgba(239,68,68,0.07)" : turn.action === "disclose" ? "rgba(251,189,36,0.07)" : "rgba(148,163,184,0.07)";
                      return (
                        <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", borderRadius: 9, background: aBg, border: `1px solid ${aC}20`, animation: i === webhookTurns.length - 1 ? "slideIn 0.3s ease" : "none" }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 9, color: "#475569", fontWeight: 700, marginBottom: 3 }}>
                              {turn.label.toUpperCase()} · Turn {i + 1}
                            </div>
                            <div style={{ fontSize: 11, color: "#cbd5e1" }}>"{turn.text}"</div>
                            {turn.event_hash && (
                              <code style={{ fontSize: 9, color: "#334155", fontFamily: "monospace" }}>
                                hash {turn.event_hash.slice(0, 16)}…
                              </code>
                            )}
                          </div>
                          <span style={{
                            flexShrink: 0, padding: "3px 9px", borderRadius: 99, fontSize: 10, fontWeight: 800,
                            background: aBg, color: aC, border: `1px solid ${aC}30`,
                            letterSpacing: "0.06em", textTransform: "uppercase",
                          }}>
                            {turn.action}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {webhookError && (
                  <div style={{ marginBottom: 12, display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <AlertTriangle size={13} color="#ef4444" style={{ flexShrink: 0, marginTop: 2 }} />
                    <span style={{ fontSize: 12, color: "#fca5a5" }}>{webhookError}</span>
                  </div>
                )}

                {/* Simulate button */}
                <button
                  onClick={startWebhookSim}
                  disabled={webhookRunning}
                  style={{
                    width: "100%", padding: "13px", borderRadius: 10, fontSize: 14, fontWeight: 800,
                    background: webhookRunning ? "rgba(83,216,251,0.25)" : "linear-gradient(135deg, #3b82f6, #53d8fb)",
                    border: "none", color: "#070c17",
                    cursor: webhookRunning ? "not-allowed" : "pointer",
                    fontFamily: "'Raleway', sans-serif",
                    boxShadow: webhookRunning ? "none" : "0 0 28px rgba(83,216,251,0.25)",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
                    transition: "all 0.2s", marginBottom: 20,
                  }}
                >
                  {webhookRunning
                    ? <RefreshCw size={15} style={{ animation: "spin 1s linear infinite" }} />
                    : <Link2 size={15} />
                  }
                  {webhookRunning ? "Firing webhooks…" : `Simulate ${webhookProvider.charAt(0).toUpperCase() + webhookProvider.slice(1)} Webhook Flow`}
                </button>

                {/* Setup instructions */}
                <div style={{ background: "rgba(0,0,0,0.2)", borderRadius: 10, padding: "16px", border: "1px solid rgba(255,255,255,0.05)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                    <Globe size={13} color="#64748b" />
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                      Configure in {webhookProvider === "generic" ? "your platform" : webhookProvider.charAt(0).toUpperCase() + webhookProvider.slice(1)}
                    </span>
                  </div>
                  {[
                    { label: "Incoming call URL", path: "/voice/webhook/incoming" },
                    { label: "Transcript URL", path: "/voice/webhook/transcript" },
                  ].map(({ label, path }) => (
                    <div key={path} style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 9, color: "#475569", marginBottom: 4 }}>{label}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(0,0,0,0.3)", borderRadius: 7, padding: "7px 10px", border: "1px solid rgba(255,255,255,0.04)" }}>
                        <code style={{ flex: 1, fontSize: 9, color: "#53d8fb", fontFamily: "monospace", wordBreak: "break-all" }}>
                          {`${window.location.origin}/saas-api/saas${path}?api_key=${org.api_key.slice(0, 10)}…`}
                        </code>
                        <CopyBtn value={`${window.location.origin}/saas-api/saas${path}?api_key=${org.api_key}`} size={10} />
                      </div>
                    </div>
                  ))}
                  <div style={{ marginTop: 12, fontSize: 11, color: "#475569", lineHeight: 1.7 }}>
                    {webhookProvider === "retell" && <>
                      In Retell dashboard → <strong style={{ color: "#94a3b8" }}>Agent → Webhook URL</strong> → paste the Incoming Call URL above. Enable <strong style={{ color: "#94a3b8" }}>transcript</strong> events and set the Transcript URL. Your api_key is already embedded in both URLs.
                    </>}
                    {webhookProvider === "vapi" && <>
                      In Vapi dashboard → <strong style={{ color: "#94a3b8" }}>Assistant → Server URL</strong> → paste the Incoming Call URL. Enable <strong style={{ color: "#94a3b8" }}>call-start</strong> and <strong style={{ color: "#94a3b8" }}>transcript</strong> message types. Use the same URL for both — NHID auto-detects the event type.
                    </>}
                    {webhookProvider === "twilio" && <>
                      In your TwiML or Twilio Studio flow, set the <strong style={{ color: "#94a3b8" }}>Status Callback</strong> to the Incoming Call URL and use a <strong style={{ color: "#94a3b8" }}>&lt;Gather&gt;</strong> or <strong style={{ color: "#94a3b8" }}>&lt;Record transcribeCallback&gt;</strong> pointing to the Transcript URL.
                    </>}
                    {webhookProvider === "generic" && <>
                      POST the incoming call body to the Incoming Call URL. Use the returned <strong style={{ color: "#94a3b8" }}>session_id</strong> as the <code style={{ color: "#53d8fb", fontFamily: "monospace" }}>session_id</code> field in all subsequent transcript payloads.
                    </>}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── CTA: Use full app */}
        {org && (
          <div style={{
            ...card({ borderColor: "rgba(0,194,168,0.2)", background: "rgba(0,194,168,0.04)" }),
            padding: "24px 28px",
            display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap",
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: "var(--nhid-text)", marginBottom: 6 }}>
                Your demo workspace is ready for the full experience
              </div>
              <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6 }}>
                Your API key is already saved. Sign in to access the Audit Trail Explorer,
                real-time usage dashboard, Stripe billing, and the admin portal.
              </div>
            </div>
            <Link
              href="/dashboard"
              style={{
                display: "flex", alignItems: "center", gap: 8,
                padding: "12px 22px", borderRadius: 10, textDecoration: "none",
                background: "linear-gradient(135deg, #00c2a8, #53d8fb)",
                color: "#070c17", fontSize: 13, fontWeight: 800,
                fontFamily: "'Raleway', sans-serif",
                boxShadow: "0 0 24px rgba(0,194,168,0.3)",
                flexShrink: 0,
              }}
            >
              Open Full Dashboard
              <ArrowRight size={14} />
            </Link>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes slideIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }
        input::placeholder { color: #334155; }
        a:hover { opacity: 0.85; }
      `}</style>
    </div>
  );
}
