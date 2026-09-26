/**
 * Shared shell and primitives for the governance operations screens.
 *
 * Deliberately boring. A compliance or QA analyst should understand what they are
 * looking at without being taught: off-white surfaces, charcoal text, one clinical
 * blue accent, dense tables, evidence first.
 *
 * What is not here, on purpose: no score, no gauge, no meter, no trust dial, no
 * traffic-light summary of an organisation. Every number on these screens is a
 * count or a rate that states its own denominator.
 */
import { ReactNode } from "react";
import { Link } from "wouter";
import { useApiKey } from "@/hooks/use-nhid";
import { DEMO_API_KEY, isDemoKey } from "@/lib/monitoring-api";

export const OPS_CSS = `
.ops {
  --ops-bg:        #f7f8fa;
  --ops-surface:   #ffffff;
  --ops-border:    #dfe3e8;
  --ops-ink:       #1f2933;
  --ops-muted:     #5c6b7a;
  --ops-faint:     #8895a3;
  --ops-blue:      #1b5e9c;
  --ops-blue-soft: #eaf1f8;
  --ops-exception: #9c2a1b;
  --ops-exception-soft: #fbecea;
  --ops-unknown:   #8a6d1f;
  --ops-unknown-soft: #fbf4e2;
  --ops-pass:      #1f6b45;
  --ops-pass-soft: #eaf4ee;
  background: var(--ops-bg);
  color: var(--ops-ink);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  min-height: 100%;
  padding: 24px;
}
.ops h1 { font-size: 20px; font-weight: 600; margin: 0 0 4px; letter-spacing: -0.01em; }
.ops h2 { font-size: 15px; font-weight: 600; margin: 0 0 12px; }
.ops a { color: var(--ops-blue); text-decoration: none; }
.ops a:hover { text-decoration: underline; }
.ops .sub { color: var(--ops-muted); font-size: 13px; margin-bottom: 20px; }
.ops .card {
  background: var(--ops-surface); border: 1px solid var(--ops-border);
  border-radius: 6px; padding: 16px; margin-bottom: 16px;
}
.ops .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); }
.ops .metric { background: var(--ops-surface); border: 1px solid var(--ops-border);
  border-radius: 6px; padding: 14px 16px; }
.ops .metric .label { font-size: 12px; color: var(--ops-muted); text-transform: uppercase;
  letter-spacing: 0.04em; margin-bottom: 6px; }
.ops .metric .value { font-size: 24px; font-weight: 600; font-variant-numeric: tabular-nums; }
.ops .metric .denom { font-size: 12px; color: var(--ops-faint); margin-top: 4px;
  font-variant-numeric: tabular-nums; }
.ops table { width: 100%; border-collapse: collapse; font-size: 13px; }
.ops th { text-align: left; font-weight: 600; font-size: 11px; text-transform: uppercase;
  letter-spacing: 0.04em; color: var(--ops-muted); padding: 8px 10px;
  border-bottom: 1px solid var(--ops-border); white-space: nowrap; }
.ops td { padding: 9px 10px; border-bottom: 1px solid #eef0f3; vertical-align: top;
  font-variant-numeric: tabular-nums; }
.ops tr:hover td { background: #fafbfc; }
.ops .pill { display: inline-block; padding: 2px 8px; border-radius: 10px;
  font-size: 11px; font-weight: 600; white-space: nowrap; }
.ops .pill-pass { background: var(--ops-pass-soft); color: var(--ops-pass); }
.ops .pill-exception { background: var(--ops-exception-soft); color: var(--ops-exception); }
.ops .pill-unknown { background: var(--ops-unknown-soft); color: var(--ops-unknown); }
.ops .pill-neutral { background: #eef0f3; color: var(--ops-muted); }
.ops .pill-blue { background: var(--ops-blue-soft); color: var(--ops-blue); }
.ops .toolbar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-bottom: 14px; }
.ops input, .ops select, .ops textarea {
  border: 1px solid var(--ops-border); border-radius: 4px; padding: 6px 9px;
  font-size: 13px; background: var(--ops-surface); color: var(--ops-ink); font-family: inherit;
}
.ops button {
  border: 1px solid var(--ops-border); background: var(--ops-surface); color: var(--ops-ink);
  border-radius: 4px; padding: 6px 12px; font-size: 13px; cursor: pointer; font-family: inherit;
}
.ops button.primary { background: var(--ops-blue); border-color: var(--ops-blue); color: #fff; }
.ops button:disabled { opacity: 0.5; cursor: not-allowed; }
.ops .nav { display: flex; gap: 4px; margin-bottom: 20px; border-bottom: 1px solid var(--ops-border); }
.ops .nav a { padding: 8px 14px; font-size: 13px; color: var(--ops-muted);
  border-bottom: 2px solid transparent; }
.ops .nav a.active { color: var(--ops-blue); border-bottom-color: var(--ops-blue); font-weight: 600; }
.ops .notice { background: var(--ops-unknown-soft); border: 1px solid #e8d9a8;
  border-radius: 6px; padding: 10px 14px; font-size: 13px; margin-bottom: 16px;
  color: #6b5514; }
.ops .transcript { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
.ops .turn { display: grid; grid-template-columns: 74px 56px 1fr; gap: 10px;
  padding: 7px 0; border-bottom: 1px solid #eef0f3; }
.ops .turn .who { font-weight: 600; font-size: 11px; text-transform: uppercase; }
.ops .turn .who.agent { color: var(--ops-blue); }
.ops .turn .who.human { color: var(--ops-muted); }
.ops .muted { color: var(--ops-muted); }
.ops .empty { padding: 40px; text-align: center; color: var(--ops-faint); }
.ops dl.kv { display: grid; grid-template-columns: max-content 1fr; gap: 6px 18px; margin: 0; }
.ops dl.kv dt { color: var(--ops-muted); font-size: 12px; }
.ops dl.kv dd { margin: 0; font-size: 13px; font-variant-numeric: tabular-nums; }
`;

const TABS = [
  { href: "/ops", label: "Overview" },
  { href: "/ops/interactions", label: "Interactions" },
  { href: "/ops/findings", label: "Findings" },
  { href: "/ops/evidence", label: "Evidence" },
  { href: "/ops/assessments", label: "Assessments" },
  { href: "/ops/reports", label: "Reports" },
];

export function OpsShell({
  title, subtitle, active, children,
}: { title: string; subtitle?: string; active: string; children: ReactNode }) {
  return (
    <div className="ops">
      <style>{OPS_CSS}</style>
      <h1>{title}</h1>
      {subtitle && <div className="sub">{subtitle}</div>}
      <nav className="nav">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} className={active === t.href ? "active" : ""}>
            {t.label}
          </Link>
        ))}
      </nav>
      <DemoNotice />
      {children}
    </div>
  );
}

/**
 * Says, on every Ops screen, that the figures are recorded and synthetic.
 *
 * It is not a footnote. Someone landing on a published URL has no other way to
 * know these are ten authored interactions replayed through the evaluator
 * rather than a customer's traffic, and this product's whole claim is that a
 * governance record should not overstate what it observed.
 */
export function DemoNotice() {
  const apiKey = useApiKey();
  if (!isDemoKey(apiKey ?? DEMO_API_KEY)) return null;
  return (
    <div className="notice" style={{ marginBottom: 16 }}>
      <strong>Recorded demonstration.</strong> No organization key is connected,
      so these screens are replaying <strong>10 synthetic interactions</strong>{" "}
      through output the real evaluator produced — not observed traffic, not
      customer data, and not a pilot. This product has zero deployments. Writing
      is disabled; connect an API key to ingest and evaluate your own
      interactions.
    </div>
  );
}

export function Metric({
  label, value, denominator,
}: { label: string; value: ReactNode; denominator?: ReactNode }) {
  return (
    <div className="metric">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {denominator !== undefined && <div className="denom">{denominator}</div>}
    </div>
  );
}

export function ResultPill({ result }: { result: string }) {
  const cls =
    result === "pass" ? "pill-pass"
    : result === "exception" ? "pill-exception"
    : result === "unknown" ? "pill-unknown"
    : "pill-neutral";
  const label =
    result === "pass" ? "Pass"
    : result === "exception" ? "Exception"
    : result === "unknown" ? "Unknown"
    : result === "not_assessable" ? "Not assessable"
    : result;
  return <span className={`pill ${cls}`}>{label}</span>;
}

export function StatusPill({ status }: { status: string }) {
  const cls = status === "resolved" ? "pill-pass"
    : status === "under_review" ? "pill-blue" : "pill-exception";
  return <span className={`pill ${cls}`}>{status.replace("_", " ")}</span>;
}

export function AttestationPill({ status, wer }: { status: string; wer?: number | null }) {
  if (status === "unattested") {
    return <span className="pill pill-unknown" title="No transcription-quality figure was supplied. Findings on this interaction rest on an unstated precision.">unattested</span>;
  }
  return (
    <span className="pill pill-neutral" title="A transcription-quality figure was supplied for this interaction.">
      {status}{wer != null ? ` · WER ${(wer * 100).toFixed(1)}%` : ""}
    </span>
  );
}

/** Shown wherever a reader might mistake demo data for observed traffic. */
export function SyntheticNotice({ count }: { count: number }) {
  if (!count) return null;
  return (
    <div className="notice">
      <strong>{count}</strong> record{count === 1 ? " is" : "s are"} synthetic demonstration
      data, not observed traffic. This product has no deployments and no pilots; nothing here
      represents a customer.
    </div>
  );
}
