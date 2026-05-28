import { useState, useEffect, useCallback, useRef } from "react";
import { Shield, LogOut, RefreshCw, Eye, EyeOff, Users, Activity, AlertCircle, Lock } from "lucide-react";

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
function mask(key: string) { return key.slice(0, 8) + "…" + key.slice(-4); }
const planColor = (p: string) => ({ free: "#94a3b8", l1: "#00c2a8", l2: "#53d8fb", l3: "#fbbd24" }[p] ?? "#94a3b8");
const statusColor = (s: string) => ({ active: "#3fb950", canceled: "#f85149", past_due: "#d29922" }[s] ?? "#94a3b8");

// ── Logo Mark ─────────────────────────────────────────────────────────────────

const NHIDMark = ({ size = 32 }: { size?: number }) => (
  <div style={{
    width: size, height: size, borderRadius: Math.round(size * 0.28),
    background: "linear-gradient(135deg, #00c2a8, #53d8fb)",
    display: "flex", alignItems: "center", justifyContent: "center",
    boxShadow: "0 0 16px rgba(0,194,168,0.4)",
    fontSize: Math.round(size * 0.44), fontWeight: 900, color: "#070c17",
    fontFamily: "'Raleway', sans-serif", flexShrink: 0, userSelect: "none",
    letterSpacing: "-0.02em",
  }}>N</div>
);

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
      /* Artificial delay to prevent rapid enumeration */
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

  const inputStyle = (disabled?: boolean): React.CSSProperties => ({
    width: "100%", padding: "10px 13px", borderRadius: 9,
    background: disabled ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.05)",
    border: "1px solid rgba(0,194,168,0.15)", color: disabled ? "#4b5563" : "#e0e8f4",
    fontSize: 14, outline: "none", fontFamily: "'Raleway', sans-serif",
    transition: "border-color 0.2s", boxSizing: "border-box",
  });

  return (
    <div style={{
      minHeight: "100dvh", background: "#070c17",
      display: "flex", alignItems: "center", justifyContent: "center",
      position: "relative", overflow: "hidden", padding: 20,
      fontFamily: "'Raleway', sans-serif",
    }}>
      {/* Ambient glow */}
      <div style={{
        position: "absolute", top: "30%", left: "50%", transform: "translate(-50%, -50%)",
        width: 500, height: 500, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(0,194,168,0.08) 0%, transparent 65%)",
        pointerEvents: "none",
      }} />

      <div style={{ width: "100%", maxWidth: 400, position: "relative", zIndex: 1 }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ display: "inline-flex", marginBottom: 16 }}>
            <NHIDMark size={52} />
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#e0e8f4", marginBottom: 4, letterSpacing: "-0.01em" }}>
            Operations Console
          </div>
          <div style={{ fontSize: 12, color: "#7a8fa8", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
            <Lock size={11} />
            Internal access only · Credentials required
          </div>
        </div>

        <div style={{
          background: "rgba(255,255,255,0.03)",
          border: "1px solid rgba(0,194,168,0.15)",
          borderRadius: 16, padding: "28px 28px 24px",
          backdropFilter: "blur(20px)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
        }}>
          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={{ display: "block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#7a8fa8", marginBottom: 6 }}>
                Username
              </label>
              <input
                value={username}
                onChange={e => setUsername(e.target.value)}
                autoComplete="username"
                required
                disabled={locked || loading}
                style={inputStyle(locked || loading)}
                onFocus={e => { if (!locked) e.target.style.borderColor = "rgba(0,194,168,0.4)"; }}
                onBlur={e => { e.target.style.borderColor = "rgba(0,194,168,0.15)"; }}
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#7a8fa8", marginBottom: 6 }}>
                Password
              </label>
              <div style={{ position: "relative" }}>
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  disabled={locked || loading}
                  style={{ ...inputStyle(locked || loading), paddingRight: 40 }}
                  onFocus={e => { if (!locked) e.target.style.borderColor = "rgba(0,194,168,0.4)"; }}
                  onBlur={e => { e.target.style.borderColor = "rgba(0,194,168,0.15)"; }}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(s => !s)}
                  style={{
                    position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
                    background: "none", border: "none", cursor: "pointer", color: "#7a8fa8", padding: 2,
                  }}
                >
                  {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {error && (
              <div style={{
                display: "flex", alignItems: "flex-start", gap: 8,
                background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.25)",
                borderRadius: 8, padding: "10px 12px", color: "#f87171", fontSize: 12, lineHeight: 1.5,
              }}>
                <AlertCircle size={14} style={{ marginTop: 1, flexShrink: 0 }} />
                <span>
                  {error}
                  {locked && ` Retry in ${cooldownLeft}s.`}
                </span>
              </div>
            )}

            {attempts > 0 && !locked && (
              <div style={{
                height: 3, background: "rgba(255,255,255,0.05)", borderRadius: 2, overflow: "hidden",
              }}>
                <div style={{
                  height: "100%", borderRadius: 2,
                  width: `${(attempts / MAX_ATTEMPTS) * 100}%`,
                  background: attempts >= 3 ? "#ef4444" : "#fbbd24",
                  transition: "width 0.3s ease",
                }} />
              </div>
            )}

            <button
              type="submit"
              disabled={loading || locked}
              style={{
                marginTop: 4, padding: "12px", borderRadius: 10, border: "none",
                background: locked
                  ? "rgba(239,68,68,0.15)"
                  : loading
                    ? "rgba(0,194,168,0.4)"
                    : "linear-gradient(135deg, #00c2a8, #53d8fb)",
                color: locked ? "#f87171" : "#070c17",
                fontWeight: 800, fontSize: 14, cursor: (loading || locked) ? "not-allowed" : "pointer",
                fontFamily: "'Raleway', sans-serif",
                boxShadow: (!loading && !locked) ? "0 0 24px rgba(0,194,168,0.3)" : "none",
                transition: "all 0.2s",
              }}
            >
              {locked
                ? `Locked — ${cooldownLeft}s`
                : loading
                  ? "Authenticating…"
                  : "Sign In →"
              }
            </button>
          </form>
        </div>

        <div style={{ textAlign: "center", marginTop: 16, fontSize: 10, color: "#7a8fa8", opacity: 0.5 }}>
          All access attempts are logged and audited.
        </div>
      </div>
    </div>
  );
}

// ── Admin Dashboard ────────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.03)", border: "1px solid rgba(0,194,168,0.12)",
      borderRadius: 12, padding: "18px 20px",
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#7a8fa8", marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: "#e0e8f4", letterSpacing: "-0.02em" }}>
        {value}
      </div>
    </div>
  );
}

function AdminDashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [orgs, setOrgs] = useState<AdminOrg[]>([]);
  const [stats, setStats] = useState<GlobalStats | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<"orgs" | "activity">("orgs");
  const [search, setSearch] = useState("");

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
      if (err.message?.startsWith("401:")) {
        onLogout();
        return;
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

  const filteredOrgs = orgs.filter(o =>
    search === "" ||
    o.org_name.toLowerCase().includes(search.toLowerCase()) ||
    o.org_id.toLowerCase().includes(search.toLowerCase()) ||
    o.plan.toLowerCase().includes(search.toLowerCase())
  );

  const baseStyle: React.CSSProperties = {
    background: "#070c17", color: "#e0e8f4",
    fontFamily: "'Raleway', system-ui, sans-serif",
    minHeight: "100dvh",
  };

  const tableHd: React.CSSProperties = {
    textAlign: "left", padding: "10px 16px",
    color: "#7a8fa8", fontSize: 10, fontWeight: 700,
    textTransform: "uppercase", letterSpacing: "0.1em",
    borderBottom: "1px solid rgba(255,255,255,0.05)", whiteSpace: "nowrap",
  };

  const tableTd: React.CSSProperties = {
    padding: "11px 16px", fontSize: 12,
    borderBottom: "1px solid rgba(255,255,255,0.03)", verticalAlign: "middle",
  };

  const mono: React.CSSProperties = { fontFamily: "monospace", fontSize: 11 };

  const planBadge = (p: string) => ({
    display: "inline-flex", alignItems: "center",
    background: `${planColor(p)}15`, color: planColor(p),
    borderRadius: 4, padding: "2px 8px", fontSize: 10,
    fontWeight: 700, textTransform: "uppercase" as const,
    border: `1px solid ${planColor(p)}30`, letterSpacing: "0.06em",
  });

  return (
    <div style={baseStyle}>
      {/* Header */}
      <header style={{
        background: "rgba(7,12,23,0.95)", backdropFilter: "blur(12px)",
        borderBottom: "1px solid rgba(0,194,168,0.12)",
        padding: "0 24px", height: 56, display: "flex",
        alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, zIndex: 20,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <NHIDMark size={28} />
          <span style={{ fontWeight: 800, fontSize: 14, color: "#e0e8f4" }}>Operations Console</span>
          <span
            style={{
              fontSize: 9, fontWeight: 700, padding: "2px 8px", borderRadius: 12,
              background: "rgba(239,68,68,0.1)", color: "#f87171",
              border: "1px solid rgba(239,68,68,0.25)", textTransform: "uppercase",
              letterSpacing: "0.1em", marginLeft: 4,
            }}
          >
            Internal
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={load}
            disabled={loading}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "7px 13px",
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 7, color: "#94a3b8", fontSize: 12, fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer", fontFamily: "'Raleway', sans-serif",
            }}
          >
            <RefreshCw
              size={12}
              style={{ animation: loading ? "spin 1s linear infinite" : "none" }}
            />
            Refresh
          </button>
          <button
            onClick={onLogout}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "7px 13px",
              background: "rgba(248,81,73,0.08)", border: "1px solid rgba(248,81,73,0.2)",
              borderRadius: 7, color: "#f85149", fontSize: 12, fontWeight: 600,
              cursor: "pointer", fontFamily: "'Raleway', sans-serif",
            }}
          >
            <LogOut size={12} /> Sign Out
          </button>
        </div>
      </header>

      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "28px 24px" }}>
        {error && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8, marginBottom: 22,
            background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.25)",
            borderRadius: 10, padding: "12px 16px", color: "#f87171", fontSize: 13,
          }}>
            <AlertCircle size={14} /> {error}
          </div>
        )}

        {/* Stats */}
        {stats && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 28 }}>
            <StatCard label="Total Organisations" value={stats.total_orgs} />
            <StatCard label="Total API Requests" value={stats.total_requests.toLocaleString()} />
            <div style={{
              background: "rgba(255,255,255,0.03)", border: "1px solid rgba(0,194,168,0.12)",
              borderRadius: 12, padding: "18px 20px",
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#7a8fa8", marginBottom: 10 }}>
                Plan Distribution
              </div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {Object.entries(stats.orgs_by_plan).map(([plan, count]) => (
                  <div key={plan}>
                    <span style={{ fontSize: 10, color: "#7a8fa8" }}>{plan.toUpperCase()} </span>
                    <span style={{ fontSize: 18, fontWeight: 800, color: planColor(plan) }}>{count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: "flex", gap: 0, borderBottom: "1px solid rgba(255,255,255,0.06)", marginBottom: 22 }}>
          {([["orgs", "Organisations", orgs.length], ["activity", "Recent Activity", activity.length]] as const).map(([id, label, count]) => (
            <button
              key={id}
              onClick={() => setTab(id as "orgs" | "activity")}
              style={{
                display: "flex", alignItems: "center", gap: 7,
                padding: "10px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer",
                background: "none", border: "none",
                color: tab === id ? "#00c2a8" : "#7a8fa8",
                borderBottom: tab === id ? "2px solid #00c2a8" : "2px solid transparent",
                marginBottom: -1, fontFamily: "'Raleway', sans-serif",
                transition: "color 0.15s",
              }}
            >
              {id === "orgs" ? <Users size={13} /> : <Activity size={13} />}
              {label}
              <span
                style={{
                  fontSize: 10, padding: "1px 6px", borderRadius: 10, fontWeight: 700,
                  background: tab === id ? "rgba(0,194,168,0.15)" : "rgba(255,255,255,0.04)",
                  color: tab === id ? "#00c2a8" : "#7a8fa8",
                }}
              >
                {count}
              </span>
            </button>
          ))}
        </div>

        {/* Org search */}
        {tab === "orgs" && (
          <div style={{ marginBottom: 14 }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search organisations by name, ID, or plan…"
              style={{
                width: "100%", maxWidth: 360, padding: "9px 14px", borderRadius: 8,
                background: "rgba(255,255,255,0.04)", border: "1px solid rgba(0,194,168,0.12)",
                color: "#e0e8f4", fontSize: 13, outline: "none",
                fontFamily: "'Raleway', sans-serif",
              }}
              onFocus={e => e.target.style.borderColor = "rgba(0,194,168,0.35)"}
              onBlur={e => e.target.style.borderColor = "rgba(0,194,168,0.12)"}
            />
          </div>
        )}

        {/* Orgs Table */}
        {tab === "orgs" && (
          <div style={{
            background: "rgba(255,255,255,0.02)", border: "1px solid rgba(0,194,168,0.1)",
            borderRadius: 12, overflow: "hidden",
          }}>
            <div style={{
              padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.05)",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 14, color: "#e0e8f4" }}>
                <Users size={15} style={{ color: "#00c2a8" }} /> All Organisations
              </span>
              <span style={{ color: "#7a8fa8", fontSize: 12 }}>
                {filteredOrgs.length}{filteredOrgs.length !== orgs.length ? ` of ${orgs.length}` : ""} total
              </span>
            </div>
            {loading ? (
              <div style={{ padding: 40, textAlign: "center", color: "#7a8fa8" }}>Loading…</div>
            ) : filteredOrgs.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: "#7a8fa8" }}>
                {search ? "No organisations match your search." : "No organisations yet."}
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "rgba(0,0,0,0.15)" }}>
                      <th style={tableHd}>Organisation</th>
                      <th style={tableHd}>Plan</th>
                      <th style={tableHd}>Status</th>
                      <th style={tableHd}>Total Reqs</th>
                      <th style={tableHd}>Today</th>
                      <th style={tableHd}>API Key</th>
                      <th style={tableHd}>Stripe Sub</th>
                      <th style={tableHd}>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredOrgs.map((org) => (
                      <tr key={org.org_id} style={{ transition: "background 0.1s" }} className="hover:bg-white/[0.02]">
                        <td style={tableTd}>
                          <div style={{ fontWeight: 700, color: "#e0e8f4", marginBottom: 2 }}>{org.org_name}</div>
                          <div style={{ ...mono, color: "#7a8fa8" }}>{org.org_id.slice(0, 8)}…</div>
                        </td>
                        <td style={tableTd}>
                          <span style={planBadge(org.plan)}>{org.plan}</span>
                        </td>
                        <td style={tableTd}>
                          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                            <span style={{
                              width: 6, height: 6, borderRadius: "50%",
                              background: statusColor(org.status), flexShrink: 0,
                              boxShadow: `0 0 6px ${statusColor(org.status)}80`,
                            }} />
                            <span style={{ fontSize: 11, fontWeight: 700, color: statusColor(org.status) }}>
                              {org.status}
                            </span>
                          </span>
                        </td>
                        <td style={{ ...tableTd, fontWeight: 700, color: "#e0e8f4" }}>
                          {org.total_requests.toLocaleString()}
                        </td>
                        <td style={{ ...tableTd, color: "#e0e8f4" }}>{org.today_requests}</td>
                        <td style={tableTd}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <code style={{
                              ...mono, color: "#00c2a8",
                              background: "rgba(0,194,168,0.08)", borderRadius: 4, padding: "2px 7px",
                              border: "1px solid rgba(0,194,168,0.15)",
                            }}>
                              {revealedKeys.has(org.org_id) ? org.api_key : mask(org.api_key)}
                            </code>
                            <button
                              onClick={() => toggleKey(org.org_id)}
                              style={{ background: "none", border: "none", cursor: "pointer", color: "#7a8fa8", padding: 2 }}
                            >
                              {revealedKeys.has(org.org_id) ? <EyeOff size={12} /> : <Eye size={12} />}
                            </button>
                          </div>
                        </td>
                        <td style={{ ...tableTd, ...mono, color: org.stripe_subscription_id ? "#3fb950" : "#7a8fa8" }}>
                          {org.stripe_subscription_id ? org.stripe_subscription_id.slice(0, 14) + "…" : "—"}
                        </td>
                        <td style={{ ...tableTd, color: "#7a8fa8", fontSize: 11 }}>
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
          <div style={{
            background: "rgba(255,255,255,0.02)", border: "1px solid rgba(0,194,168,0.1)",
            borderRadius: 12, overflow: "hidden",
          }}>
            <div style={{
              padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.05)",
              display: "flex", alignItems: "center", gap: 8,
            }}>
              <Activity size={15} style={{ color: "#00c2a8" }} />
              <span style={{ fontWeight: 700, fontSize: 14, color: "#e0e8f4" }}>Recent Activity</span>
              <span style={{ color: "#7a8fa8", fontSize: 12 }}>last 50 events</span>
            </div>
            {loading ? (
              <div style={{ padding: 40, textAlign: "center", color: "#7a8fa8" }}>Loading…</div>
            ) : activity.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: "#7a8fa8" }}>No activity recorded yet.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "rgba(0,0,0,0.15)" }}>
                      <th style={tableHd}>Time</th>
                      <th style={tableHd}>Org</th>
                      <th style={tableHd}>Method</th>
                      <th style={tableHd}>Endpoint</th>
                      <th style={tableHd}>Status</th>
                      <th style={tableHd}>Session</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activity.map((row) => (
                      <tr key={row.id} className="hover:bg-white/[0.02]" style={{ transition: "background 0.1s" }}>
                        <td style={{ ...tableTd, ...mono, color: "#7a8fa8", whiteSpace: "nowrap" }}>
                          {fmt(row.timestamp)}
                        </td>
                        <td style={{ ...tableTd, ...mono, color: "#e0e8f4" }}>
                          {row.org_id.slice(0, 8)}…
                        </td>
                        <td style={tableTd}>
                          <span style={{
                            fontSize: 10, fontWeight: 800, color: "#00c2a8",
                            fontFamily: "monospace", letterSpacing: "0.06em",
                            background: "rgba(0,194,168,0.08)", padding: "2px 6px", borderRadius: 4,
                          }}>{row.method}</span>
                        </td>
                        <td style={{ ...tableTd, ...mono, color: "#e0e8f4" }}>{row.endpoint}</td>
                        <td style={tableTd}>
                          <span style={{
                            ...mono, fontWeight: 800, fontSize: 12,
                            color: (row.status_code ?? 0) < 400 ? "#3fb950" : "#f85149",
                          }}>
                            {row.status_code ?? "—"}
                          </span>
                        </td>
                        <td style={{ ...tableTd, ...mono, color: "#7a8fa8", fontSize: 10 }}>
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

  const handleLogout = () => {
    localStorage.removeItem("nhid_admin_token");
    setToken(null);
  };

  if (validating) {
    return (
      <div
        style={{
          minHeight: "100dvh", display: "flex", alignItems: "center",
          justifyContent: "center", background: "var(--nhid-bg)",
          flexDirection: "column", gap: 16,
        }}
      >
        <div
          style={{
            width: 32, height: 32, borderRadius: "50%",
            border: "2px solid rgba(0,194,168,0.2)",
            borderTopColor: "#00c2a8",
            animation: "spin 0.8s linear infinite",
          }}
        />
        <span style={{ fontSize: 12, color: "var(--nhid-muted)", fontFamily: "'Raleway', sans-serif" }}>
          Verifying session…
        </span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!token) return <LoginForm onLogin={handleLogin} />;
  return <AdminDashboard token={token} onLogout={handleLogout} />;
}
