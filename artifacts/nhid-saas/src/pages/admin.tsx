import { useState, useEffect, useCallback } from "react";
import { Shield, LogOut, RefreshCw, Eye, EyeOff, Users, Activity, AlertCircle } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AdminOrg {
  org_id: string;
  org_name: string;
  api_key: string;
  plan: string;
  status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  created_at: string;
  usage_count: number;
  active: number;
  today_requests: number;
  total_requests: number;
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

// ── Admin API ─────────────────────────────────────────────────────────────────

const ADMIN_BASE = "/saas-api/admin";

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
    throw new Error(body.detail ?? res.statusText);
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
    const body = await res.json().catch(() => ({ detail: "Login failed" }));
    throw new Error(body.detail ?? "Login failed");
  }
  const data = await res.json();
  return data.admin_session_token as string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const PLAN_COLORS: Record<string, string> = {
  free: "text-slate-400",
  l1: "text-teal-400",
  l2: "text-teal-300",
  l3: "text-amber-300",
};

const STATUS_COLORS: Record<string, string> = {
  active: "text-green-400",
  canceled: "text-red-400",
  past_due: "text-amber-400",
};

function fmt(ts: string) {
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
}

function mask(key: string) {
  return key.slice(0, 8) + "…" + key.slice(-4);
}

// ── Login Form ────────────────────────────────────────────────────────────────

function LoginForm({ onLogin }: { onLogin: (token: string) => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const token = await adminLogin(username, password);
      localStorage.setItem("nhid_admin_token", token);
      onLogin(token);
    } catch (err: any) {
      setError(err.message ?? "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "#0d1117" }}>
      <div style={{ width: 380, background: "#161b22", border: "1px solid #30363d", borderRadius: 12, padding: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 28 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: "#00c2a8", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Shield size={18} color="#0d1117" />
          </div>
          <div>
            <div style={{ color: "#e6edf3", fontWeight: 700, fontSize: 15 }}>NHID Admin Portal</div>
            <div style={{ color: "#8b949e", fontSize: 12 }}>Internal access only</div>
          </div>
        </div>

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={{ display: "block", color: "#8b949e", fontSize: 12, marginBottom: 6, fontWeight: 500 }}>Username</label>
            <input
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoComplete="username"
              required
              style={{ width: "100%", background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, color: "#e6edf3", padding: "8px 12px", fontSize: 14, outline: "none", boxSizing: "border-box" }}
            />
          </div>
          <div>
            <label style={{ display: "block", color: "#8b949e", fontSize: 12, marginBottom: 6, fontWeight: 500 }}>Password</label>
            <div style={{ position: "relative" }}>
              <input
                type={showPw ? "text" : "password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                style={{ width: "100%", background: "#0d1117", border: "1px solid #30363d", borderRadius: 6, color: "#e6edf3", padding: "8px 36px 8px 12px", fontSize: 14, outline: "none", boxSizing: "border-box" }}
              />
              <button type="button" onClick={() => setShowPw(s => !s)}
                style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "#8b949e" }}>
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {error && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#2d1515", border: "1px solid #f8514933", borderRadius: 6, padding: "8px 12px", color: "#f85149", fontSize: 13 }}>
              <AlertCircle size={14} /> {error}
            </div>
          )}

          <button type="submit" disabled={loading}
            style={{ marginTop: 4, background: "#00c2a8", color: "#0d1117", border: "none", borderRadius: 6, padding: "10px 0", fontWeight: 700, fontSize: 14, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1 }}>
            {loading ? "Authenticating…" : "Sign In"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

function AdminDashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [orgs, setOrgs] = useState<AdminOrg[]>([]);
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<"orgs" | "activity">("orgs");

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
    } catch (err: any) {
      if (err.message?.includes("401") || err.message?.includes("session")) {
        onLogout();
      }
      setError(err.message ?? "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [token, onLogout]);

  useEffect(() => { load(); }, [load]);

  const toggleKey = (orgId: string) => {
    setRevealedKeys(prev => {
      const next = new Set(prev);
      next.has(orgId) ? next.delete(orgId) : next.add(orgId);
      return next;
    });
  };

  const s: Record<string, React.CSSProperties> = {
    page: { minHeight: "100vh", background: "#0d1117", color: "#e6edf3", fontFamily: "'Inter', system-ui, sans-serif" },
    header: { background: "#161b22", borderBottom: "1px solid #30363d", padding: "0 24px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" },
    logo: { display: "flex", alignItems: "center", gap: 10 },
    logoBox: { width: 28, height: 28, borderRadius: 6, background: "#00c2a8", display: "flex", alignItems: "center", justifyContent: "center" },
    logoText: { color: "#e6edf3", fontWeight: 700, fontSize: 14 },
    headerRight: { display: "flex", alignItems: "center", gap: 12 },
    btn: { display: "flex", alignItems: "center", gap: 6, background: "#21262d", border: "1px solid #30363d", borderRadius: 6, color: "#8b949e", padding: "6px 12px", fontSize: 13, cursor: "pointer" },
    body: { maxWidth: 1200, margin: "0 auto", padding: "28px 24px" },
    statGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 28 },
    statCard: { background: "#161b22", border: "1px solid #30363d", borderRadius: 8, padding: "18px 20px" },
    statLabel: { color: "#8b949e", fontSize: 12, fontWeight: 500, marginBottom: 6 },
    statValue: { color: "#e6edf3", fontSize: 26, fontWeight: 700 },
    card: { background: "#161b22", border: "1px solid #30363d", borderRadius: 8, overflow: "hidden" },
    cardHeader: { padding: "14px 20px", borderBottom: "1px solid #21262d", display: "flex", alignItems: "center", justifyContent: "space-between" },
    cardTitle: { color: "#e6edf3", fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", gap: 8 },
    table: { width: "100%", borderCollapse: "collapse" as const },
    th: { textAlign: "left" as const, padding: "10px 16px", color: "#8b949e", fontSize: 12, fontWeight: 600, borderBottom: "1px solid #21262d", whiteSpace: "nowrap" as const },
    td: { padding: "11px 16px", fontSize: 13, borderBottom: "1px solid #161b22", verticalAlign: "middle" as const },
    mono: { fontFamily: "monospace", fontSize: 12 },
    badge: (color: string) => ({ display: "inline-flex", alignItems: "center", gap: 4, background: color + "18", color, borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 600, textTransform: "uppercase" as const }),
    tabRow: { display: "flex", gap: 0, borderBottom: "1px solid #30363d", marginBottom: 24 },
    tab: (active: boolean) => ({
      padding: "10px 20px", fontSize: 13, fontWeight: 500, cursor: "pointer", background: "none", border: "none",
      color: active ? "#00c2a8" : "#8b949e",
      borderBottom: active ? "2px solid #00c2a8" : "2px solid transparent",
      marginBottom: -1,
    }),
  };

  const planColor = (p: string) => ({ free: "#8b949e", l1: "#00c2a8", l2: "#2dd4bf", l3: "#fbbf24" }[p] ?? "#8b949e");
  const statusColor = (s: string) => ({ active: "#3fb950", canceled: "#f85149", past_due: "#d29922" }[s] ?? "#8b949e");

  return (
    <div style={s.page}>
      {/* Header */}
      <header style={s.header}>
        <div style={s.logo}>
          <div style={s.logoBox}><Shield size={15} color="#0d1117" /></div>
          <span style={s.logoText}>NHID Admin</span>
          <span style={{ color: "#8b949e", fontSize: 12, marginLeft: 4 }}>Internal Portal</span>
        </div>
        <div style={s.headerRight}>
          <button style={s.btn} onClick={load} disabled={loading}>
            <RefreshCw size={13} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
            Refresh
          </button>
          <button style={{ ...s.btn, color: "#f85149" }} onClick={onLogout}>
            <LogOut size={13} /> Sign Out
          </button>
        </div>
      </header>

      <div style={s.body}>
        {error && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#2d1515", border: "1px solid #f8514933", borderRadius: 8, padding: "12px 16px", color: "#f85149", fontSize: 13, marginBottom: 20 }}>
            <AlertCircle size={14} /> {error}
          </div>
        )}

        {/* Stats */}
        {stats && (
          <div style={s.statGrid}>
            <div style={s.statCard}>
              <div style={s.statLabel}>Total Orgs</div>
              <div style={s.statValue}>{stats.total_orgs}</div>
            </div>
            <div style={s.statCard}>
              <div style={s.statLabel}>Total API Requests</div>
              <div style={s.statValue}>{stats.total_requests.toLocaleString()}</div>
            </div>
            <div style={s.statCard}>
              <div style={s.statLabel}>Plans Distribution</div>
              <div style={{ display: "flex", gap: 12, marginTop: 6, flexWrap: "wrap" }}>
                {Object.entries(stats.orgs_by_plan).map(([plan, count]) => (
                  <span key={plan} style={{ color: planColor(plan), fontSize: 13, fontWeight: 600 }}>
                    {plan.toUpperCase()} <span style={{ color: "#e6edf3" }}>{count}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div style={s.tabRow}>
          <button style={s.tab(tab === "orgs")} onClick={() => setTab("orgs")}>
            <Users size={13} style={{ display: "inline", marginRight: 6 }} />Organisations ({orgs.length})
          </button>
          <button style={s.tab(tab === "activity")} onClick={() => setTab("activity")}>
            <Activity size={13} style={{ display: "inline", marginRight: 6 }} />Recent Activity ({activity.length})
          </button>
        </div>

        {/* Orgs Table */}
        {tab === "orgs" && (
          <div style={s.card}>
            <div style={s.cardHeader}>
              <span style={s.cardTitle}><Users size={15} /> All Organisations</span>
              <span style={{ color: "#8b949e", fontSize: 12 }}>{orgs.length} total</span>
            </div>
            {loading ? (
              <div style={{ padding: 40, textAlign: "center", color: "#8b949e" }}>Loading…</div>
            ) : orgs.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: "#8b949e" }}>No organisations yet.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={s.table}>
                  <thead>
                    <tr style={{ background: "#0d1117" }}>
                      <th style={s.th}>Organisation</th>
                      <th style={s.th}>Plan</th>
                      <th style={s.th}>Status</th>
                      <th style={s.th}>Total Reqs</th>
                      <th style={s.th}>Today</th>
                      <th style={s.th}>API Key</th>
                      <th style={s.th}>Stripe Sub</th>
                      <th style={s.th}>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orgs.map((org, i) => (
                      <tr key={org.org_id} style={{ background: i % 2 === 0 ? "#161b22" : "#0d1117" }}>
                        <td style={s.td}>
                          <div style={{ color: "#e6edf3", fontWeight: 600, fontSize: 13 }}>{org.org_name}</div>
                          <div style={{ ...s.mono, color: "#8b949e" }}>{org.org_id.slice(0, 8)}…</div>
                        </td>
                        <td style={s.td}>
                          <span style={s.badge(planColor(org.plan))}>{org.plan}</span>
                        </td>
                        <td style={s.td}>
                          <span style={{ color: statusColor(org.status), fontWeight: 600, fontSize: 12 }}>
                            ● {org.status}
                          </span>
                        </td>
                        <td style={{ ...s.td, color: "#e6edf3", fontWeight: 600 }}>
                          {org.total_requests.toLocaleString()}
                        </td>
                        <td style={{ ...s.td, color: "#e6edf3" }}>
                          {org.today_requests}
                        </td>
                        <td style={s.td}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <code style={{ ...s.mono, color: "#00c2a8", background: "#00c2a810", borderRadius: 4, padding: "2px 6px" }}>
                              {revealedKeys.has(org.org_id) ? org.api_key : mask(org.api_key)}
                            </code>
                            <button onClick={() => toggleKey(org.org_id)}
                              style={{ background: "none", border: "none", cursor: "pointer", color: "#8b949e", padding: 2 }}>
                              {revealedKeys.has(org.org_id) ? <EyeOff size={12} /> : <Eye size={12} />}
                            </button>
                          </div>
                        </td>
                        <td style={{ ...s.td, ...s.mono, color: org.stripe_subscription_id ? "#3fb950" : "#8b949e" }}>
                          {org.stripe_subscription_id ? org.stripe_subscription_id.slice(0, 14) + "…" : "—"}
                        </td>
                        <td style={{ ...s.td, color: "#8b949e", fontSize: 12 }}>
                          {fmt(org.created_at).split(",")[0]}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Activity Table */}
        {tab === "activity" && (
          <div style={s.card}>
            <div style={s.cardHeader}>
              <span style={s.cardTitle}><Activity size={15} /> Recent Activity (last 50)</span>
            </div>
            {loading ? (
              <div style={{ padding: 40, textAlign: "center", color: "#8b949e" }}>Loading…</div>
            ) : activity.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: "#8b949e" }}>No activity recorded yet.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={s.table}>
                  <thead>
                    <tr style={{ background: "#0d1117" }}>
                      <th style={s.th}>Time</th>
                      <th style={s.th}>Org</th>
                      <th style={s.th}>Method</th>
                      <th style={s.th}>Endpoint</th>
                      <th style={s.th}>Status</th>
                      <th style={s.th}>Session</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activity.map((row, i) => (
                      <tr key={row.id} style={{ background: i % 2 === 0 ? "#161b22" : "#0d1117" }}>
                        <td style={{ ...s.td, ...s.mono, color: "#8b949e", whiteSpace: "nowrap" }}>
                          {fmt(row.timestamp)}
                        </td>
                        <td style={{ ...s.td, ...s.mono, color: "#e6edf3", fontSize: 12 }}>
                          {row.org_id.slice(0, 8)}…
                        </td>
                        <td style={s.td}>
                          <span style={{ ...s.mono, color: "#00c2a8", fontWeight: 700, fontSize: 11 }}>{row.method}</span>
                        </td>
                        <td style={{ ...s.td, ...s.mono, color: "#cdd9e5" }}>{row.endpoint}</td>
                        <td style={s.td}>
                          <span style={{
                            ...s.mono, fontWeight: 700, fontSize: 12,
                            color: (row.status_code ?? 0) < 400 ? "#3fb950" : "#f85149",
                          }}>
                            {row.status_code ?? "—"}
                          </span>
                        </td>
                        <td style={{ ...s.td, ...s.mono, color: "#8b949e", fontSize: 11 }}>
                          {row.session_id ? row.session_id.slice(0, 16) + "…" : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("nhid_admin_token"));

  const handleLogin = (t: string) => setToken(t);

  const handleLogout = () => {
    localStorage.removeItem("nhid_admin_token");
    setToken(null);
  };

  if (!token) return <LoginForm onLogin={handleLogin} />;
  return <AdminDashboard token={token} onLogout={handleLogout} />;
}
