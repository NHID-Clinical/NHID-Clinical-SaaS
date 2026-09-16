import { useState, useCallback } from "react";
import { Link } from "wouter";

const BASE_URL = typeof window !== "undefined"
  ? `${window.location.origin}/saas-api`
  : "https://your-domain.replit.app/saas-api";

const TEAL = "#00c2a8";
const CYAN = "#53d8fb";
const BG = "#070c17";

const PYTHON_QUICKSTART = `from nhid_sdk import NHIDClient, NHIDError

client = NHIDClient(
    api_key="nhid_your_key_here",
    base_url="${BASE_URL}",
)

# 1. Start a session
session_id = client.create_session()
print("Session:", session_id)

# 2. Log agent events
client.send_event(session_id, {
    "event_type": "AGENT_ACTION",
    "state_before": "IDLE",
    "state_after": "RUNNING",
    "input_text": "User asked about medication dosage",
    "policy_action": "allow",
})

client.send_event(session_id, {
    "event_type": "POLICY_CHECK",
    "state_before": "RUNNING",
    "state_after": "ESCALATED",
    "policy_action": "escalate",
    "reason_code": "HUMAN_ESCALATION_REQUESTED",
    "response_text": "Transferring to a human agent",
})

# 3. Retrieve tamper-evident proof
proof = client.get_proof(session_id)
print(f"Events: {proof['event_count']}  Chain valid: {proof['valid_chain']}")

# 4. Programmatic chain verification
is_intact = client.verify_chain(session_id)
assert is_intact, "Audit chain was tampered with!"`;

const NODE_QUICKSTART = `// nhid_client.mjs  ─  Node 18+ (uses built-in fetch + crypto)

class NHIDClient {
  constructor({ apiKey, baseUrl = "${BASE_URL}" }) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\\/$/, "");
  }

  async #call(method, path, body) {
    const res = await fetch(\`\${this.baseUrl}\${path}\`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(\`NHID \${res.status}: \${err.detail}\`);
    }
    return res.json();
  }

  createSession() {
    return crypto.randomUUID();
  }

  sendEvent(sessionId, eventData) {
    return this.#call("POST", "/saas/trace", { session_id: sessionId, ...eventData });
  }

  getProof(sessionId) {
    return this.#call("GET", \`/saas/proof/\${sessionId}\`);
  }

  async verifyChain(sessionId) {
    const proof = await this.getProof(sessionId);
    return proof.valid_chain === true;
  }
}

// ── Usage ────────────────────────────────────────────────────────────────────
const client = new NHIDClient({ apiKey: "nhid_your_key_here" });

const sessionId = client.createSession();

await client.sendEvent(sessionId, {
  event_type: "AGENT_ACTION",
  state_before: "IDLE",
  state_after: "RUNNING",
  input_text: "User query received",
  policy_action: "allow",
});

const proof = await client.getProof(sessionId);
console.log(\`Events: \${proof.event_count}  Chain valid: \${proof.valid_chain}\`);

const intact = await client.verifyChain(sessionId);
console.assert(intact, "Chain integrity failure!");`;

const BANDWIDTH_ADAPTER = `"""
bandwidth_adapter.py — Bridge Bandwidth webhooks into NHID-Clinical

Bandwidth sends voice events to a URL you configure in the
Bandwidth Dashboard → Applications → Voice → Event URL.

This FastAPI adapter transforms Bandwidth payloads and forwards
them to NHID's provider-agnostic webhook endpoints for real-time
policy enforcement and tamper-evident audit logging.
"""
from fastapi import FastAPI, Request, HTTPException
import httpx

app = FastAPI()

NHID_BASE   = "${BASE_URL}"
NHID_APIKEY = "nhid_your_key_here"          # set via env var in production
NHID_INCOMING   = f"{NHID_BASE}/saas/voice/webhook/incoming"
NHID_TRANSCRIPT = f"{NHID_BASE}/saas/voice/webhook/transcript"
# Send the key as a header. The ?api_key= query parameter still works for
# existing registrations but is deprecated: query strings are captured by
# access logs and proxies.
NHID_HEADERS = {"X-NHID-API-Key": NHID_APIKEY}


@app.post("/bandwidth/voice")
async def bandwidth_voice(req: Request):
    """Receive all Bandwidth voice events at a single URL."""
    body = await req.json()
    event_type = body.get("eventType", "")

    if event_type in ("initiate", "answer"):
        # Map to NHID generic incoming format
        nhid_payload = {
            "session_id": body.get("callId"),       # use as provider_call_id
            "caller_id":  body.get("from"),
            "metadata": {
                "to":        body.get("to"),
                "direction": body.get("direction", "inbound"),
                "eventType": event_type,
            },
        }
        async with httpx.AsyncClient() as client:
            r = await client.post(NHID_INCOMING, json=nhid_payload, headers=NHID_HEADERS)
        return r.json()

    if event_type == "transcription":
        # Map to NHID generic transcript format
        nhid_payload = {
            "session_id":      body.get("callId"),
            "transcript_text": body.get("transcript", ""),
            "turn_number":     body.get("sequenceId", 1),
            "metadata": {
                "confidence": body.get("confidence"),
            },
        }
        async with httpx.AsyncClient() as client:
            r = await client.post(NHID_TRANSCRIPT, json=nhid_payload, headers=NHID_HEADERS)
        return r.json()

    if event_type == "disconnect":
        # Optionally log call end as an audit event
        return {"status": "ignored", "eventType": event_type}

    raise HTTPException(status_code=400, detail=f"Unhandled eventType: {event_type}")`;

const BANDWIDTH_BXML = `# bandwidth_bxml.py — Return BXML to Bandwidth on incoming calls
#
# Bandwidth requires your event URL to return BXML (an XML dialect)
# that controls call flow.  Add this alongside the adapter above
# if you need to answer calls and record transcripts.

from fastapi.responses import Response

BXML_ANSWER = """<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <SpeakSentence voice="julie">
    This call is handled by an AI system and may be recorded for compliance.
    You may request a human agent at any time.
  </SpeakSentence>
  <StartTranscription
      name="nhid-transcript"
      tracks="inbound"
      destination="https://your-domain.com/bandwidth/voice"
      tag="nhid-session"/>
</Response>"""

@app.post("/bandwidth/answer")
async def bandwidth_answer(req: Request):
    return Response(content=BXML_ANSWER, media_type="application/xml")`;

const sections = [
  { id: "python", label: "Python SDK" },
  { id: "nodejs", label: "Node.js" },
  { id: "bandwidth", label: "Bandwidth Webhooks" },
];

function CodeBlock({ code, language = "python" }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [code]);

  return (
    <div
      style={{
        position: "relative",
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "0.55rem 1rem",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(255,255,255,0.02)",
        }}
      >
        <span style={{ color: "#475569", fontSize: "0.75rem", fontFamily: "monospace" }}>
          {language}
        </span>
        <button
          onClick={copy}
          style={{
            background: copied ? "rgba(0,194,168,0.2)" : "rgba(255,255,255,0.07)",
            border: `1px solid ${copied ? "rgba(0,194,168,0.4)" : "rgba(255,255,255,0.1)"}`,
            borderRadius: 6,
            color: copied ? TEAL : "#94a3b8",
            fontSize: "0.72rem",
            fontWeight: 600,
            padding: "0.25rem 0.7rem",
            cursor: "pointer",
            transition: "all 0.15s",
            letterSpacing: "0.02em",
          }}
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre
        style={{
          margin: 0,
          padding: "1.25rem 1.25rem",
          overflowX: "auto",
          fontSize: "0.82rem",
          lineHeight: 1.65,
          color: "#cbd5e1",
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace",
          whiteSpace: "pre",
        }}
      >
        {code}
      </pre>
    </div>
  );
}

function SectionHeader({ title, subtitle, id }: { title: string; subtitle: string; id: string }) {
  return (
    <div id={id} style={{ scrollMarginTop: "5rem", marginBottom: "1.5rem" }}>
      <h2
        style={{
          fontSize: "1.35rem",
          fontWeight: 700,
          color: "#f1f5f9",
          margin: "0 0 0.4rem",
          letterSpacing: "-0.02em",
        }}
      >
        {title}
      </h2>
      <p style={{ color: "#64748b", fontSize: "0.9rem", margin: 0, lineHeight: 1.6 }}>
        {subtitle}
      </p>
    </div>
  );
}

function StepBadge({ n }: { n: number }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 24,
        height: 24,
        borderRadius: 6,
        background: `linear-gradient(135deg, ${TEAL}, ${CYAN})`,
        color: BG,
        fontSize: "0.72rem",
        fontWeight: 900,
        flexShrink: 0,
      }}
    >
      {n}
    </span>
  );
}

export default function DocsSDKPage() {
  const [activeSection, setActiveSection] = useState("python");

  return (
    <div
      style={{
        minHeight: "100vh",
        background: BG,
        fontFamily: "'Inter', 'Raleway', sans-serif",
        color: "#f1f5f9",
      }}
    >
      {/* Top nav */}
      <nav
        style={{
          position: "sticky",
          top: 0,
          zIndex: 40,
          backdropFilter: "blur(16px)",
          background: "rgba(7,12,23,0.85)",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          padding: "0.85rem 2rem",
        }}
      >
        <Link
          href="/try"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.6rem",
            textDecoration: "none",
          }}
        >
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: `linear-gradient(135deg, ${TEAL}, ${CYAN})`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "'Raleway', sans-serif",
              fontWeight: 900,
              fontSize: 15,
              color: BG,
            }}
          >
            N
          </div>
          <span style={{ fontWeight: 700, color: "#f1f5f9", fontSize: "0.9rem" }}>
            NHID Clinical
          </span>
        </Link>

        <span style={{ color: "#1e293b", fontSize: "1.2rem" }}>›</span>
        <span style={{ color: "#64748b", fontSize: "0.85rem" }}>SDK Reference</span>

        <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
          {sections.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              onClick={() => setActiveSection(s.id)}
              style={{
                padding: "0.3rem 0.75rem",
                borderRadius: 6,
                fontSize: "0.8rem",
                fontWeight: 600,
                textDecoration: "none",
                transition: "all 0.15s",
                background:
                  activeSection === s.id
                    ? "rgba(0,194,168,0.12)"
                    : "transparent",
                color: activeSection === s.id ? TEAL : "#64748b",
                border: `1px solid ${activeSection === s.id ? "rgba(0,194,168,0.25)" : "transparent"}`,
              }}
            >
              {s.label}
            </a>
          ))}
        </div>
      </nav>

      {/* Hero */}
      <div
        style={{
          padding: "4rem 2rem 2.5rem",
          maxWidth: 860,
          margin: "0 auto",
          textAlign: "center",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.35rem 0.9rem",
            borderRadius: 20,
            border: `1px solid rgba(0,194,168,0.3)`,
            background: "rgba(0,194,168,0.08)",
            fontSize: "0.75rem",
            fontWeight: 700,
            color: TEAL,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            marginBottom: "1.5rem",
          }}
        >
          SDK Reference
        </div>

        <h1
          style={{
            fontSize: "clamp(2rem, 5vw, 3rem)",
            fontWeight: 900,
            letterSpacing: "-0.03em",
            margin: "0 0 1rem",
            fontFamily: "'Raleway', sans-serif",
            lineHeight: 1.1,
          }}
        >
          Integrate NHID-Clinical
          <br />
          <span
            style={{
              background: `linear-gradient(90deg, ${TEAL}, ${CYAN})`,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            in minutes
          </span>
        </h1>

        <p
          style={{
            color: "#64748b",
            fontSize: "1.05rem",
            lineHeight: 1.7,
            maxWidth: 560,
            margin: "0 auto 2rem",
          }}
        >
          Append tamper-evident audit events, retrieve cryptographic proof, and
          enforce voice call policy — from Python, Node.js, or any HTTP client.
        </p>

        {/* Download SDK pill */}
        <a
          href="/nhid_sdk.py"
          download="nhid_sdk.py"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.5rem",
            padding: "0.55rem 1.25rem",
            borderRadius: 8,
            background: `linear-gradient(135deg, ${TEAL}, ${CYAN})`,
            color: BG,
            fontWeight: 700,
            fontSize: "0.85rem",
            textDecoration: "none",
            letterSpacing: "-0.01em",
            boxShadow: `0 0 20px rgba(0,194,168,0.3)`,
          }}
        >
          ↓ Download nhid_sdk.py
        </a>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "0 2rem 6rem" }}>

        {/* ── Quickstart overview ─────────────────────────────────── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
            gap: "1rem",
            marginBottom: "3.5rem",
          }}
        >
          {[
            { icon: "🔑", title: "create_session()", desc: "Generate a UUID for a new interaction" },
            { icon: "📝", title: "send_event()", desc: "Append a signed, chained audit event" },
            { icon: "🔍", title: "get_proof()", desc: "Retrieve the full ordered audit trail" },
            { icon: "✅", title: "verify_chain()", desc: "Confirm no tampering has occurred" },
          ].map((m) => (
            <div
              key={m.title}
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: 12,
                padding: "1rem 1.1rem",
              }}
            >
              <div style={{ fontSize: "1.25rem", marginBottom: "0.4rem" }}>{m.icon}</div>
              <div
                style={{
                  fontFamily: "monospace",
                  fontSize: "0.8rem",
                  color: CYAN,
                  fontWeight: 600,
                  marginBottom: "0.3rem",
                }}
              >
                {m.title}
              </div>
              <div style={{ color: "#64748b", fontSize: "0.8rem", lineHeight: 1.5 }}>
                {m.desc}
              </div>
            </div>
          ))}
        </div>

        {/* ── Python SDK ──────────────────────────────────────────── */}
        <SectionHeader
          id="python"
          title="Python SDK"
          subtitle="Single-file, zero-dependency. Drop nhid_sdk.py into your project — no pip install required."
        />

        <div style={{ marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
            <StepBadge n={1} />
            <span style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
              Download <code style={{ color: TEAL }}>nhid_sdk.py</code> and place it next to your script
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
            <StepBadge n={2} />
            <span style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
              Copy your API key from the NHID dashboard → Settings
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.5rem" }}>
            <StepBadge n={3} />
            <span style={{ color: "#94a3b8", fontSize: "0.85rem" }}>
              Run the quickstart below — every event is HMAC-signed and hash-chained automatically
            </span>
          </div>
          <CodeBlock code={PYTHON_QUICKSTART} language="python" />
        </div>

        <div
          style={{
            background: "rgba(0,194,168,0.06)",
            border: "1px solid rgba(0,194,168,0.15)",
            borderRadius: 10,
            padding: "0.9rem 1.1rem",
            display: "flex",
            gap: "0.75rem",
            alignItems: "flex-start",
            marginBottom: "3.5rem",
          }}
        >
          <span style={{ fontSize: "1rem", flexShrink: 0, marginTop: 1 }}>ℹ️</span>
          <div style={{ color: "#94a3b8", fontSize: "0.83rem", lineHeight: 1.6 }}>
            <strong style={{ color: TEAL }}>No external dependencies.</strong>{" "}
            nhid_sdk.py uses only Python standard library (<code>urllib</code>, <code>json</code>, <code>uuid</code>).
            Compatible with Python 3.8+. For advanced usage (connection pooling, async), swap the{" "}
            <code>_call</code> method for <code>httpx</code> or <code>aiohttp</code>.
          </div>
        </div>

        {/* ── Node.js ──────────────────────────────────────────────── */}
        <SectionHeader
          id="nodejs"
          title="Node.js"
          subtitle="Paste the class into your project — uses built-in fetch (Node 18+) and crypto. No npm install needed."
        />

        <div style={{ marginBottom: "3.5rem" }}>
          <CodeBlock code={NODE_QUICKSTART} language="javascript" />

          <div
            style={{
              marginTop: "1rem",
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: 10,
              padding: "0.9rem 1.1rem",
              display: "flex",
              gap: "0.75rem",
              alignItems: "flex-start",
            }}
          >
            <span style={{ fontSize: "1rem", flexShrink: 0, marginTop: 1 }}>💡</span>
            <div style={{ color: "#64748b", fontSize: "0.83rem", lineHeight: 1.6 }}>
              Private class fields (<code>#call</code>) require Node 12+. For older environments replace
              with <code>_call</code> or move the logic into a module closure. Works identically in Deno
              and Bun (both support <code>fetch</code> and <code>crypto.randomUUID()</code> natively).
            </div>
          </div>
        </div>

        {/* ── Bandwidth ───────────────────────────────────────────── */}
        <SectionHeader
          id="bandwidth"
          title="Bandwidth Webhook Setup"
          subtitle="Receive Bandwidth voice events, enforce NHID compliance policy, and log every turn to the tamper-evident audit trail."
        />

        <div style={{ marginBottom: "1.5rem" }}>
          {/* How it works */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
              gap: "0.75rem",
              marginBottom: "1.5rem",
            }}
          >
            {[
              { label: "Bandwidth", arrow: false, desc: "Sends voice events to your adapter URL" },
              { label: "Your Adapter", arrow: false, desc: "Maps eventType → NHID generic format" },
              { label: "NHID Webhook", arrow: false, desc: "Enforces policy, logs signed audit event" },
              { label: "Policy Action", arrow: false, desc: "disclose / allow / escalate returned" },
            ].map((step, i) => (
              <div key={step.label} style={{ display: "flex", alignItems: "stretch", gap: "0.5rem" }}>
                {i > 0 && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      color: "#334155",
                      fontSize: "1.1rem",
                      flexShrink: 0,
                    }}
                  >
                    →
                  </div>
                )}
                <div
                  style={{
                    flex: 1,
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.07)",
                    borderRadius: 10,
                    padding: "0.75rem",
                  }}
                >
                  <div style={{ fontWeight: 700, color: "#e2e8f0", fontSize: "0.82rem", marginBottom: "0.25rem" }}>
                    {step.label}
                  </div>
                  <div style={{ color: "#475569", fontSize: "0.75rem", lineHeight: 1.5 }}>
                    {step.desc}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Dashboard config instructions */}
          <div
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 10,
              padding: "1rem 1.25rem",
              marginBottom: "1.25rem",
            }}
          >
            <div style={{ fontWeight: 700, color: "#e2e8f0", fontSize: "0.85rem", marginBottom: "0.6rem" }}>
              Bandwidth Dashboard configuration
            </div>
            {[
              ["Application type", "Voice"],
              ["Event URL", "https://your-domain.com/bandwidth/voice   (POST)"],
              ["Answer URL", "https://your-domain.com/bandwidth/answer   (POST)"],
              ["HTTP method", "POST"],
              ["Transcription destination", "https://your-domain.com/bandwidth/voice"],
            ].map(([k, v]) => (
              <div
                key={k}
                style={{
                  display: "flex",
                  gap: "1rem",
                  padding: "0.35rem 0",
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                  fontSize: "0.82rem",
                }}
              >
                <span style={{ color: "#475569", minWidth: 180, flexShrink: 0 }}>{k}</span>
                <code style={{ color: "#94a3b8" }}>{v}</code>
              </div>
            ))}
          </div>

          <p style={{ color: "#64748b", fontSize: "0.85rem", marginBottom: "1rem", lineHeight: 1.6 }}>
            The adapter below handles <code>initiate</code>, <code>answer</code>,{" "}
            <code>transcription</code>, and <code>disconnect</code> events. It maps each to NHID's
            generic webhook format — no Bandwidth-specific parsing happens inside NHID itself.
          </p>

          <CodeBlock code={BANDWIDTH_ADAPTER} language="python" />

          <div style={{ height: "1rem" }} />

          <p style={{ color: "#64748b", fontSize: "0.85rem", marginBottom: "1rem", lineHeight: 1.6 }}>
            Pair it with a BXML answer endpoint so Bandwidth knows how to handle inbound calls
            and where to stream transcripts:
          </p>

          <CodeBlock code={BANDWIDTH_BXML} language="python" />

          <div
            style={{
              marginTop: "1.25rem",
              background: "rgba(83,216,251,0.06)",
              border: "1px solid rgba(83,216,251,0.15)",
              borderRadius: 10,
              padding: "0.9rem 1.1rem",
              display: "flex",
              gap: "0.75rem",
              alignItems: "flex-start",
            }}
          >
            <span style={{ fontSize: "1rem", flexShrink: 0, marginTop: 1 }}>📋</span>
            <div style={{ color: "#94a3b8", fontSize: "0.83rem", lineHeight: 1.6 }}>
              <strong style={{ color: CYAN }}>Other providers follow the same pattern.</strong>{" "}
              NHID natively auto-detects <strong>Retell AI</strong>, <strong>Vapi</strong>, and{" "}
              <strong>Twilio</strong> — paste their raw payloads directly into the webhook endpoints
              without an adapter. For Bandwidth and any other provider, map to the generic format
              as shown above (<code>session_id</code> = call ID, <code>transcript_text</code> = text).
            </div>
          </div>
        </div>

        {/* ── Event field reference ────────────────────────────────── */}
        <div
          style={{
            background: "rgba(255,255,255,0.025)",
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: 14,
            padding: "1.5rem",
            marginBottom: "3rem",
          }}
        >
          <h3
            style={{
              fontSize: "1rem",
              fontWeight: 700,
              color: "#e2e8f0",
              margin: "0 0 1rem",
              letterSpacing: "-0.01em",
            }}
          >
            Event field reference
          </h3>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
              <thead>
                <tr>
                  {["Field", "Type", "Required", "Description"].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: "left",
                        padding: "0.5rem 0.75rem",
                        color: "#475569",
                        fontWeight: 600,
                        borderBottom: "1px solid rgba(255,255,255,0.07)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ["event_type", "string", "✓", "AGENT_ACTION, POLICY_CHECK, VOICE_TRANSCRIPT, …"],
                  ["state_before", "string", "✓", "Agent state before this event (e.g. IDLE)"],
                  ["state_after", "string", "✓", "Agent state after this event (e.g. RUNNING)"],
                  ["input_text", "string", "", "User prompt or input that triggered the event"],
                  ["policy_action", "string", "", "allow, escalate, block, disclose"],
                  ["reason_code", "string", "", "Machine-readable reason (HUMAN_ESCALATION_REQUESTED, …)"],
                  ["response_text", "string", "", "Agent's response text"],
                  ["request_id", "string", "", "Idempotency key — auto-generated if omitted"],
                ].map(([field, type, req, desc], i) => (
                  <tr
                    key={field}
                    style={{ background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)" }}
                  >
                    <td style={{ padding: "0.55rem 0.75rem" }}>
                      <code style={{ color: CYAN, fontSize: "0.8rem" }}>{field}</code>
                    </td>
                    <td style={{ padding: "0.55rem 0.75rem", color: "#64748b" }}>{type}</td>
                    <td
                      style={{
                        padding: "0.55rem 0.75rem",
                        color: req ? TEAL : "#334155",
                        fontWeight: req ? 700 : 400,
                      }}
                    >
                      {req || "—"}
                    </td>
                    <td style={{ padding: "0.55rem 0.75rem", color: "#94a3b8", lineHeight: 1.5 }}>
                      {desc}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── CTA ──────────────────────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            gap: "1rem",
            flexWrap: "wrap",
            justifyContent: "center",
            paddingTop: "1rem",
          }}
        >
          <Link
            href="/try"
            style={{
              padding: "0.7rem 1.5rem",
              borderRadius: 10,
              background: `linear-gradient(135deg, ${TEAL}, ${CYAN})`,
              color: BG,
              fontWeight: 700,
              fontSize: "0.9rem",
              textDecoration: "none",
              boxShadow: "0 0 20px rgba(0,194,168,0.25)",
            }}
          >
            ⚡ Live demo
          </Link>
          <a
            href="/nhid_sdk.py"
            download="nhid_sdk.py"
            style={{
              padding: "0.7rem 1.5rem",
              borderRadius: 10,
              background: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "#e2e8f0",
              fontWeight: 700,
              fontSize: "0.9rem",
              textDecoration: "none",
            }}
          >
            ↓ Download Python SDK
          </a>
        </div>
      </div>
    </div>
  );
}
