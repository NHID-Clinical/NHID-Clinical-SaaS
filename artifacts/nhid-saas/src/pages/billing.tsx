import { useState, useEffect } from "react";
import { CreditCard, Zap, Shield, Server, CheckCircle, ArrowRight, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Plan {
  price_id: string;
  plan: string;
  name: string;
  amount_cents: number;
  currency: string;
  interval: string;
}

const PLAN_ORDER = ["l1", "l2", "l3"];

const PLAN_FEATURES: Record<string, string[]> = {
  l1: ["10,000 events/day", "100 req/min", "SHA-256 chain proofs", "Email support"],
  l2: ["100,000 events/day", "500 req/min", "SHA-256 chain proofs", "Priority support", "Usage analytics"],
  l3: ["Unlimited events", "2,000 req/min", "SHA-256 chain proofs", "Dedicated support", "SLA guarantee", "Custom retention"],
};

const PLAN_ICONS: Record<string, React.ElementType> = {
  l1: Zap,
  l2: Shield,
  l3: Server,
};

function getPlanRank(plan: string): number {
  return PLAN_ORDER.indexOf(plan.toLowerCase());
}

export default function Billing() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkingOut, setCheckingOut] = useState<string | null>(null);
  const [currentPlan, setCurrentPlan] = useState<string>("free");
  const { toast } = useToast();

  useEffect(() => {
    const stored = localStorage.getItem("nhid_org");
    if (stored) {
      try {
        const org = JSON.parse(stored);
        setCurrentPlan((org.plan ?? "free").toLowerCase());
      } catch { /* ignore */ }
    }

    fetch("/saas-api/saas/billing/plans")
      .then(r => r.json())
      .then(data => {
        const sorted = (data.plans ?? []).sort(
          (a: Plan, b: Plan) => getPlanRank(a.plan) - getPlanRank(b.plan)
        );
        setPlans(sorted);
      })
      .catch(() => {
        toast({ title: "Could not load plans", description: "Please refresh and try again.", variant: "destructive" });
      })
      .finally(() => setLoading(false));
  }, []);

  const handleUpgrade = async (plan: Plan) => {
    const apiKey = localStorage.getItem("nhid_api_key");
    const orgRaw = localStorage.getItem("nhid_org");
    if (!apiKey || !orgRaw) {
      toast({ title: "Not signed in", description: "Please sign in first.", variant: "destructive" });
      return;
    }

    setCheckingOut(plan.plan);
    try {
      const base = window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch("/saas-api/saas/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
        body: JSON.stringify({
          plan: plan.plan,
          success_url: `${base}/billing?upgraded=1`,
          cancel_url: `${base}/billing`,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? "Checkout failed");
      }

      const data = await res.json();
      window.location.href = data.checkout_url;
    } catch (err: any) {
      toast({
        title: "Checkout error",
        description: err?.message ?? "Something went wrong. Please try again.",
        variant: "destructive",
      });
      setCheckingOut(null);
    }
  };

  const currentRank = getPlanRank(currentPlan);

  const upgraded = new URLSearchParams(window.location.search).get("upgraded") === "1";

  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <CreditCard size={18} style={{ color: "var(--nhid-teal)" }} />
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: "var(--nhid-text)", letterSpacing: "-0.02em" }}>
            Billing & Plans
          </h1>
        </div>
        <p style={{ margin: 0, fontSize: 12, color: "var(--nhid-muted)" }}>
          Upgrade your plan to unlock higher event limits and priority support.
        </p>
      </div>

      {/* Success banner */}
      {upgraded && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          background: "rgba(0,194,168,0.08)", border: "1px solid rgba(0,194,168,0.3)",
          borderRadius: 10, padding: "12px 16px", marginBottom: 24,
          color: "var(--nhid-teal)", fontSize: 13, fontWeight: 600,
        }}>
          <CheckCircle size={16} />
          Subscription activated — welcome to {currentPlan.toUpperCase()}!
        </div>
      )}

      {/* Current plan badge */}
      <div style={{
        background: "var(--nhid-surface)", border: "1px solid var(--nhid-border)",
        borderRadius: 10, padding: "12px 16px", marginBottom: 28,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <div>
          <div style={{ fontSize: 10, color: "var(--nhid-muted)", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600, marginBottom: 3 }}>
            Current plan
          </div>
          <div style={{ fontSize: 15, fontWeight: 800, color: "var(--nhid-text)" }}>
            {currentPlan === "free" ? "Free tier" : currentPlan.toUpperCase()}
          </div>
        </div>
        {currentPlan !== "free" && (
          <div style={{
            fontSize: 10, fontWeight: 700, color: "var(--nhid-teal)",
            background: "rgba(0,194,168,0.1)", border: "1px solid rgba(0,194,168,0.25)",
            borderRadius: 20, padding: "4px 10px", letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}>
            Active
          </div>
        )}
      </div>

      {/* Plan cards */}
      {loading ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 60, color: "var(--nhid-muted)" }}>
          <Loader2 size={22} style={{ animation: "spin 1s linear infinite" }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      ) : plans.length === 0 ? (
        <div style={{
          background: "var(--nhid-surface)", border: "1px solid var(--nhid-border)",
          borderRadius: 12, padding: 40, textAlign: "center", color: "var(--nhid-muted)", fontSize: 13,
        }}>
          Plans are being configured. Please check back shortly.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
          {plans.map(plan => {
            const planKey = plan.plan.toLowerCase();
            const planRank = getPlanRank(planKey);
            const isCurrent = planKey === currentPlan;
            const isUpgrade = planRank > currentRank;
            const isDowngrade = planRank < currentRank;
            const isCheckingThis = checkingOut === plan.plan;
            const Icon = PLAN_ICONS[planKey] ?? Zap;
            const features = PLAN_FEATURES[planKey] ?? [];
            const dollars = ((plan.amount_cents ?? 0) / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

            return (
              <div
                key={plan.price_id}
                style={{
                  background: isCurrent ? "rgba(0,194,168,0.05)" : "var(--nhid-surface)",
                  border: `1px solid ${isCurrent ? "rgba(0,194,168,0.35)" : "var(--nhid-border)"}`,
                  borderRadius: 14, padding: "22px 20px",
                  display: "flex", flexDirection: "column",
                  transition: "border-color 0.2s",
                  position: "relative",
                }}
              >
                {isCurrent && (
                  <div style={{
                    position: "absolute", top: -1, right: 16,
                    background: "var(--nhid-teal)", color: "#070c17",
                    fontSize: 9, fontWeight: 800, letterSpacing: "0.1em",
                    textTransform: "uppercase", padding: "3px 8px",
                    borderRadius: "0 0 6px 6px",
                  }}>
                    Current
                  </div>
                )}

                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: isCurrent ? "rgba(0,194,168,0.15)" : "rgba(255,255,255,0.05)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                  }}>
                    <Icon size={15} style={{ color: isCurrent ? "var(--nhid-teal)" : "var(--nhid-muted)" }} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: "var(--nhid-text)" }}>
                      {plan.name ?? planKey.toUpperCase()}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--nhid-muted)" }}>
                      {planKey.toUpperCase()} plan
                    </div>
                  </div>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <span style={{ fontSize: 26, fontWeight: 900, color: "var(--nhid-text)", letterSpacing: "-0.03em" }}>
                    {dollars}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--nhid-muted)", marginLeft: 4 }}>
                    / {plan.interval ?? "month"}
                  </span>
                </div>

                <ul style={{ margin: "0 0 20px", padding: 0, listStyle: "none", flex: 1 }}>
                  {features.map(f => (
                    <li key={f} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7 }}>
                      <CheckCircle size={12} style={{ color: "var(--nhid-teal)", flexShrink: 0 }} />
                      <span style={{ fontSize: 12, color: "var(--nhid-muted)" }}>{f}</span>
                    </li>
                  ))}
                </ul>

                {isCurrent ? (
                  <div style={{
                    textAlign: "center", fontSize: 12, fontWeight: 700,
                    color: "var(--nhid-teal)", padding: "10px 0",
                  }}>
                    ✓ Your current plan
                  </div>
                ) : isUpgrade ? (
                  <button
                    onClick={() => handleUpgrade(plan)}
                    disabled={!!checkingOut}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                      width: "100%", padding: "11px", borderRadius: 9,
                      background: "linear-gradient(135deg, #00c2a8, #53d8fb)",
                      border: "none", color: "#070c17",
                      fontSize: 13, fontWeight: 800, cursor: checkingOut ? "not-allowed" : "pointer",
                      fontFamily: "'Raleway', sans-serif",
                      opacity: checkingOut && !isCheckingThis ? 0.5 : 1,
                      boxShadow: "0 0 20px rgba(0,194,168,0.3)",
                      transition: "opacity 0.2s",
                    }}
                  >
                    {isCheckingThis ? (
                      <><Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> Processing…</>
                    ) : (
                      <>Upgrade <ArrowRight size={13} /></>
                    )}
                  </button>
                ) : isDowngrade ? (
                  <div style={{
                    textAlign: "center", fontSize: 11, color: "var(--nhid-muted)",
                    padding: "10px 0",
                  }}>
                    Contact support to downgrade
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <p style={{ marginTop: 24, fontSize: 11, color: "var(--nhid-muted)", lineHeight: 1.6 }}>
        Billing is handled securely by Stripe. Your API key continues working immediately after upgrade.
        Webhooks confirm activation — usually within seconds.
      </p>
    </div>
  );
}
