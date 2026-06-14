import { useState, useEffect } from "react";
import { Link } from "wouter";
import { CheckCircle, Zap, Shield, Server, Gift, ArrowRight, Loader2, ExternalLink } from "lucide-react";

interface StripePlan {
  price_id: string;
  plan: string;
  name: string;
  amount_cents: number;
  currency: string;
  interval: string;
}

const FREE_TIER = {
  plan: "free",
  name: "Free",
  dollars: "$0",
  interval: "/month",
  features: [
    "100 audit events/day",
    "10 req/min",
    "Tamper-evident SHA-256 chain",
    "Simulated voice testing",
    "Chain verification",
    "Community support",
  ],
  cta: "Get Started Free",
  ctaHref: "/",
  highlight: false,
  icon: Gift,
  accent: "#64748b",
};

const PLAN_META: Record<string, { features: string[]; highlight: boolean; icon: React.ElementType; accent: string }> = {
  l1: {
    features: [
      "10,000 audit events/day",
      "100 req/min",
      "SHA-256 chain proofs",
      "Simulated voice testing",
      "Replay & policy engine",
      "Email support",
    ],
    highlight: false,
    icon: Zap,
    accent: "#00c2a8",
  },
  l2: {
    features: [
      "100,000 audit events/day",
      "500 req/min",
      "SHA-256 chain proofs",
      "Live voice: Retell, Vapi, Twilio",
      "Usage analytics dashboard",
      "Priority support",
    ],
    highlight: true,
    icon: Shield,
    accent: "#53d8fb",
  },
  l3: {
    features: [
      "Unlimited audit events",
      "2,000 req/min",
      "SHA-256 chain proofs",
      "Live voice integrations",
      "Enterprise SLA guarantee",
      "Dedicated support + onboarding",
    ],
    highlight: false,
    icon: Server,
    accent: "#a78bfa",
  },
};

const NHIDLogoMark = ({ size = 32 }: { size?: number }) => (
  <div
    style={{
      width: size, height: size, borderRadius: Math.round(size * 0.28),
      background: "linear-gradient(135deg, #00c2a8, #53d8fb)",
      display: "flex", alignItems: "center", justifyContent: "center",
      boxShadow: "0 0 16px rgba(0,194,168,0.4)",
      fontFamily: "'Raleway', sans-serif",
      fontWeight: 900, fontSize: Math.round(size * 0.44),
      color: "#070c17", letterSpacing: "-0.02em", userSelect: "none",
      flexShrink: 0,
    }}
  >
    N
  </div>
);

export default function PricingPage() {
  const [plans, setPlans] = useState<StripePlan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/saas-api/saas/billing/plans")
      .then(r => r.json())
      .then(data => setPlans(data.plans ?? []))
      .catch(() => setPlans([]))
      .finally(() => setLoading(false));
  }, []);

  const orderedKeys = ["free", "l1", "l2", "l3"];

  type PricingCard = {
    key: string;
    name: string;
    dollars: string;
    interval: string;
    features: string[];
    highlight: boolean;
    icon: React.ElementType;
    accent: string;
    cta: string;
    ctaHref: string;
    priceId?: string;
  };

  const cards: PricingCard[] = orderedKeys.map(key => {
    if (key === "free") return { key, ...FREE_TIER };
    const stripe = plans.find(p => p.plan.toLowerCase() === key);
    const meta = PLAN_META[key] ?? { features: [], highlight: false, icon: Zap, accent: "#00c2a8" };
    const dollars = stripe
      ? ((stripe.amount_cents ?? 0) / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })
      : key === "l1" ? "$99" : key === "l2" ? "$499" : "$2,500";
    return {
      key,
      name: stripe?.name ?? key.toUpperCase(),
      dollars,
      interval: `/${stripe?.interval ?? "month"}`,
      features: meta.features,
      highlight: meta.highlight,
      icon: meta.icon,
      accent: meta.accent,
      cta: "Get Started",
      ctaHref: "/",
      priceId: stripe?.price_id,
    };
  });

  return (
    <div style={{ minHeight: "100vh", background: "#070c17", color: "#f1f5f9", fontFamily: "'Inter', sans-serif" }}>
      {/* Nav */}
      <header style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "18px 32px", borderBottom: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(7,12,23,0.85)", backdropFilter: "blur(12px)",
        position: "sticky", top: 0, zIndex: 20,
      }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
          <NHIDLogoMark size={30} />
          <span style={{ fontWeight: 800, fontSize: 14, color: "#f1f5f9", letterSpacing: "0.01em" }}>NHID Clinical</span>
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Link href="/try" style={{ color: "#64748b", fontSize: 13, fontWeight: 500, textDecoration: "none" }}>
            Try Demo
          </Link>
          <Link href="/" style={{
            background: "linear-gradient(135deg, #00c2a8, #53d8fb)",
            color: "#070c17", borderRadius: 8, padding: "7px 16px",
            fontSize: 13, fontWeight: 700, textDecoration: "none",
            letterSpacing: "-0.01em",
          }}>
            Sign In
          </Link>
        </div>
      </header>

      {/* Hero */}
      <div style={{ textAlign: "center", padding: "64px 24px 48px", maxWidth: 640, margin: "0 auto" }}>
        <div style={{
          display: "inline-block", fontSize: 11, fontWeight: 700,
          letterSpacing: "0.12em", textTransform: "uppercase",
          color: "#00c2a8", background: "rgba(0,194,168,0.08)",
          border: "1px solid rgba(0,194,168,0.22)", borderRadius: 20,
          padding: "5px 14px", marginBottom: 20,
        }}>
          Open Core + Hosted API
        </div>
        <h1 style={{ fontSize: "clamp(28px, 5vw, 42px)", fontWeight: 900, margin: "0 0 16px", letterSpacing: "-0.03em", lineHeight: 1.1 }}>
          Simple, transparent pricing
        </h1>
        <p style={{ color: "#64748b", fontSize: 15, lineHeight: 1.6, margin: 0 }}>
          The NHID-Clinical spec and policy engine are{" "}
          <a href="https://nhid-clinical.org" target="_blank" rel="noreferrer" style={{ color: "#00c2a8", textDecoration: "none" }}>
            open source (CC BY 4.0) <ExternalLink size={11} style={{ display: "inline", verticalAlign: "middle" }} />
          </a>.
          {" "}The hosted API, compliance dashboard, and live voice integrations are paid.
        </p>
      </div>

      {/* Plan cards */}
      <div style={{ maxWidth: 1080, margin: "0 auto", padding: "0 24px 80px" }}>
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 80, color: "#334155" }}>
            <Loader2 size={24} style={{ animation: "spin 1s linear infinite" }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
            {cards.map(card => {
              const Icon = card.icon;
              return (
                <div
                  key={card.key}
                  style={{
                    background: card.highlight
                      ? "linear-gradient(160deg, rgba(83,216,251,0.07), rgba(0,194,168,0.04))"
                      : "rgba(255,255,255,0.025)",
                    border: `1px solid ${card.highlight ? "rgba(83,216,251,0.35)" : "rgba(255,255,255,0.07)"}`,
                    borderRadius: 16,
                    padding: "24px 20px",
                    display: "flex", flexDirection: "column",
                    position: "relative",
                    transition: "border-color 0.2s",
                  }}
                >
                  {card.highlight && (
                    <div style={{
                      position: "absolute", top: -1, left: "50%", transform: "translateX(-50%)",
                      background: "linear-gradient(135deg, #00c2a8, #53d8fb)",
                      color: "#070c17", fontSize: 9, fontWeight: 800,
                      letterSpacing: "0.1em", textTransform: "uppercase",
                      padding: "3px 12px", borderRadius: "0 0 8px 8px",
                      whiteSpace: "nowrap",
                    }}>
                      Most Popular
                    </div>
                  )}

                  {/* Icon + name */}
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: 10,
                      background: `${card.accent}18`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                      <Icon size={16} style={{ color: card.accent }} />
                    </div>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: "#f1f5f9" }}>{card.name}</div>
                      <div style={{ fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>
                        {card.key === "free" ? "Always free" : card.key.toUpperCase()}
                      </div>
                    </div>
                  </div>

                  {/* Price */}
                  <div style={{ marginBottom: 20 }}>
                    <span style={{ fontSize: 30, fontWeight: 900, color: "#f1f5f9", letterSpacing: "-0.03em" }}>
                      {card.dollars}
                    </span>
                    <span style={{ fontSize: 12, color: "#475569", marginLeft: 4 }}>{card.interval}</span>
                  </div>

                  {/* Features */}
                  <ul style={{ margin: "0 0 24px", padding: 0, listStyle: "none", flex: 1 }}>
                    {card.features.map(f => (
                      <li key={f} style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 9 }}>
                        <CheckCircle size={13} style={{ color: card.accent, flexShrink: 0, marginTop: 1 }} />
                        <span style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.4 }}>{f}</span>
                      </li>
                    ))}
                  </ul>

                  {/* CTA */}
                  <Link
                    href={card.ctaHref}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                      padding: "11px", borderRadius: 10, textDecoration: "none",
                      background: card.highlight
                        ? "linear-gradient(135deg, #00c2a8, #53d8fb)"
                        : "rgba(255,255,255,0.06)",
                      border: card.highlight ? "none" : "1px solid rgba(255,255,255,0.1)",
                      color: card.highlight ? "#070c17" : "#cbd5e1",
                      fontSize: 13, fontWeight: 700,
                      letterSpacing: "-0.01em",
                      transition: "opacity 0.15s",
                      boxShadow: card.highlight ? "0 0 20px rgba(0,194,168,0.3)" : "none",
                    }}
                  >
                    {card.cta} <ArrowRight size={13} />
                  </Link>
                </div>
              );
            })}
          </div>
        )}

        {/* FAQ row */}
        <div style={{ marginTop: 56, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 24 }}>
          {[
            {
              q: "Is the policy engine really open source?",
              a: "Yes. The NHID-Clinical spec (CC BY 4.0), Python policy engine, and 18-case conformance test suite are all publicly available on GitHub and free to run.",
            },
            {
              q: "What's included in 'hosted API'?",
              a: "A managed FastAPI endpoint, PostgreSQL audit chain, HMAC tamper-evidence, Stripe billing, and voice webhook normalization for Retell, Vapi, and Twilio.",
            },
            {
              q: "Do I need a credit card for the free tier?",
              a: "No. Create a workspace with just your org name and get an API key instantly. Upgrade to a paid plan at any time from your dashboard.",
            },
            {
              q: "What is a compliance badge?",
              a: "A dynamic SVG you embed in your docs. It shows your verified NHID tier (L1/L2/L3) in real time. Available on paid plans.",
            },
          ].map(item => (
            <div key={item.q} style={{
              background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
              borderRadius: 12, padding: "20px 18px",
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", marginBottom: 8, lineHeight: 1.3 }}>
                {item.q}
              </div>
              <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6 }}>{item.a}</div>
            </div>
          ))}
        </div>

        <p style={{ textAlign: "center", marginTop: 40, fontSize: 12, color: "#334155" }}>
          Enterprise custom contracts, pilot programs, and academic access available.{" "}
          <a href="mailto:hello@nhid-clinical.org" style={{ color: "#00c2a8", textDecoration: "none" }}>
            Contact us
          </a>
        </p>
      </div>
    </div>
  );
}
