import { useGetMe, useGetRecent } from "@/hooks/use-nhid";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { Activity, ShieldCheck, Zap, Server } from "lucide-react";

function GlassCard({
  children,
  glow = false,
  style = {},
}: {
  children: React.ReactNode;
  glow?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        background: "var(--nhid-surface)",
        border: "1px solid var(--nhid-border)",
        borderRadius: 14,
        backdropFilter: "blur(12px)",
        ...(glow ? { boxShadow: "0 0 40px rgba(0,194,168,0.07)" } : {}),
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  accent = false,
}: {
  label: string;
  value: string | number;
  sub: string;
  icon: React.ElementType;
  accent?: boolean;
}) {
  return (
    <GlassCard style={{ padding: "20px 22px", transition: "border-color 0.2s" }} glow={accent}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
        <span
          style={{
            fontSize: 10, fontWeight: 700, textTransform: "uppercase",
            letterSpacing: "0.1em", color: "var(--nhid-muted)",
          }}
        >
          {label}
        </span>
        <Icon
          size={15}
          style={{ color: accent ? "var(--nhid-teal)" : "var(--nhid-muted)", opacity: 0.8 }}
        />
      </div>
      <div
        style={{
          fontSize: 30, fontWeight: 800, color: "var(--nhid-text)",
          letterSpacing: "-0.02em", lineHeight: 1,
          marginBottom: 8,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 11, color: accent ? "var(--nhid-teal)" : "var(--nhid-muted)", fontWeight: 600 }}>
        {sub}
      </div>
    </GlassCard>
  );
}

function SkeletonCard() {
  return (
    <div
      style={{
        background: "var(--nhid-surface)", border: "1px solid var(--nhid-border)",
        borderRadius: 14, padding: "20px 22px",
      }}
    >
      <Skeleton className="h-3 w-24 mb-4" />
      <Skeleton className="h-8 w-16 mb-2" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

function ActivityBadge({ method, status }: { method: string; status: number | null }) {
  const ok = (status ?? 0) < 400;
  return (
    <span
      style={{
        fontSize: 9, fontWeight: 800, padding: "3px 7px", borderRadius: 5,
        fontFamily: "monospace", letterSpacing: "0.06em", textTransform: "uppercase",
        background: ok ? "rgba(0,194,168,0.12)" : "rgba(239,68,68,0.12)",
        color: ok ? "var(--nhid-teal)" : "#ef4444",
        border: `1px solid ${ok ? "rgba(0,194,168,0.25)" : "rgba(239,68,68,0.25)"}`,
        flexShrink: 0,
      }}
    >
      {method} {status}
    </span>
  );
}

export default function Dashboard() {
  const { data: profile, isLoading: loadingProfile } = useGetMe();
  const { data: recent, isLoading: loadingRecent } = useGetRecent(8);

  if (loadingProfile) {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <div>
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
        </div>
        <Skeleton className="h-72" style={{ borderRadius: 14 }} />
      </div>
    );
  }

  if (!profile) return null;

  const dailyLimit = profile.plan_details.daily_limit;
  const usedToday = dailyLimit ? (dailyLimit - (profile.rate_limit.remaining ?? dailyLimit)) : 0;
  const usagePercent = dailyLimit ? Math.min((usedToday / dailyLimit) * 100, 100) : 0;
  const remaining = profile.rate_limit.remaining;

  const PLAN_LABELS: Record<string, string> = {
    free: "Free", l1: "L1 Starter", l2: "L2 Pro", l3: "L3 Enterprise",
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-400">
      {/* Page header */}
      <div>
        <h1
          style={{
            fontSize: 26, fontWeight: 800, color: "var(--nhid-text)",
            letterSpacing: "-0.02em", marginBottom: 4,
          }}
        >
          Control Plane
        </h1>
        <p style={{ fontSize: 13, color: "var(--nhid-muted)" }}>
          Operations overview for {profile.org_name}
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Active Plan"
          value={PLAN_LABELS[profile.plan] ?? profile.plan}
          sub={`${profile.plan_details.features.length} features enabled`}
          icon={ShieldCheck}
          accent
        />
        <StatCard
          label="Total API Requests"
          value={profile.usage_count.toLocaleString()}
          sub={`Since ${format(new Date(profile.created_at), "MMM d, yyyy")}`}
          icon={Server}
        />
        <StatCard
          label="Daily Remaining"
          value={remaining !== null ? remaining.toLocaleString() : "∞"}
          sub={dailyLimit ? `of ${dailyLimit.toLocaleString()} daily` : "Unlimited"}
          icon={Zap}
          accent={usagePercent > 70}
        />
        <StatCard
          label="Subscription"
          value={profile.status === "active" ? "Active" : profile.status}
          sub={profile.billing_active ? "Stripe managed" : "Self-service"}
          icon={Activity}
        />
      </div>

      {/* Two-column section */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Activity stream */}
        <GlassCard style={{ padding: "22px", gridColumn: "1 / 3" }}>
          <div
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              marginBottom: 18,
            }}
          >
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--nhid-text)" }}>
                Recent Activity
              </div>
              <div style={{ fontSize: 11, color: "var(--nhid-muted)", marginTop: 2 }}>
                Live feed of requests across all endpoints
              </div>
            </div>
            <span
              style={{
                display: "flex", alignItems: "center", gap: 5,
                fontSize: 10, color: "var(--nhid-teal)", fontWeight: 700,
              }}
            >
              <span
                style={{
                  width: 6, height: 6, borderRadius: "50%",
                  background: "var(--nhid-teal)", display: "inline-block",
                  boxShadow: "0 0 6px var(--nhid-teal)",
                }}
              />
              Live
            </span>
          </div>

          {loadingRecent ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-11 w-full" style={{ borderRadius: 8 }} />)}
            </div>
          ) : recent?.activity && recent.activity.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {recent.activity.map((entry) => (
                <div
                  key={entry.id}
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "10px 14px", borderRadius: 9,
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(255,255,255,0.04)",
                    transition: "border-color 0.15s, background 0.15s",
                  }}
                  className="hover:border-[rgba(0,194,168,0.15)] hover:bg-[rgba(255,255,255,0.04)]"
                >
                  <ActivityBadge method={entry.method} status={entry.status_code} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 12, fontFamily: "monospace", color: "var(--nhid-text)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {entry.endpoint}
                    </p>
                    {entry.session_id && (
                      <p style={{ fontSize: 10, color: "var(--nhid-muted)", fontFamily: "monospace", marginTop: 1 }}>
                        {entry.session_id.slice(0, 24)}{entry.session_id.length > 24 ? "…" : ""}
                      </p>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--nhid-muted)", fontFamily: "monospace", flexShrink: 0 }}>
                    {format(new Date(entry.timestamp), "HH:mm:ss")}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div
              style={{
                textAlign: "center", padding: "40px 20px",
                border: "1px dashed var(--nhid-border)", borderRadius: 10,
              }}
            >
              <Activity size={28} style={{ color: "var(--nhid-muted)", opacity: 0.3, margin: "0 auto 10px" }} />
              <p style={{ fontSize: 13, color: "var(--nhid-muted)" }}>No activity yet.</p>
              <p style={{ fontSize: 11, color: "var(--nhid-muted)", opacity: 0.7, marginTop: 4 }}>
                Submit a trace event to see it here.
              </p>
            </div>
          )}
        </GlassCard>

        {/* Quota + Plan right rail */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Quota */}
          <GlassCard style={{ padding: "20px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--nhid-text)", marginBottom: 14 }}>
              Daily Quota
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: "var(--nhid-muted)" }}>
                {usedToday.toLocaleString()} / {dailyLimit ? dailyLimit.toLocaleString() : "∞"}
              </span>
              <span
                style={{
                  fontSize: 12, fontWeight: 800,
                  color: usagePercent > 80 ? "#ef4444" : usagePercent > 60 ? "#fbbd24" : "var(--nhid-teal)",
                }}
              >
                {dailyLimit ? `${Math.round(usagePercent)}%` : "∞"}
              </span>
            </div>
            <div
              style={{
                height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 3,
                overflow: "hidden", marginBottom: 10,
              }}
            >
              <div
                style={{
                  height: "100%", borderRadius: 3,
                  width: dailyLimit ? `${usagePercent}%` : "0%",
                  background: usagePercent > 80
                    ? "linear-gradient(90deg, #ef4444, #f87171)"
                    : "linear-gradient(90deg, var(--nhid-teal), var(--nhid-cyan))",
                  boxShadow: "0 0 12px rgba(0,194,168,0.5)",
                  transition: "width 0.6s ease",
                }}
              />
            </div>
            <div style={{ fontSize: 10, color: "var(--nhid-muted)" }}>
              Resets at midnight UTC
            </div>
          </GlassCard>

          {/* Plan tier */}
          <div
            style={{
              background: "linear-gradient(135deg, rgba(0,194,168,0.1), rgba(83,216,251,0.06))",
              border: "1px solid var(--nhid-border-bright)",
              borderRadius: 14, padding: "20px",
              boxShadow: "0 0 40px rgba(0,194,168,0.08)",
              flex: 1,
            }}
          >
            <div
              style={{
                fontSize: 9, fontWeight: 700, color: "var(--nhid-muted)",
                textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 8,
              }}
            >
              Current Plan
            </div>
            <div
              style={{
                fontSize: 18, fontWeight: 800, color: "var(--nhid-teal)",
                marginBottom: 4, letterSpacing: "-0.01em",
              }}
            >
              {PLAN_LABELS[profile.plan] ?? profile.plan}
            </div>
            <div style={{ fontSize: 11, color: "var(--nhid-muted)", lineHeight: 1.5, marginBottom: 14 }}>
              {profile.plan_details.features.slice(0, 3).join(" · ")}
            </div>
            {profile.upgrade.upgrade_available && (
              <a
                href={profile.upgrade.stripe_checkout_url ?? "#"}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: "block", width: "100%", padding: "9px",
                  borderRadius: 8, border: "1px solid var(--nhid-border-bright)",
                  background: "rgba(0,194,168,0.12)", color: "var(--nhid-teal)",
                  fontWeight: 700, fontSize: 11, cursor: "pointer",
                  textDecoration: "none", textAlign: "center",
                  fontFamily: "'Raleway', sans-serif",
                }}
              >
                Upgrade to {profile.upgrade.next_plan} →
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
