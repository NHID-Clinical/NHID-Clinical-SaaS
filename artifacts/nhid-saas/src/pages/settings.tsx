import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import {
  Settings2, Eye, EyeOff, Copy, Check, CreditCard, Shield,
  Building2, Key, Clock, ExternalLink, AlertTriangle, CheckCircle,
} from "lucide-react";

interface OrgDetails {
  org_id: string;
  org_name: string;
  plan: string;
  status: string;
  billing_active: boolean;
  usage_count: number;
  rate_limit: number;
  plan_details?: {
    name: string;
    daily_limit: number | null;
    features: string[];
  };
  voice_session_ttl_hours?: number | null;
}

const PLAN_COLORS: Record<string, string> = {
  free: "#64748b",
  l1: "#00c2a8",
  l2: "#53d8fb",
  l3: "#a78bfa",
};

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  l1: "NHID L1",
  l2: "NHID L2",
  l3: "NHID L3",
};

function Section({ title, icon: Icon, children }: { title: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div style={{
      background: "var(--nhid-surface)", border: "1px solid var(--nhid-border)",
      borderRadius: 14, padding: "22px 22px", marginBottom: 20,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 18 }}>
        <Icon size={15} style={{ color: "var(--nhid-teal)", flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--nhid-text)", letterSpacing: "-0.01em" }}>
          {title}
        </span>
      </div>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between",
      gap: 16, marginBottom: 14,
      flexWrap: "wrap",
    }}>
      <span style={{ fontSize: 12, color: "var(--nhid-muted)", flexShrink: 0, minWidth: 120 }}>{label}</span>
      <div style={{ flex: 1, minWidth: 0, display: "flex", justifyContent: "flex-end" }}>
        {children}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [org, setOrg] = useState<OrgDetails | null>(null);
  const [apiKey, setApiKey] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedOrgId, setCopiedOrgId] = useState(false);
  const [badgeError, setBadgeError] = useState(false);

  useEffect(() => {
    const key = localStorage.getItem("nhid_api_key") ?? "";
    setApiKey(key);
    if (!key) { setLoading(false); return; }

    fetch("/saas-api/saas/orgs/me", { headers: { "X-API-Key": key } })
      .then(r => r.json())
      .then(data => setOrg(data))
      .catch(() => {
        // Fallback to localStorage
        try {
          const stored = localStorage.getItem("nhid_org");
          if (stored) setOrg(JSON.parse(stored));
        } catch { /* ignore */ }
      })
      .finally(() => setLoading(false));
  }, []);

  const copyKey = useCallback(async () => {
    if (!apiKey) return;
    await navigator.clipboard.writeText(apiKey).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [apiKey]);

  const copyOrgId = useCallback(async () => {
    if (!org?.org_id) return;
    await navigator.clipboard.writeText(org.org_id).catch(() => {});
    setCopiedOrgId(true);
    setTimeout(() => setCopiedOrgId(false), 2000);
  }, [org?.org_id]);

  const maskedKey = apiKey
    ? `nhid_${"•".repeat(Math.max(0, apiKey.length - 10))}${apiKey.slice(-6)}`
    : "";

  const planKey = (org?.plan ?? "free").toLowerCase();
  const planColor = PLAN_COLORS[planKey] ?? "#64748b";
  const planLabel = PLAN_LABELS[planKey] ?? planKey.toUpperCase();
  const isPaid = planKey !== "free";
  const badgeUrl = org?.org_id ? `/saas-api/saas/badge/${org.org_id}` : null;

  if (loading) {
    return (
      <div style={{ maxWidth: 640, margin: "0 auto", padding: "60px 0", display: "flex", justifyContent: "center" }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: "linear-gradient(135deg, #00c2a8, #53d8fb)",
          animation: "pulse 1.5s ease-in-out infinite",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: "'Raleway', sans-serif", fontWeight: 900, fontSize: 14, color: "#070c17",
        }}>N</div>
        <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      {/* Page header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <Settings2 size={18} style={{ color: "var(--nhid-teal)" }} />
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "var(--nhid-text)", letterSpacing: "-0.02em" }}>
            Settings
          </h1>
        </div>
        <p style={{ margin: 0, fontSize: 12, color: "var(--nhid-muted)" }}>
          Manage your workspace, API credentials, and plan.
        </p>
      </div>

      {/* Org info */}
      <Section title="Organization" icon={Building2}>
        <Row label="Name">
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--nhid-text)" }}>
            {org?.org_name ?? "—"}
          </span>
        </Row>
        <Row label="Org ID">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <code style={{ fontSize: 11, fontFamily: "monospace", color: "var(--nhid-muted)", wordBreak: "break-all" }}>
              {org?.org_id ?? "—"}
            </code>
            {org?.org_id && (
              <button
                onClick={copyOrgId}
                title="Copy org ID"
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: copiedOrgId ? "var(--nhid-teal)" : "var(--nhid-muted)",
                  padding: "2px 4px", flexShrink: 0,
                }}
              >
                {copiedOrgId ? <Check size={12} /> : <Copy size={12} />}
              </button>
            )}
          </div>
        </Row>
        <Row label="Status">
          <span style={{
            fontSize: 11, fontWeight: 700,
            color: org?.status === "active" ? "var(--nhid-teal)" : "#ef4444",
            background: org?.status === "active" ? "rgba(0,194,168,0.1)" : "rgba(239,68,68,0.1)",
            border: `1px solid ${org?.status === "active" ? "rgba(0,194,168,0.25)" : "rgba(239,68,68,0.25)"}`,
            borderRadius: 20, padding: "3px 10px", textTransform: "uppercase", letterSpacing: "0.08em",
          }}>
            {org?.status ?? "—"}
          </span>
        </Row>
      </Section>

      {/* API Key */}
      <Section title="API Key" icon={Key}>
        <div style={{
          background: "rgba(0,0,0,0.2)", border: "1px solid var(--nhid-border)",
          borderRadius: 10, padding: "12px 14px", marginBottom: 12,
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
          flexWrap: "wrap",
        }}>
          <code style={{
            fontFamily: "monospace", fontSize: 12,
            color: "var(--nhid-teal)", letterSpacing: "0.02em",
            wordBreak: "break-all", flex: 1,
            filter: revealed ? "none" : "blur(4px)",
            transition: "filter 0.2s",
            userSelect: revealed ? "text" : "none",
          }}>
            {revealed ? apiKey : maskedKey}
          </code>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button
              onClick={() => setRevealed(v => !v)}
              title={revealed ? "Hide key" : "Reveal key"}
              style={{
                background: "rgba(255,255,255,0.05)", border: "1px solid var(--nhid-border)",
                borderRadius: 7, padding: "6px 8px", cursor: "pointer",
                color: "var(--nhid-muted)", display: "flex", alignItems: "center",
              }}
            >
              {revealed ? <EyeOff size={13} /> : <Eye size={13} />}
            </button>
            <button
              onClick={copyKey}
              title="Copy API key"
              style={{
                background: copied ? "rgba(0,194,168,0.15)" : "rgba(255,255,255,0.05)",
                border: `1px solid ${copied ? "rgba(0,194,168,0.3)" : "var(--nhid-border)"}`,
                borderRadius: 7, padding: "6px 8px", cursor: "pointer",
                color: copied ? "var(--nhid-teal)" : "var(--nhid-muted)",
                display: "flex", alignItems: "center", gap: 4,
                fontSize: 11, fontWeight: 600,
                transition: "all 0.15s",
              }}
            >
              {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
            </button>
          </div>
        </div>
        <div style={{
          display: "flex", alignItems: "flex-start", gap: 8,
          background: "rgba(234,179,8,0.06)", border: "1px solid rgba(234,179,8,0.2)",
          borderRadius: 8, padding: "9px 12px",
        }}>
          <AlertTriangle size={12} style={{ color: "#eab308", marginTop: 1, flexShrink: 0 }} />
          <p style={{ margin: 0, fontSize: 11, color: "#a16207", lineHeight: 1.5 }}>
            Keep your API key private. It grants full access to your org's audit trail and billing.
            If compromised, contact support to rotate it.
          </p>
        </div>
      </Section>

      {/* Plan */}
      <Section title="Current Plan" icon={CreditCard}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 14, gap: 12, flexWrap: "wrap",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              background: `${planColor}18`, border: `1px solid ${planColor}30`,
              borderRadius: 8, padding: "6px 12px",
              fontSize: 13, fontWeight: 800, color: planColor,
              letterSpacing: "0.02em",
            }}>
              {planLabel}
            </div>
            {org?.billing_active && (
              <span style={{ fontSize: 10, color: "var(--nhid-teal)", fontWeight: 700 }}>
                <CheckCircle size={10} style={{ display: "inline", verticalAlign: "middle", marginRight: 3 }} />
                Active
              </span>
            )}
          </div>
          <Link href="/billing" style={{
            display: "flex", alignItems: "center", gap: 5,
            fontSize: 12, fontWeight: 700, color: "var(--nhid-teal)",
            textDecoration: "none",
          }}>
            {planKey === "free" ? "Upgrade" : "Manage"} <ExternalLink size={11} />
          </Link>
        </div>
        {org?.plan_details && (
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 9, color: "var(--nhid-muted)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600, marginBottom: 3 }}>
                Daily Limit
              </div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "var(--nhid-text)" }}>
                {org.plan_details.daily_limit != null
                  ? org.plan_details.daily_limit.toLocaleString()
                  : "Unlimited"}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: "var(--nhid-muted)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600, marginBottom: 3 }}>
                Rate Limit
              </div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "var(--nhid-text)" }}>
                {org.rate_limit ?? "—"} req/min
              </div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: "var(--nhid-muted)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600, marginBottom: 3 }}>
                Total API Calls
              </div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "var(--nhid-text)" }}>
                {(org.usage_count ?? 0).toLocaleString()}
              </div>
            </div>
          </div>
        )}
      </Section>

      {/* Voice session TTL */}
      <Section title="Voice Sessions" icon={Clock}>
        <Row label="Session retention">
          <span style={{ fontSize: 12, color: "var(--nhid-text)", fontWeight: 600 }}>
            {org?.voice_session_ttl_hours != null
              ? `${org.voice_session_ttl_hours}h (custom)`
              : "24h (default)"}
          </span>
        </Row>
        <p style={{ margin: 0, fontSize: 11, color: "var(--nhid-muted)", lineHeight: 1.6 }}>
          Voice sessions are automatically purged after the retention window.
          Contact your admin to configure a custom TTL (4h / 24h / 72h / 168h).
        </p>
      </Section>

      {/* Compliance badge */}
      <Section title="Compliance Badge" icon={Shield}>
        {isPaid && badgeUrl && !badgeError ? (
          <>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, color: "var(--nhid-muted)", marginBottom: 8 }}>Live preview</div>
              <img
                src={badgeUrl}
                alt="NHID Compliance Badge"
                style={{ height: 28, display: "block" }}
                onError={() => setBadgeError(true)}
              />
            </div>
            <div style={{ fontSize: 11, color: "var(--nhid-muted)", marginBottom: 6, fontWeight: 600 }}>
              Embed code
            </div>
            <div style={{
              background: "rgba(0,0,0,0.25)", border: "1px solid var(--nhid-border)",
              borderRadius: 8, padding: "10px 12px",
            }}>
              <code style={{ fontFamily: "monospace", fontSize: 10, color: "var(--nhid-teal)", wordBreak: "break-all" }}>
                {`<img src="https://your-host/saas/badge/${org?.org_id}" alt="NHID Verified" />`}
              </code>
            </div>
            <p style={{ margin: "10px 0 0", fontSize: 11, color: "var(--nhid-muted)" }}>
              The badge is public and updates in real time. Embed it in your documentation or website.
            </p>
          </>
        ) : (
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.1)",
            borderRadius: 10, padding: "18px 16px",
          }}>
            <Shield size={20} style={{ color: "#334155", flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: "var(--nhid-muted)", marginBottom: 4 }}>
                Badge available on paid plans
              </div>
              <div style={{ fontSize: 11, color: "#334155", lineHeight: 1.5 }}>
                Upgrade to L1, L2, or L3 to get a dynamic compliance badge you can embed in your docs.
              </div>
              <Link href="/billing" style={{ fontSize: 11, color: "var(--nhid-teal)", textDecoration: "none", fontWeight: 700, marginTop: 6, display: "inline-block" }}>
                View plans →
              </Link>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}
