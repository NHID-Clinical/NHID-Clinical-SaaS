import { useGetUsage } from "@/hooks/use-nhid";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from "recharts";
import { Activity, Server, Zap, Clock } from "lucide-react";

function GlassCard({ children, style = {} as React.CSSProperties }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: "var(--nhid-surface)", border: "1px solid var(--nhid-border)", borderRadius: 14, ...style }}>
      {children}
    </div>
  );
}

function MetricCard({ label, value, sub, icon: Icon, accent = false }: {
  label: string; value: string | number; sub: string; icon: React.ElementType; accent?: boolean;
}) {
  return (
    <GlassCard style={{ padding: "18px 20px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--nhid-muted)" }}>
          {label}
        </span>
        <Icon size={14} style={{ color: accent ? "var(--nhid-teal)" : "var(--nhid-muted)", opacity: 0.8 }} />
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: "var(--nhid-text)", letterSpacing: "-0.02em", lineHeight: 1, marginBottom: 6 }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: "var(--nhid-muted)" }}>{sub}</div>
    </GlassCard>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div style={{
        background: "rgba(10,18,35,0.96)", border: "1px solid var(--nhid-border)",
        borderRadius: 8, padding: "10px 14px",
        boxShadow: "0 8px 30px rgba(0,0,0,0.4)",
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--nhid-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
          {label}
        </div>
        <div style={{ fontSize: 16, fontWeight: 800, color: "var(--nhid-teal)" }}>
          {payload[0].value.toLocaleString()}
        </div>
        <div style={{ fontSize: 10, color: "var(--nhid-muted)" }}>requests</div>
      </div>
    );
  }
  return null;
};

export default function Usage() {
  const { data: usage, isLoading } = useGetUsage();

  if (isLoading) {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <div>
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} style={{ height: 100, borderRadius: 14 }} />)}
        </div>
        <Skeleton style={{ height: 360, borderRadius: 14 }} />
      </div>
    );
  }

  if (!usage) return null;

  const chartData = usage.by_endpoint.map(e => ({
    name: e.endpoint.replace("/saas/", "").replace("/saas-api/saas/", ""),
    count: e.count,
    full: e.endpoint,
  }));

  const remaining = usage.rate_limit.remaining;
  const limit = usage.rate_limit.limit;
  const quotaPct = limit ? Math.min(((limit - (remaining ?? limit)) / limit) * 100, 100) : 0;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-400">
      {/* Header */}
      <div>
        <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--nhid-text)", letterSpacing: "-0.02em", marginBottom: 4 }}>
          Usage Analytics
        </h1>
        <p style={{ fontSize: 13, color: "var(--nhid-muted)" }}>
          Detailed metrics across all API endpoints for your organization.
        </p>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Total Requests"
          value={usage.total_requests.toLocaleString()}
          sub="All time"
          icon={Server}
          accent
        />
        <MetricCard
          label="Today"
          value={usage.today_requests.toLocaleString()}
          sub="Since midnight UTC"
          icon={Clock}
        />
        <MetricCard
          label="Endpoints"
          value={usage.by_endpoint.length}
          sub="Distinct routes called"
          icon={Activity}
        />
        <MetricCard
          label="Daily Remaining"
          value={remaining !== null ? remaining.toLocaleString() : "∞"}
          sub={limit ? `of ${limit.toLocaleString()}` : "Unlimited"}
          icon={Zap}
          accent={quotaPct > 70}
        />
      </div>

      {/* Chart + breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Bar chart */}
        <GlassCard style={{ padding: "22px", gridColumn: "span 2" }}>
          <div style={{ marginBottom: 18 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--nhid-text)", marginBottom: 3 }}>
              Endpoint Distribution
            </div>
            <div style={{ fontSize: 11, color: "var(--nhid-muted)" }}>Request volume by API route</div>
          </div>
          {chartData.length > 0 ? (
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 5, right: 5, left: -18, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="1 4" vertical={false} stroke="rgba(255,255,255,0.04)" />
                  <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fill: "var(--nhid-muted)", fontFamily: "monospace" }}
                    interval={0}
                    angle={chartData.length > 4 ? -35 : 0}
                    textAnchor={chartData.length > 4 ? "end" : "middle"}
                    height={chartData.length > 4 ? 60 : 20}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fill: "var(--nhid-muted)" }}
                    width={32}
                  />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(0,194,168,0.04)" }} />
                  <Bar dataKey="count" radius={[5, 5, 0, 0]} maxBarSize={44}>
                    {chartData.map((_, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={index === 0 ? "url(#tealGradient)" : "rgba(0,194,168,0.5)"}
                      />
                    ))}
                  </Bar>
                  <defs>
                    <linearGradient id="tealGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#53d8fb" />
                      <stop offset="100%" stopColor="#00c2a8" />
                    </linearGradient>
                  </defs>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div style={{
              height: 280, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center",
              border: "1px dashed var(--nhid-border)", borderRadius: 10,
              color: "var(--nhid-muted)",
            }}>
              <Activity size={28} style={{ opacity: 0.3, marginBottom: 10 }} />
              <div style={{ fontSize: 13 }}>No data to display yet</div>
              <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>Make API calls to see usage here</div>
            </div>
          )}
        </GlassCard>

        {/* Breakdown table */}
        <GlassCard style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "18px 20px 14px", borderBottom: "1px solid var(--nhid-border)" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--nhid-text)", marginBottom: 2 }}>
              Breakdown
            </div>
            <div style={{ fontSize: 11, color: "var(--nhid-muted)" }}>Exact request counts</div>
          </div>

          {/* Quota bar */}
          {limit && (
            <div style={{ padding: "12px 20px", borderBottom: "1px solid var(--nhid-border)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 10, color: "var(--nhid-muted)", fontWeight: 600 }}>Daily Quota</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: quotaPct > 70 ? "#ef4444" : "var(--nhid-teal)" }}>
                  {Math.round(quotaPct)}%
                </span>
              </div>
              <div style={{ height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{
                  height: "100%", borderRadius: 2, transition: "width 0.5s ease",
                  width: `${quotaPct}%`,
                  background: quotaPct > 80
                    ? "linear-gradient(90deg, #ef4444, #f87171)"
                    : "linear-gradient(90deg, var(--nhid-teal), var(--nhid-cyan))",
                }} />
              </div>
            </div>
          )}

          <div style={{ flex: 1, overflowY: "auto" }}>
            {usage.by_endpoint.length > 0 ? (
              <>
                {/* Header */}
                <div style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between",
                  padding: "8px 20px",
                  fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em",
                  color: "var(--nhid-muted)", background: "rgba(255,255,255,0.01)",
                }}>
                  <span>Endpoint</span>
                  <span>Count</span>
                </div>
                {usage.by_endpoint.map((row, i) => {
                  const pct = usage.total_requests > 0 ? (row.count / usage.total_requests) * 100 : 0;
                  return (
                    <div
                      key={row.endpoint}
                      style={{
                        padding: "10px 20px",
                        borderTop: i > 0 ? "1px solid rgba(255,255,255,0.03)" : "none",
                        display: "flex", flexDirection: "column", gap: 5,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <code style={{ fontSize: 10, color: "var(--nhid-text)", fontFamily: "monospace", fontWeight: 500 }}>
                          {row.endpoint.replace("/saas/", "").replace("/saas-api/saas/", "")}
                        </code>
                        <span style={{ fontSize: 12, fontWeight: 800, color: "var(--nhid-teal)", flexShrink: 0, marginLeft: 8 }}>
                          {row.count.toLocaleString()}
                        </span>
                      </div>
                      <div style={{ height: 3, background: "rgba(255,255,255,0.05)", borderRadius: 2, overflow: "hidden" }}>
                        <div style={{
                          height: "100%", borderRadius: 2, width: `${pct}%`,
                          background: "linear-gradient(90deg, var(--nhid-teal), var(--nhid-cyan))",
                          opacity: 0.7,
                        }} />
                      </div>
                    </div>
                  );
                })}
              </>
            ) : (
              <div style={{
                padding: "40px 20px", textAlign: "center",
                fontSize: 12, color: "var(--nhid-muted)",
              }}>
                No requests yet
              </div>
            )}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
