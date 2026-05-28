import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Activity, Shield, Search, BarChart2,
  Settings2, X, Menu, LogIn, ChevronRight
} from "lucide-react";
import { useApiKey } from "@/hooks/use-nhid";

const NHIDLogoMark = ({ size = 32 }: { size?: number }) => (
  <div
    style={{
      width: size, height: size, borderRadius: Math.round(size * 0.28),
      background: "linear-gradient(135deg, #00c2a8, #53d8fb)",
      display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0,
      boxShadow: "0 0 16px rgba(0,194,168,0.4)",
      fontFamily: "'Raleway', sans-serif",
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
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Audit Trail", href: "/trace", icon: Shield },
  { name: "Verification", href: "/proof", icon: Search },
  { name: "Usage", href: "/usage", icon: BarChart2 },
];

const STATUS_ITEMS = [
  { label: "NHID Core", color: "#00c2a8" },
  { label: "SaaS Layer", color: "#00c2a8" },
  { label: "Stripe", color: "#00c2a8" },
];

function StatusDot({ color }: { color: string }) {
  return (
    <span
      style={{
        width: 6, height: 6, borderRadius: "50%",
        background: color, display: "inline-block",
        boxShadow: `0 0 6px ${color}`,
        flexShrink: 0,
      }}
    />
  );
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
  return (
    <div
      style={{
        display: "flex", flexDirection: "column", height: "100%",
        background: "linear-gradient(180deg, rgba(0,194,168,0.05) 0%, transparent 35%)",
      }}
    >
      {/* Logo */}
      <div
        style={{
          padding: "22px 20px 18px",
          borderBottom: "1px solid var(--nhid-border)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <NHIDLogoMark size={34} />
          <div>
            <div
              style={{
                fontWeight: 800, fontSize: 13, letterSpacing: "0.04em",
                color: "var(--nhid-text)", lineHeight: 1.2,
              }}
            >
              NHID Clinical
            </div>
            <div
              style={{
                fontSize: 9, fontWeight: 600, color: "var(--nhid-muted)",
                letterSpacing: "0.14em", textTransform: "uppercase",
              }}
            >
              Control Plane
            </div>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "var(--nhid-muted)", padding: 4,
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
              border: "1px solid var(--nhid-border)",
              borderRadius: 10, padding: "10px 12px",
            }}
          >
            <div style={{ fontSize: 10, color: "var(--nhid-muted)", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600 }}>
              Workspace
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--nhid-text)" }}>
              Active Session
            </div>
            <div
              style={{
                fontSize: 9, fontFamily: "monospace", color: "var(--nhid-teal)",
                marginTop: 4, opacity: 0.8,
              }}
            >
              {`…${apiKey.slice(-8)}`}
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
              data-testid={`nav-${item.name.toLowerCase()}`}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "9px 12px", borderRadius: 9, marginBottom: 2,
                textDecoration: "none",
                background: isActive ? "rgba(0,194,168,0.12)" : "transparent",
                border: `1px solid ${isActive ? "rgba(0,194,168,0.28)" : "transparent"}`,
                color: isActive ? "var(--nhid-teal)" : "var(--nhid-muted)",
                transition: "all 0.15s ease",
                cursor: "pointer",
              }}
              className={!isActive ? "hover:text-foreground" : ""}
            >
              <Icon
                size={15}
                style={{ flexShrink: 0, opacity: isActive ? 1 : 0.7 }}
              />
              <span
                style={{
                  fontSize: 13, fontWeight: isActive ? 700 : 500,
                  letterSpacing: "0.01em", flex: 1,
                }}
              >
                {item.name}
              </span>
              {isActive && (
                <span
                  style={{
                    width: 5, height: 5, borderRadius: "50%",
                    background: "var(--nhid-teal)",
                    boxShadow: "0 0 6px var(--nhid-teal)",
                  }}
                />
              )}
            </Link>
          );
        })}

        {/* Admin link */}
        <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid rgba(255,255,255,0.05)" }}>
          <Link
            href="/admin"
            onClick={onClose}
            data-testid="nav-admin"
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "9px 12px", borderRadius: 9,
              textDecoration: "none",
              background: location === "/admin" ? "rgba(83,216,251,0.1)" : "transparent",
              border: `1px solid ${location === "/admin" ? "rgba(83,216,251,0.25)" : "transparent"}`,
              color: location === "/admin" ? "var(--nhid-cyan)" : "var(--nhid-muted)",
              transition: "all 0.15s ease",
              cursor: "pointer",
            }}
          >
            <LogIn size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
            <span style={{ fontSize: 13, fontWeight: 500 }}>Admin</span>
            <ChevronRight size={11} style={{ marginLeft: "auto", opacity: 0.4 }} />
          </Link>
        </div>
      </nav>

      {/* System status */}
      <div
        style={{
          padding: "14px 16px",
          borderTop: "1px solid var(--nhid-border)",
        }}
      >
        <div
          style={{
            fontSize: 9, color: "var(--nhid-muted)", textTransform: "uppercase",
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
            <span style={{ fontSize: 11, color: "var(--nhid-muted)" }}>{s.label}</span>
            <span
              style={{
                display: "flex", alignItems: "center", gap: 5,
                fontSize: 10, color: s.color, fontWeight: 700,
                letterSpacing: "0.06em",
              }}
            >
              <StatusDot color={s.color} />
              UP
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

  if (!apiKey) return <>{children}</>;

  return (
    <div
      style={{ display: "flex", minHeight: "100dvh", width: "100%", background: "var(--nhid-bg)" }}
    >
      {/* Desktop sidebar */}
      <aside
        style={{
          width: 230, flexShrink: 0,
          borderRight: "1px solid var(--nhid-border)",
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
              width: 240, background: "var(--nhid-bg)",
              borderLeft: "1px solid var(--nhid-border)",
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
            borderBottom: "1px solid var(--nhid-border)",
            background: "rgba(7,12,23,0.85)",
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
              color: "var(--nhid-muted)", padding: 4,
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
                fontSize: 11, color: "var(--nhid-muted)",
              }}
            >
              <StatusDot color="#00c2a8" />
              <span style={{ fontFamily: "monospace", fontSize: 10 }}>
                {apiKey ? `•••${apiKey.slice(-4)}` : "—"}
              </span>
            </div>
            <div
              style={{
                width: 30, height: 30, borderRadius: "50%",
                background: "linear-gradient(135deg, #00c2a8, #53d8fb)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 12, fontWeight: 900, color: "#070c17",
                flexShrink: 0,
              }}
            >
              {String.fromCharCode(65 + Math.floor(Math.random() * 0))}N
            </div>
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
