import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  ClipboardCheck, Shield, Search, BarChart2,
  X, Menu, LogIn, ChevronRight, LogOut, Activity, CreditCard, ShieldCheck, Zap, Settings2,
} from "lucide-react";
import { useApiKey } from "@/hooks/use-nhid";
import { apiUrl } from "@/lib/config";

const NHIDLogoMark = ({ size = 32 }: { size?: number }) => (
  <div
    style={{
      width: size, height: size, borderRadius: Math.round(size * 0.28),
      background: "#1769aa",
      display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0,
      boxShadow: "0 2px 6px rgba(23,105,170,0.18)",
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      fontWeight: 900,
      fontSize: Math.round(size * 0.44),
      color: "#070c17",
      letterSpacing: "-0.02em",
      userSelect: "none",
    }}
  >
    N
  </div>
);

const NAV_ITEMS = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard, desc: "Overview & metrics" },
  { name: "Governance Ops", href: "/ops", icon: ClipboardCheck, desc: "Monitor interactions, work findings" },
  { name: "Audit Trail", href: "/audit", icon: ShieldCheck, desc: "Explore & verify sessions" },
  { name: "Submit Event", href: "/trace", icon: Shield, desc: "Ingest a new audit event" },
  { name: "Proof Lookup", href: "/proof", icon: Search, desc: "Lightweight session proof" },
  { name: "Usage", href: "/usage", icon: BarChart2, desc: "API usage stats" },
  { name: "Billing", href: "/billing", icon: CreditCard, desc: "Plans & upgrade" },
  { name: "Settings", href: "/settings", icon: Settings2, desc: "API key, plan, preferences" },
];

function StatusDot({ status }: { status: "up" | "down" | "unknown" }) {
  const color = status === "up" ? "#1769aa" : status === "down" ? "#ef4444" : "#94a3b8";
  return (
    <span
      style={{
        width: 6, height: 6, borderRadius: "50%",
        background: color, display: "inline-block",
        boxShadow: status === "up" ? `0 0 6px ${color}` : "none",
        flexShrink: 0,
        transition: "background 0.3s",
      }}
    />
  );
}

/**
 * Probe the gateway, but only where there is a gateway to probe.
 *
 * `enabled` is false in the recorded demonstration, where no backend is
 * configured at all. Probing there would fail and the panel would report
 * "DOWN" in red for services that are not down -- they are absent by design.
 * Claiming an outage nobody observed is the same error this product exists to
 * catch in a governance record, so the panel says "—" (unknown) instead.
 */
function useHealthStatus(enabled: boolean) {
  const [status, setStatus] = useState<{
    nhid: "up" | "down" | "unknown";
    saas: "up" | "down" | "unknown";
    stripe: "up" | "down" | "unknown";
  }>({ nhid: "unknown", saas: "unknown", stripe: "unknown" });

  useEffect(() => {
    if (!enabled) {
      setStatus({ nhid: "unknown", saas: "unknown", stripe: "unknown" });
      return;
    }
    const check = async () => {
      try {
        const res = await fetch(apiUrl("/health"));
        if (!res.ok) throw new Error();
        const data = await res.json();
        setStatus({
          nhid: data.nhid_core === "in-process" ? "up" : "down",
          saas: data.status === "ok" ? "up" : "down",
          stripe: data.stripe !== "missing" ? "up" : "down",
        });
      } catch {
        setStatus({ nhid: "down", saas: "down", stripe: "unknown" });
      }
    };
    check();
    const interval = setInterval(check, 60_000);
    return () => clearInterval(interval);
  }, [enabled]);

  return status;
}

function useOrgName() {
  const [orgName, setOrgName] = useState<string>("");
  useEffect(() => {
    const read = () => {
      try {
        const stored = localStorage.getItem("nhid_org");
        if (stored) setOrgName(JSON.parse(stored).org_name ?? "");
      } catch { setOrgName(""); }
    };
    read();
    window.addEventListener("storage", read);
    return () => window.removeEventListener("storage", read);
  }, []);
  return orgName;
}

function clearOrgSession() {
  localStorage.removeItem("nhid_api_key");
  localStorage.removeItem("nhid_org");
  window.dispatchEvent(new Event("storage"));
}

function SidebarContent({
  location,
  apiKey,
  onClose,
}: {
  location: string;
  apiKey: string | null;
  onClose?: () => void;
}) {
  const health = useHealthStatus(!!apiKey);
  const orgName = useOrgName();

  const STATUS_ITEMS = [
    { label: "NHID Core", status: health.nhid },
    { label: "SaaS Layer", status: health.saas },
    { label: "Stripe", status: health.stripe },
  ] as const;

  return (
    <div
      style={{
        display: "flex", flexDirection: "column", height: "100%",
        background: "#ffffff",
      }}
    >
      {/* Logo */}
      <div
        style={{
          padding: "22px 20px 18px",
          borderBottom: "1px solid #dfe5ec",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <NHIDLogoMark size={34} />
          <div>
            <div
              style={{
                fontWeight: 800, fontSize: 13, letterSpacing: "0.04em",
                color: "#172b4d", lineHeight: 1.2,
              }}
            >
              NHID Clinical
            </div>
            <div
              style={{
                fontSize: 9, fontWeight: 600, color: "#5f6b7a",
                letterSpacing: "0.14em", textTransform: "uppercase",
              }}
            >
              Audit Platform
            </div>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "#5f6b7a", padding: 4,
            }}
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Org card */}
      {apiKey && (
        <div style={{ padding: "12px 14px 6px" }}>
          <div
            style={{
              background: "var(--nhid-surface)",
              border: "1px solid #dfe5ec",
              borderRadius: 10, padding: "10px 12px",
            }}
          >
            <div style={{ fontSize: 10, color: "#5f6b7a", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600 }}>
              Workspace
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "#172b4d", marginBottom: 3 }}>
              {orgName || "Loading…"}
            </div>
            <div
              style={{
                fontSize: 9, fontFamily: "monospace", color: "#1769aa",
                opacity: 0.8,
              }}
            >
              {`Key: •••${apiKey.slice(-6)}`}
            </div>
          </div>
        </div>
      )}

      {/* Nav */}
      <nav style={{ flex: 1, padding: "8px 10px", overflowY: "auto" }}>
        {NAV_ITEMS.map((item) => {
          const isActive = location === item.href;
          const Icon = item.icon;
          return (
            <Link
              key={item.name}
              href={item.href}
              onClick={onClose}
              data-testid={`nav-${item.name.toLowerCase().replace(" ", "-")}`}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "9px 12px", borderRadius: 9, marginBottom: 2,
                textDecoration: "none",
                background: isActive ? "rgba(23,105,170,0.09)" : "transparent",
                border: `1px solid ${isActive ? "rgba(23,105,170,0.25)" : "transparent"}`,
                color: isActive ? "#1769aa" : "#5f6b7a",
                transition: "all 0.15s ease",
                cursor: "pointer",
              }}
              className={!isActive ? "hover:text-foreground" : ""}
            >
              <Icon
                size={15}
                style={{ flexShrink: 0, opacity: isActive ? 1 : 0.7 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 13, fontWeight: isActive ? 700 : 500,
                    letterSpacing: "0.01em",
                  }}
                >
                  {item.name}
                </div>
                {!isActive && (
                  <div style={{ fontSize: 9, color: "#5f6b7a", opacity: 0.6, marginTop: 1 }}>
                    {item.desc}
                  </div>
                )}
              </div>
              {isActive && (
                <span
                  style={{
                    width: 5, height: 5, borderRadius: "50%",
                    background: "#1769aa",
                    boxShadow: "0 0 6px #1769aa",
                    flexShrink: 0,
                  }}
                />
              )}
            </Link>
          );
        })}

        {/* Try Demo */}
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          <Link
            href="/try"
            onClick={onClose}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "9px 12px", borderRadius: 9, marginBottom: 2,
              textDecoration: "none",
              background: "rgba(23,105,170,0.055)",
              border: "1px solid rgba(23,105,170,0.18)",
              color: "#1769aa",
              transition: "all 0.15s ease",
              cursor: "pointer",
            }}
          >
            <Zap size={14} style={{ flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>Try Demo</div>
              <div style={{ fontSize: 9, opacity: 0.6, marginTop: 1 }}>No account needed</div>
            </div>
          </Link>
        </div>

        {/* Admin link */}
        <div style={{ marginTop: 2, paddingTop: 2 }}>
          <Link
            href="/admin"
            onClick={onClose}
            data-testid="nav-admin"
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "9px 12px", borderRadius: 9,
              textDecoration: "none",
              background: location === "/admin" ? "rgba(36,119,200,0.09)" : "transparent",
              border: `1px solid ${location === "/admin" ? "rgba(36,119,200,0.25)" : "transparent"}`,
              color: location === "/admin" ? "#2477c8" : "#5f6b7a",
              transition: "all 0.15s ease",
              cursor: "pointer",
            }}
          >
            <LogIn size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Admin</div>
              <div style={{ fontSize: 9, color: "#5f6b7a", opacity: 0.6, marginTop: 1 }}>Operations console</div>
            </div>
            <ChevronRight size={11} style={{ opacity: 0.4 }} />
          </Link>

          {/* Sign out */}
          <button
            onClick={() => { clearOrgSession(); onClose?.(); }}
            data-testid="btn-signout"
            style={{
              width: "100%", display: "flex", alignItems: "center", gap: 10,
              padding: "9px 12px", borderRadius: 9, marginTop: 2,
              background: "none", border: "1px solid transparent",
              color: "#5f6b7a", cursor: "pointer",
              textAlign: "left", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.background = "rgba(239,68,68,0.07)";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(239,68,68,0.2)";
              (e.currentTarget as HTMLButtonElement).style.color = "#f87171";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = "none";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "transparent";
              (e.currentTarget as HTMLButtonElement).style.color = "#5f6b7a";
            }}
          >
            <LogOut size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Sign Out</div>
              <div style={{ fontSize: 9, opacity: 0.6, marginTop: 1 }}>Clear session</div>
            </div>
          </button>
        </div>
      </nav>

      {/* System status — now dynamic */}
      <div
        style={{
          padding: "14px 16px",
          borderTop: "1px solid #dfe5ec",
        }}
      >
        <div
          style={{
            fontSize: 9, color: "#5f6b7a", textTransform: "uppercase",
            letterSpacing: "0.12em", fontWeight: 700, marginBottom: 10,
          }}
        >
          System Status
        </div>
        {STATUS_ITEMS.map((s) => (
          <div
            key={s.label}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              marginBottom: 7,
            }}
          >
            <span style={{ fontSize: 11, color: "#5f6b7a" }}>{s.label}</span>
            <span
              style={{
                display: "flex", alignItems: "center", gap: 5,
                fontSize: 10,
                color: s.status === "up" ? "#1769aa" : s.status === "down" ? "#ef4444" : "#94a3b8",
                fontWeight: 700,
                letterSpacing: "0.06em",
              }}
            >
              <StatusDot status={s.status} />
              {s.status === "up" ? "UP" : s.status === "down" ? "DOWN" : "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const apiKey = useApiKey();
  const [mobileOpen, setMobileOpen] = useState(false);

  // The chrome normally appears only once a visitor has a key, because every
  // screen behind it needed one. The Ops screens no longer do: with no key they
  // render a recorded demonstration, and without the sidebar they would arrive
  // with no navigation between them and no way back. SidebarContent already
  // handles a null key -- it simply omits the key and organization panels.
  const inOps = location === "/ops" || location.startsWith("/ops/");
  if (!apiKey && !inOps) return <>{children}</>;

  return (
    <div
      style={{ display: "flex", minHeight: "100dvh", width: "100%", background: "#f4f6f9" }}
    >
      {/* Desktop sidebar */}
      <aside
        style={{
          width: 230, flexShrink: 0,
          borderRight: "1px solid #dfe5ec",
          display: "flex", flexDirection: "column",
          position: "sticky", top: 0, height: "100dvh",
          overflowY: "auto",
        }}
        className="hidden md:flex"
      >
        <SidebarContent location={location} apiKey={apiKey} />
      </aside>

      {/* Mobile drawer overlay */}
      {mobileOpen && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 50,
            display: "flex",
          }}
          className="md:hidden"
        >
          <div
            style={{ flex: 1, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
            onClick={() => setMobileOpen(false)}
          />
          <aside
            style={{
              width: 240, background: "#f4f6f9",
              borderLeft: "1px solid #dfe5ec",
              height: "100%", overflowY: "auto",
              display: "flex", flexDirection: "column",
            }}
          >
            <SidebarContent
              location={location}
              apiKey={apiKey}
              onClose={() => setMobileOpen(false)}
            />
          </aside>
        </div>
      )}

      {/* Main */}
      <main style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
        {/* Topbar */}
        <header
          style={{
            height: 56, flexShrink: 0,
            borderBottom: "1px solid #dfe5ec",
            background: "rgba(255,255,255,0.96)",
            backdropFilter: "blur(12px)",
            display: "flex", alignItems: "center",
            padding: "0 20px", gap: 12,
            position: "sticky", top: 0, zIndex: 20,
          }}
        >
          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen(true)}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "#5f6b7a", padding: 4,
            }}
            className="md:hidden"
          >
            <Menu size={18} />
          </button>

          {/* Mobile logo */}
          <div className="flex items-center gap-2 md:hidden">
            <NHIDLogoMark size={26} />
          </div>

          <div style={{ flex: 1 }} />

          {/* Right side */}
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              style={{
                display: "flex", alignItems: "center", gap: 6,
                fontSize: 11, color: "#5f6b7a",
              }}
            >
              <Activity size={11} style={{ color: "#1769aa" }} />
              <span style={{ fontFamily: "monospace", fontSize: 10 }}>
                {apiKey ? `•••${apiKey.slice(-4)}` : "—"}
              </span>
            </div>

            {/* Sign out on mobile top bar */}
            <button
              onClick={() => { clearOrgSession(); }}
              title="Sign out"
              className="md:hidden"
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: "#5f6b7a", padding: 4,
              }}
            >
              <LogOut size={15} />
            </button>
          </div>
        </header>

        {/* Content */}
        <div
          style={{
            flex: 1, overflowY: "auto", padding: "28px 24px",
          }}
          className="md:px-10"
        >
          <div style={{ maxWidth: 1280, margin: "0 auto" }}>
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
