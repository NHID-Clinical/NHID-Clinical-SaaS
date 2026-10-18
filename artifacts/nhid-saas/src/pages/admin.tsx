import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { LogOut, RefreshCw, Eye, EyeOff, Users, Activity, AlertCircle, Lock, PhoneCall } from "lucide-react";
import { API_BASE_URL, API_CONNECTED } from "@/lib/config";
import { Link } from "wouter";
import { EntryShell, NotConnected } from "@/components/entry-shell";
import { Metric, OPS_CSS } from "./ops/ops-ui";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AdminOrg {
  org_id: string;
  org_name: string;
  api_key_prefix: string | null;
  plan: string;
  status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  created_at: string;
  usage_count: number;
  active: number;
  today_requests: number;
  total_requests: number;
  voice_session_ttl_hours: number | null;
}

interface GlobalStats {
  total_orgs: number;
  total_requests: number;
  orgs_by_plan: Record<string, number>;
}

interface ActivityRow {
  id: number;
  org_id: string;
  org_name?: string;
  endpoint: string;
  method: string;
  status_code: number | null;
  session_id: string | null;
  timestamp: string;
}

interface VoiceSession {
  session_id: string;
  org_id: string;
  disclosure_confirmed: boolean;
  escalated: boolean;
  created_at: string;
  provider: string;
  age_hours: number;
  hours_until_purge: number;
}

// ── Admin API ─────────────────────────────────────────────────────────────────

const ADMIN_BASE = `${API_BASE_URL}/admin`;

async function adminFetch<T>(path: string, token: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${ADMIN_BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "X-Admin-Session": token,
      ...(opts.headers as Record<string, string> ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: res.statusText }));
    // Prefix with HTTP status so callers can match precisely (e.g. "401: …")
    throw new Error(`${res.status}: ${body.detail ?? res.statusText}`);
  }
  return res.json();
}

async function adminLogin(username: string, password: string): Promise<string> {
  const res = await fetch(`${ADMIN_BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: "Access denied" }));
    throw new Error(body.detail ?? "Access denied");
  }
  const data = await res.json();
  return data.admin_session_token as string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 5;
const COOLDOWN_SECONDS = 30;

function fmt(ts: string) {
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}
function fmtHours(h: number): string {
  if (h <= 0) return "< 1m";
  if (h < 1) return `${Math.round(h * 60)}m`;
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  if (h < 24) return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
  const days = Math.floor(h / 24);
  const remHrs = Math.floor(h % 24);
  return remHrs > 0 ? `${days}d ${remHrs}h` : `${days}d`;
}
// ── Login Form ────────────────────────────────────────────────────────────────

function LoginForm({ onLogin }: { onLogin: (token: string) => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const locked = cooldownLeft > 0;

  useEffect(() => {
    return () => { if (cooldownRef.current) clearInterval(cooldownRef.current); };
  }, []);

  const startCooldown = () => {
    setCooldownLeft(COOLDOWN_SECONDS);
    cooldownRef.current = setInterval(() => {
      setCooldownLeft(s => {
        if (s <= 1) {
          clearInterval(cooldownRef.current!);
          setAttempts(0);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (locked || loading) return;
    setError("");
    setLoading(true);
    try {
      /* A brief pause so the form does not flicker between submit and result.
         This is not the protection against guessing -- it is client-side, and a
         caller that is not a browser simply skips it. The control is the
         per-IP throttle on POST /admin/login (saas_layer/auth.py). Same for the
         MAX_ATTEMPTS counter below: useful feedback, not a barrier. */
      await new Promise(res => setTimeout(res, 1200 + Math.random() * 400));
      const token = await adminLogin(username, password);
      localStorage.setItem("nhid_admin_token", token);
      onLogin(token);
    } catch {
      const next = attempts + 1;
      setAttempts(next);
      if (next >= MAX_ATTEMPTS) {
        setError(`Too many failed attempts. Try again in ${COOLDOWN_SECONDS} seconds.`);
        startCooldown();
      } else {
        setError(`Access denied. ${MAX_ATTEMPTS - next} attempt${MAX_ATTEMPTS - next !== 1 ? "s" : ""} remaining.`);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <EntryShell single>
      <div className="card entry-card">
        <div className="body">
          <div className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Lock size={11} aria-hidden="true" /> Platform administrators only
          </div>
          <h2>Operations console</h2>
          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
            Sign in with the administrator credentials configured on the server
            (<code>ADMIN_USER</code> and <code>ADMIN_PASS_HASH</code>). Organizations do not
            sign in here.
          </p>
          {!API_CONNECTED ? (
            <NotConnected what="the operations console" />
          ) : (
            <form onSubmit={submit} noValidate>
              <div className="field">
                <label htmlFor="admin-user">Username</label>
                <input id="admin-user" value={username} onChange={e => setUsername(e.target.value)}
                       autoComplete="username" required disabled={locked || loading} />
              </div>
              <div className="field">
                <label htmlFor="admin-pass">Password</label>
                <div style={{ position: "relative" }}>
                  <input id="admin-pass" type={showPw ? "text" : "password"} value={password}
                         onChange={e => setPassword(e.target.value)} autoComplete="current-password"
                         required disabled={locked || loading} style={{ paddingRight: 44 }} />
                  <button type="button" onClick={() => setShowPw(s => !s)}
                          aria-label={showPw ? "Hide password" : "Show password"}
                          style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)",
                                   border: 0, background: "transparent", minHeight: 30, padding: "4px 8px" }}>
                    {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              {error && (
                <div className="notice" role="alert" style={{ marginTop: 14, marginBottom: 0, display: "flex", gap: 8,
                     background: "var(--ops-exception-soft)", borderColor: "#f1d0cd", borderLeftColor: "var(--ops-exception)",
                     color: "var(--ops-exception)" }}>
                  <AlertCircle size={14} style={{ marginTop: 2, flexShrink: 0 }} aria-hidden="true" />
                  <span>{error}{locked && ` Retry in ${cooldownLeft}s.`}</span>
                </div>
              )}
              <button type="submit" className="primary block" disabled={loading || locked}>
                {locked ? `Locked — ${cooldownLeft}s` : loading ? "Authenticating…" : "Sign in"}
              </button>
            </form>
          )}
        </div>
        <div className="alt">
          <p>Failed attempts are rate-limited by the server and written to the application log.</p>
          <p>Looking for your organization&apos;s workspace? <Link href="/">Go to the sign-in page</Link>.</p>
        </div>
      </div>
    </EntryShell>
  );
}

// ── Admin Dashboard ────────────────────────────────────────────────────────────

const CONSOLE_CSS = `
.console-bar { display: flex; align-items: center; gap: 12px; height: 52px; padding: 0 24px; background: #102a43; color: #fff; position: sticky; top: 0; z-index: 20; }
.console-bar .mark { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 6px; background: #1769aa; font-weight: 800; font-size: 14px; }
.console-bar .title { font-weight: 650; }
.console-bar .tag { font-size: 10px; font-weight: 750; letter-spacing: .1em; text-transform: uppercase; padding: 2px 8px; border-radius: 4px; background: rgba(255,255,255,.12); color: #d9e2ec; }
.console-bar .right { margin-left: auto; display: flex; gap: 8px; }
.ops .console-bar button { display: inline-flex; align-items: center; gap: 6px; background: transparent; color: #d9e2ec; border-color: rgba(255,255,255,.25); }
.ops .console-bar button:hover:not(:disabled) { background: rgba(255,255,255,.08); border-color: rgba(255,255,255,.4); color: #fff; }
.console-body { max-width: 1280px; margin: 0 auto; padding: clamp(16px, 2.4vw, 28px); }
.ops .tab-count { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 10px; background: #eef2f6; color: #526579; font-size: 10px; font-weight: 700; }
.ops .card-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: -18px -20px 14px; padding: 13px 20px; border-bottom: 1px solid var(--ops-border); }
.ops .card-head h2 { margin: 0; }
.ops .card-head .meta { margin-left: auto; color: var(--ops-muted); font-size: 12px; display: flex; gap: 10px; align-items: center; }
.ops .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; }
.ops tr.escalated td { background: #fff7f6; } .ops tr.escalated td:first-child { box-shadow: inset 3px 0 0 var(--ops-exception); }
.ops button.danger { color: var(--ops-exception); border-color: #f1d0cd; }
.ops button.danger.confirm { background: var(--ops-exception); border-color: var(--ops-exception); color: #fff; }
.ops td button { min-height: 28px; padding: 4px 10px; font-size: 11.5px; }
.ops td select { min-height: 30px; padding: 4px 8px; font-size: 12px; }
.ops .spin { animation: spin 1s linear infinite; } @keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 720px) { .console-bar .tag, .console-bar .label { display: none; } .console-bar { padding: 0 12px; } .console-bar .title { font-size: 13.5px; } }
`;

const PLAN_PILL: Record<string, string> = { free: "pill-neutral", l1: "pill-blue", l2: "pill-blue", l3: "pill-blue" };
const STATUS_PILL: Record<string, string> = { active: "pill-pass", canceled: "pill-exception", past_due: "pill-unknown" };

function AdminDashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [orgs, setOrgs] = useState<AdminOrg[]>([]);
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [voiceSessions, setVoiceSessions] = useState<VoiceSession[]>([]);
  const [voiceEscalatedCount, setVoiceEscalatedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"orgs" | "activity" | "voice">("orgs");
  const [search, setSearch] = useState("");
  const [voiceOrgFilter, setVoiceOrgFilter] = useState("");
  const [voiceStatusFilter, setVoiceStatusFilter] = useState<"all" | "escalated" | "undisclosed">("all");
  const [voiceActionLoading, setVoiceActionLoading] = useState<Record<string, "extend" | "delete" | "confirm-delete">>({});
  const [retentionLoading, setRetentionLoading] = useState<Record<string, boolean>>({});

  const fetchVoiceSessions = useCallback(async (
    filter: "all" | "escalated" | "undisclosed",
    orgId?: string,
  ) => {
    const qs = new URLSearchParams({ limit: "200" });
    if (filter === "escalated") qs.set("escalated_only", "true");
    if (filter === "undisclosed") qs.set("undisclosed_only", "true");
    if (orgId?.trim()) qs.set("org_id", orgId.trim());
    const d = await adminFetch<{ sessions: VoiceSession[]; escalated_count: number }>(
      `/voice/sessions?${qs}`, token
    );
    setVoiceSessions(d.sessions);
    setVoiceEscalatedCount(d.escalated_count);
  }, [token]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [orgsData, usageData] = await Promise.all([
        adminFetch<{ orgs: AdminOrg[]; global_stats: GlobalStats }>("/orgs", token),
        adminFetch<{ recent_activity: ActivityRow[]; global_stats: GlobalStats }>("/usage", token),
      ]);
      setOrgs(orgsData.orgs);
      setStats(orgsData.global_stats);
      setActivity(usageData.recent_activity);
      await fetchVoiceSessions("all");
    } catch (err: any) {
      if (err.message?.startsWith("401:")) {
        onLogout();
        return;
      }
      setError(err.message ?? "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [token, onLogout, fetchVoiceSessions]);

  useEffect(() => { load(); }, [load]);

  const isMounted = useRef(false);
  useEffect(() => {
    if (!isMounted.current) { isMounted.current = true; return; }
    fetchVoiceSessions(voiceStatusFilter).catch(() => {});
  }, [voiceStatusFilter, fetchVoiceSessions]);

  const handleExtend = useCallback(async (sid: string) => {
    setVoiceActionLoading(p => ({ ...p, [sid]: "extend" }));
    try {
      const updated = await adminFetch<VoiceSession>(`/voice/sessions/${sid}/extend`, token, { method: "POST" });
      setVoiceSessions(prev => prev.map(s => s.session_id === sid ? updated : s));
    } catch (err: any) {
      setError(err.message ?? "Failed to extend session");
    } finally {
      setVoiceActionLoading(p => { const n = { ...p }; delete n[sid]; return n; });
    }
  }, [token]);

  const handleForceDelete = useCallback((sid: string) => {
    const state = voiceActionLoading[sid];
    if (state !== "confirm-delete") {
      setVoiceActionLoading(p => ({ ...p, [sid]: "confirm-delete" }));
      setTimeout(() => {
        setVoiceActionLoading(p => {
          if (p[sid] === "confirm-delete") { const n = { ...p }; delete n[sid]; return n; }
          return p;
        });
      }, 4000);
      return;
    }
    setVoiceActionLoading(p => ({ ...p, [sid]: "delete" }));
    const wasEscalated = voiceSessions.find(s => s.session_id === sid)?.escalated ?? false;
    adminFetch(`/voice/sessions/${sid}`, token, { method: "DELETE" })
      .then(() => {
        setVoiceSessions(prev => prev.filter(s => s.session_id !== sid));
        if (wasEscalated) setVoiceEscalatedCount(prev => Math.max(0, prev - 1));
      })
      .catch((err: any) => setError(err.message ?? "Failed to delete session"))
      .finally(() => setVoiceActionLoading(p => { const n = { ...p }; delete n[sid]; return n; }));
  }, [token, voiceActionLoading, voiceSessions]);

  const handleSetRetention = useCallback(async (orgId: string, hours: number | null) => {
    setRetentionLoading(p => ({ ...p, [orgId]: true }));
    try {
      await adminFetch(`/orgs/${orgId}/session-retention`, token, {
        method: "PATCH",
        body: JSON.stringify({ voice_session_ttl_hours: hours }),
      });
      setOrgs(prev => prev.map(o =>
        o.org_id === orgId ? { ...o, voice_session_ttl_hours: hours } : o
      ));
    } catch (err: any) {
      setError(err.message ?? "Failed to update session retention");
    } finally {
      setRetentionLoading(p => { const n = { ...p }; delete n[orgId]; return n; });
    }
  }, [token]);

  const filteredOrgs = orgs.filter(o =>
    search === "" ||
    o.org_name.toLowerCase().includes(search.toLowerCase()) ||
    o.org_id.toLowerCase().includes(search.toLowerCase()) ||
    o.plan.toLowerCase().includes(search.toLowerCase())
  );

  const tabs: [typeof tab, string, number, React.ReactNode][] = [
    ["orgs", "Organizations", orgs.length, <Users size={13} aria-hidden="true" />],
    ["activity", "Recent activity", activity.length, <Activity size={13} aria-hidden="true" />],
    ["voice", "Voice sessions", voiceSessions.length, <PhoneCall size={13} aria-hidden="true" />],
  ];

  return (
    <div className="ops" style={{ padding: 0, minHeight: "100dvh" }}>
      <style>{OPS_CSS}{CONSOLE_CSS}</style>
      <header className="console-bar">
        <span className="mark" aria-hidden="true">N</span>
        <span className="title">Operations console</span>
        <span className="tag">Internal</span>
        <div className="right">
          <button type="button" onClick={load} disabled={loading} aria-label="Refresh">
            <RefreshCw size={12} className={loading ? "spin" : undefined} aria-hidden="true" /> <span className="label">Refresh</span>
          </button>
          <button type="button" onClick={onLogout} aria-label="Sign out"><LogOut size={12} aria-hidden="true" /> <span className="label">Sign out</span></button>
        </div>
      </header>

      <div className="console-body">
        <div className="page-head">
          <div className="page-head-copy">
            <div className="eyebrow">NHID Clinical / Platform administration</div>
            <h1>Organizations and activity</h1>
            <div className="sub">Every organization on the platform, its plan and usage, recent API activity, and live voice sessions awaiting purge.</div>
          </div>
        </div>

        {error && (
          <div className="notice" role="alert" style={{ display: "flex", gap: 8, alignItems: "flex-start",
               background: "var(--ops-exception-soft)", borderColor: "#f1d0cd", borderLeftColor: "var(--ops-exception)", color: "var(--ops-exception)" }}>
            <AlertCircle size={14} style={{ marginTop: 2, flexShrink: 0 }} aria-hidden="true" /> <span>{error}</span>
          </div>
        )}

        {stats && (
          <div className="grid" style={{ marginBottom: 18 }}>
            <Metric label="Organizations" value={stats.total_orgs} />
            <Metric label="API requests, all time" value={stats.total_requests.toLocaleString()} />
            <Metric label="Organizations by plan"
              value={<span style={{ fontSize: 15, display: "flex", gap: 12, flexWrap: "wrap" }}>
                {Object.entries(stats.orgs_by_plan).map(([plan, count]) => (
                  <span key={plan}><span className="muted" style={{ fontSize: 11, fontWeight: 650 }}>{plan.toUpperCase()}</span> {count}</span>
                ))}
              </span>}
              denominator={`of ${stats.total_orgs}`} />
            <Metric label="Voice sessions needing handoff" value={voiceEscalatedCount}
              denominator={`of ${voiceSessions.length} live sessions`} />
          </div>
        )}

        <nav className="nav" aria-label="Console sections">
          {tabs.map(([id, label, count, icon]) => (
            <a key={id} href={`#${id}`} className={tab === id ? "active" : ""} aria-current={tab === id ? "page" : undefined}
               onClick={(e) => { e.preventDefault(); setTab(id); }} style={{ gap: 6 }}>
              {icon}{label}<span className="tab-count">{count}</span>
            </a>
          ))}
        </nav>

        {tab === "orgs" && (
          <div className="card">
            <div className="card-head">
              <h2>All organizations</h2>
              <div className="meta">
                <input value={search} onChange={e => setSearch(e.target.value)} aria-label="Search organizations"
                       placeholder="Search by name, ID or plan" style={{ width: 240 }} />
                <span>{filteredOrgs.length}{filteredOrgs.length !== orgs.length ? ` of ${orgs.length}` : ""}</span>
              </div>
            </div>
            {loading ? (
              <div className="empty">Loading…</div>
            ) : filteredOrgs.length === 0 ? (
              <div className="empty">{search ? "No organizations match your search." : "No organizations yet. They appear here as soon as someone creates a workspace."}</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Organization</th><th>Plan</th><th>Status</th><th>Total requests</th><th>Today</th>
                      <th>Session retention</th><th>API key</th><th>Stripe subscription</th><th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrgs.map((org) => (
                      <tr key={org.org_id}>
                        <td>
                          <div style={{ fontWeight: 650 }}>{org.org_name}</div>
                          <div className="mono muted">{org.org_id.slice(0, 8)}…</div>
                        </td>
                        <td><span className={`pill ${PLAN_PILL[org.plan] ?? "pill-neutral"}`}>{org.plan.toUpperCase()}</span></td>
                        <td><span className={`pill ${STATUS_PILL[org.status] ?? "pill-neutral"}`}>{org.status.replace("_", " ")}</span></td>
                        <td style={{ fontWeight: 650 }}>{org.total_requests.toLocaleString()}</td>
                        <td>{org.today_requests}</td>
                        <td>
                          <select
                            value={org.voice_session_ttl_hours ?? ""}
                            disabled={!!retentionLoading[org.org_id]}
                            aria-label={`Voice session retention for ${org.org_name}`}
                            onChange={e => {
                              const val = e.target.value;
                              handleSetRetention(org.org_id, val === "" ? null : Number(val));
                            }}
                          >
                            <option value="">Default (24h)</option>
                            <option value="4">4h</option>
                            <option value="24">24h</option>
                            <option value="72">72h</option>
                            <option value="168">7d</option>
                          </select>
                        </td>
                        {/* The key prefix, and only the prefix. There is no reveal
                            control because there is nothing to reveal: the server
                            stores a SHA-256 and this short non-secret fragment, and
                            drops the plaintext at creation. A toggle here would imply
                            the server holds a key it deliberately does not. */}
                        <td><code className="mono">{org.api_key_prefix ? `${org.api_key_prefix}…` : "—"}</code></td>
                        <td className="mono muted">{org.stripe_subscription_id ? org.stripe_subscription_id.slice(0, 14) + "…" : "—"}</td>
                        <td className="muted" style={{ whiteSpace: "nowrap" }}>{fmt(org.created_at).split(",")[0]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {tab === "voice" && (() => {
          const filtered = voiceOrgFilter.trim()
            ? voiceSessions.filter(s => s.org_id.toLowerCase().includes(voiceOrgFilter.trim().toLowerCase()))
            : voiceSessions;
          const labels = { all: "All", escalated: "Escalated only", undisclosed: "Not yet disclosed" };
          return (
            <div className="card">
              <div className="card-head">
                <h2>Session expiry monitor</h2>
                <div className="meta">
                  {voiceEscalatedCount > 0 && <span className="pill pill-exception">{voiceEscalatedCount} need handoff</span>}
                  <span>{filtered.length}{filtered.length !== voiceSessions.length ? ` of ${voiceSessions.length}` : ""} sessions</span>
                </div>
              </div>
              <div className="toolbar">
                <input value={voiceOrgFilter} onChange={e => setVoiceOrgFilter(e.target.value)}
                       placeholder="Filter by organization ID" aria-label="Filter by organization ID" style={{ minWidth: 220 }} />
                {(["all", "escalated", "undisclosed"] as const).map(f => (
                  <button key={f} type="button" onClick={() => setVoiceStatusFilter(f)} aria-pressed={voiceStatusFilter === f}
                          className={voiceStatusFilter === f ? "primary" : undefined}>
                    {labels[f]}
                  </button>
                ))}
              </div>
              {loading ? (
                <div className="empty">Loading…</div>
              ) : filtered.length === 0 ? (
                <div className="empty">{voiceOrgFilter || voiceStatusFilter !== "all" ? "No sessions match the active filters." : "No voice sessions recorded yet."}</div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Session</th><th>Organization</th><th>Provider</th><th>Disclosure</th>
                        <th>Escalated</th><th>Age</th><th>Purged in</th><th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((s) => {
                        const actionState = voiceActionLoading[s.session_id];
                        const soon = s.hours_until_purge < 6;
                        return (
                          <tr key={s.session_id} className={s.escalated ? "escalated" : undefined}>
                            <td className="mono">{s.session_id.slice(0, 8)}…{s.session_id.slice(-4)}</td>
                            <td className="mono muted">{s.org_id.slice(0, 12)}…</td>
                            <td><span className="pill pill-neutral">{s.provider}</span></td>
                            <td>{s.disclosure_confirmed
                              ? <span className="pill pill-pass">Confirmed</span>
                              : <span className="pill pill-unknown">Pending</span>}</td>
                            <td>{s.escalated ? <span className="pill pill-exception">Escalated</span> : <span className="muted">—</span>}</td>
                            <td className="muted" style={{ whiteSpace: "nowrap" }}>{fmtHours(s.age_hours)} ago</td>
                            <td style={{ whiteSpace: "nowrap" }}>
                              {soon ? <span className="pill pill-unknown">{fmtHours(s.hours_until_purge)}</span> : fmtHours(s.hours_until_purge)}
                            </td>
                            <td style={{ whiteSpace: "nowrap" }}>
                              <div style={{ display: "flex", gap: 6 }}>
                                <button type="button" disabled={!!actionState} onClick={() => handleExtend(s.session_id)}
                                        title="Reset the purge timer to 24 hours from now">
                                  {actionState === "extend" ? "…" : "Extend"}
                                </button>
                                <button type="button" disabled={actionState === "delete"} onClick={() => handleForceDelete(s.session_id)}
                                        className={`danger${actionState === "confirm-delete" ? " confirm" : ""}`}
                                        title={actionState === "confirm-delete" ? "Click again to confirm deletion" : "Force-delete this session"}>
                                  {actionState === "delete" ? "…" : actionState === "confirm-delete" ? "Confirm delete" : "Delete"}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })()}

        {tab === "activity" && (
          <div className="card">
            <div className="card-head">
              <h2>Recent activity</h2>
              <div className="meta"><span>last 50 events</span></div>
            </div>
            {loading ? (
              <div className="empty">Loading…</div>
            ) : activity.length === 0 ? (
              <div className="empty">No activity recorded yet.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Time</th><th>Organization</th><th>Method</th><th>Endpoint</th><th>Status</th><th>Session</th></tr>
                  </thead>
                  <tbody>
                    {activity.map((row) => (
                      <tr key={row.id}>
                        <td className="mono muted" style={{ whiteSpace: "nowrap" }}>{fmt(row.timestamp)}</td>
                        <td className="mono">{row.org_id.slice(0, 8)}…</td>
                        <td><span className="pill pill-neutral mono">{row.method}</span></td>
                        <td className="mono">{row.endpoint}</td>
                        <td><span className={`pill ${(row.status_code ?? 0) < 400 ? "pill-pass" : "pill-exception"}`}>{row.status_code ?? "—"}</span></td>
                        <td className="mono muted">{row.session_id ? row.session_id.slice(0, 16) + "…" : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  // Token starts null — we never trust localStorage until the server confirms it.
  const [token, setToken] = useState<string | null>(null);
  const [validating, setValidating] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("nhid_admin_token");
    if (!stored) {
      setValidating(false);
      return;
    }
    // Validate stored token against the server before showing anything.
    // Any truthy-but-invalid value (including manually-set garbage) is rejected here.
    fetch(`${ADMIN_BASE}/session`, {
      headers: { "X-Admin-Session": stored },
    })
      .then(res => {
        if (res.ok) {
          setToken(stored);
        } else {
          // Token is expired or invalid — wipe it silently.
          localStorage.removeItem("nhid_admin_token");
        }
      })
      .catch(() => {
        // Network error — don't grant access; wipe and force re-login.
        localStorage.removeItem("nhid_admin_token");
      })
      .finally(() => setValidating(false));
  }, []);

  const handleLogin = (t: string) => setToken(t);

  const handleLogout = async () => {
    // Tell the server first. POST /admin/logout deletes the session row, and
    // without this call the token stays valid server-side for the rest of its
    // 8-hour TTL -- so "logged out" meant only "this browser forgot the token".
    //
    // The local state is cleared regardless of the outcome: if the request
    // fails, refusing to sign out locally would leave the operator staring at
    // a session they asked to end.
    const current = token;
    if (current) {
      try {
        await fetch(`${ADMIN_BASE}/logout`, {
          method: "POST",
          headers: { "X-Admin-Session": current },
        });
      } catch {
        /* network failure: fall through and clear locally anyway */
      }
    }
    localStorage.removeItem("nhid_admin_token");
    setToken(null);
  };

  if (validating) {
    return (
      <EntryShell single>
        <div className="card" style={{ padding: "28px 30px" }}>
          <h2 style={{ marginBottom: 4 }}>Verifying session…</h2>
          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>Checking your administrator session with the server.</p>
        </div>
      </EntryShell>
    );
  }

  if (!token) return <LoginForm onLogin={handleLogin} />;
  return <AdminDashboard token={token} onLogout={handleLogout} />;
}
