import { useState, useEffect, useCallback } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import {
  Settings2, Eye, EyeOff, Copy, Check, CreditCard, Shield,
  Building2, Key, Clock, ExternalLink, AlertTriangle, CheckCircle,
  Users, Trash2, LogOut,
} from "lucide-react";
import { apiUrl } from "@/lib/config";
import { AuthError, authApi, type OrgMember } from "@/lib/auth-api";
import { useSession, useSignOut } from "@/hooks/use-session";

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

    fetch(apiUrl("/saas/orgs/me"), { headers: { "X-API-Key": key } })
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
  const badgeUrl = org?.org_id ? apiUrl(`/saas/badge/${org.org_id}`) : null;

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

      {/* People */}
      <Members apiKey={apiKey} />

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

/**
 * Who can sign in to this organization.
 *
 * This is the screen that answers "how would other people get in?" — the
 * question that exposed the hole this feature closes. Before it there was one
 * credential per organization, an API key shared by a whole compliance team,
 * and a review trail recording whatever name the client typed.
 *
 * Deliberately two operations and no more: invite, and remove. No seat counts,
 * no pending-invitation state machine, no permission matrix. An invitation that
 * has not been opened is indistinguishable here from one that has — which is
 * accurate, because the server cannot see the mailbox, and a "pending" badge
 * would be a claim about something nothing here observes.
 */
function Members({ apiKey }: { apiKey: string }) {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const signOut = useSignOut();

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"owner" | "member">("member");
  const [problem, setProblem] = useState<string | null>(null);
  const [undelivered, setUndelivered] = useState<string | null>(null);

  const members = useQuery({
    queryKey: ["org-members", apiKey],
    queryFn: () => authApi.listMembers(apiKey),
    enabled: !!apiKey && !!session,
    retry: false,
  });

  const invite = useMutation({
    mutationFn: () => authApi.invite(apiKey, email.trim(), role),
    onSuccess: (result) => {
      setEmail("");
      setProblem(null);
      // Reported, not hidden. Unlike the sign-in form — where a delivery
      // failure must stay invisible or it becomes an enumeration oracle — the
      // person here typed the address themselves, so there is nothing left to
      // protect and silence would only strand the invitee.
      setUndelivered(result.invite_delivered ? null : result.email);
      queryClient.invalidateQueries({ queryKey: ["org-members"] });
    },
    onError: (error) => setProblem(
      error instanceof AuthError ? error.message : "Could not send that invitation."),
  });

  const remove = useMutation({
    mutationFn: (userId: string) => authApi.removeMember(apiKey, userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["org-members"] }),
    onError: (error) => setProblem(
      error instanceof AuthError ? error.message : "Could not remove that member."),
  });

  if (!session) {
    return (
      <Section title="People" icon={Users}>
        <p style={{ margin: "0 0 10px", fontSize: 12.5, color: "var(--nhid-muted)", lineHeight: 1.6 }}>
          Sign in to see and manage who has access. The API key above
          authenticates this organization; a session says <em>which person</em> is
          asking — and that is what goes on a review decision.
        </p>
        <Link href="/signin" style={{ fontSize: 12, fontWeight: 700,
                                      color: "var(--nhid-teal)", textDecoration: "none" }}>
          Sign in →
        </Link>
      </Section>
    );
  }

  const isOwner = members.data?.your_role === "owner";

  return (
    <Section title="People" icon={Users}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                    gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <span style={{ fontSize: 12.5, color: "var(--nhid-muted)" }}>
          Signed in as <strong style={{ color: "var(--nhid-text)" }}>{session.user.email}</strong>
          {members.data ? ` · ${members.data.your_role}` : ""}
        </span>
        <button
          onClick={() => signOut.mutate()}
          disabled={signOut.isPending}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none",
                   border: "1px solid var(--nhid-border)", borderRadius: 8, cursor: "pointer",
                   color: "var(--nhid-muted)", fontSize: 11, padding: "5px 10px" }}
        >
          <LogOut size={12} /> Sign out
        </button>
      </div>

      {members.isError && (
        <p style={{ fontSize: 12, color: "#ef4444", margin: "0 0 10px", lineHeight: 1.55 }}>
          Could not load the member list — your session may belong to a different
          organization than this API key.
        </p>
      )}

      {(members.data?.members ?? []).map((m: OrgMember) => (
        <Row key={m.user_id} label={m.role === "owner" ? "Owner" : "Member"}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end" }}>
            <span style={{ fontSize: 12.5, color: "var(--nhid-text)", wordBreak: "break-all" }}>
              {m.email}
            </span>
            {isOwner && m.user_id !== session.user.user_id && (
              <button
                onClick={() => { setProblem(null); remove.mutate(m.user_id); }}
                disabled={remove.isPending}
                title={`Remove ${m.email}`}
                style={{ background: "none", border: "none", cursor: "pointer",
                         color: "var(--nhid-muted)", padding: "2px 4px", flexShrink: 0 }}
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        </Row>
      ))}

      {isOwner && (
        <form
          onSubmit={(e) => { e.preventDefault(); setProblem(null); if (email.trim()) invite.mutate(); }}
          style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}
        >
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="colleague@payer.example"
            style={{ flex: "1 1 200px", minWidth: 0, fontSize: 12.5, padding: "7px 10px",
                     borderRadius: 8, border: "1px solid var(--nhid-border)",
                     background: "rgba(0,0,0,0.2)", color: "var(--nhid-text)" }}
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "owner" | "member")}
            style={{ fontSize: 12.5, padding: "7px 10px", borderRadius: 8,
                     border: "1px solid var(--nhid-border)",
                     background: "rgba(0,0,0,0.2)", color: "var(--nhid-text)" }}
          >
            <option value="member">Member</option>
            <option value="owner">Owner</option>
          </select>
          <button type="submit" disabled={invite.isPending || !email.trim()}
                  style={{ fontSize: 12, fontWeight: 700, padding: "7px 14px", borderRadius: 8,
                           border: "none", cursor: "pointer",
                           background: "var(--nhid-teal)", color: "#04231f" }}>
            {invite.isPending ? "Inviting…" : "Invite"}
          </button>
        </form>
      )}

      {problem && <p style={{ fontSize: 12, color: "#ef4444", margin: "10px 0 0" }}>{problem}</p>}
      {undelivered && (
        <p style={{ fontSize: 12, color: "#f59e0b", margin: "10px 0 0", lineHeight: 1.55 }}>
          <strong>{undelivered}</strong> now has access, but the invitation email
          could not be sent. They can request a link themselves from the sign-in
          page.
        </p>
      )}

      <p style={{ fontSize: 11.5, color: "var(--nhid-muted)", margin: "14px 0 0", lineHeight: 1.6 }}>
        Members sign in with a link to their own mailbox — no passwords, and no
        self-service sign-up. The API key stays what pipelines and scripts use;
        it is not a person, and a review it performs is recorded as an
        unattributed machine action rather than as a nameless reviewer.
      </p>
    </Section>
  );
}
