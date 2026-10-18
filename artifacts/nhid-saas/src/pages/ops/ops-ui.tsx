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
import { CHART_CSS } from "./ops-charts";

export const OPS_CSS = `
.ops {
  --ops-bg: #f3f6f9; --ops-surface: #fff; --ops-border: #d9e1ea;
  --ops-ink: #172b4d; --ops-muted: #526579; --ops-faint: #74869a;
  --ops-blue: #1769aa; --ops-blue-soft: #eaf3fb;
  --ops-exception: #a52b24; --ops-exception-soft: #fff0ef;
  --ops-unknown: #825d0b; --ops-unknown-soft: #fff7e3;
  --ops-pass: #216e4a; --ops-pass-soft: #e7f5ec; --ops-focus: #2684ff;
  background: var(--ops-bg); color: var(--ops-ink);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 14px; line-height: 1.55; min-height: 100%;
  padding: clamp(16px, 2.4vw, 30px);
}
.ops * { box-sizing: border-box; }
.ops h1 { font-size: clamp(22px, 2vw, 28px); line-height: 1.2; font-weight: 650; margin: 0; letter-spacing: -.035em; color: #102a43; }
.ops h2 { font-size: 15px; line-height: 1.35; font-weight: 650; margin: 0 0 12px; letter-spacing: -.01em; }
.ops h3 { font-size: 13px; font-weight: 650; margin: 0 0 8px; }
.ops a { color: var(--ops-blue); text-decoration: none; }
.ops a:hover { color: #0b4f86; text-decoration: underline; }
.ops button, .ops input, .ops select, .ops textarea { font: inherit; }
.ops :focus-visible { outline: 2px solid var(--ops-focus); outline-offset: 2px; }
.ops .eyebrow { font-size: 10px; font-weight: 750; letter-spacing: .13em; text-transform: uppercase; color: #61778d; margin-bottom: 7px; }
.ops .page-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; margin-bottom: 20px; }
.ops .page-head-copy { min-width: 0; }
.ops .sub { color: var(--ops-muted); font-size: 13px; margin: 7px 0 0; max-width: 760px; }
.ops .page-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.ops .card { background: var(--ops-surface); border: 1px solid var(--ops-border); border-radius: 8px; padding: 18px 20px; margin-bottom: 16px; box-shadow: 0 1px 2px rgba(16,42,67,.035); }
.ops .card > :last-child { margin-bottom: 0; }
.ops .grid { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 205px), 1fr)); }
.ops .metric { position: relative; min-width: 0; background: var(--ops-surface); border: 1px solid var(--ops-border); border-radius: 8px; padding: 16px 17px 15px; box-shadow: 0 1px 2px rgba(16,42,67,.035); transition: border-color 140ms ease, box-shadow 140ms ease; }
.ops .metric::before { content: none; }
.ops .metric:hover { border-color: #b8c9d9; box-shadow: 0 3px 10px rgba(16,42,67,.07); transform: none; }
.ops .metric .label { font-size: 11px; line-height: 1.4; color: var(--ops-muted); margin-bottom: 9px; font-weight: 650; letter-spacing: .015em; text-transform: none; }
.ops .metric .value { font-size: clamp(24px, 2vw, 30px); font-weight: 680; color: #173b5e; font-variant-numeric: tabular-nums; letter-spacing: -.035em; line-height: 1.15; overflow-wrap: anywhere; }
.ops .metric .denom { font-size: 11px; line-height: 1.45; color: var(--ops-faint); margin-top: 7px; font-variant-numeric: tabular-nums; }
.ops .nav { display: flex; gap: 2px; margin: 0 0 18px; border-bottom: 1px solid #ccd7e2; overflow-x: auto; scrollbar-width: thin; }
.ops .nav a { position: relative; display: inline-flex; align-items: center; white-space: nowrap; padding: 10px 13px 12px; font-size: 12px; font-weight: 550; color: #526579; border-bottom: 3px solid transparent; margin-bottom: -1px; }
.ops .nav a:hover { color: #173b5e; text-decoration: none; background: rgba(255,255,255,.65); }
.ops .nav a.active { color: var(--ops-blue); border-bottom-color: var(--ops-blue); font-weight: 700; }
.ops table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12.5px; }
.ops .card:has(> table), .ops .table-wrap { overflow-x: auto; }
.ops th { position: sticky; top: 0; text-align: left; font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: .055em; color: #61778d; padding: 10px 12px; background: #f6f8fb; border-top: 1px solid var(--ops-border); border-bottom: 1px solid var(--ops-border); white-space: nowrap; }
.ops th:first-child { border-top-left-radius: 5px; } .ops th:last-child { border-top-right-radius: 5px; }
.ops td { padding: 11px 12px; border-bottom: 1px solid #e9eef3; vertical-align: top; font-variant-numeric: tabular-nums; }
.ops tbody tr:last-child td { border-bottom: 0; } .ops tbody tr:hover td { background: #f7faff; }
.ops .pill { display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px; border-radius: 5px; font-size: 10px; line-height: 1.35; font-weight: 750; white-space: nowrap; border: 1px solid transparent; }
.ops .pill-pass { background: var(--ops-pass-soft); color: var(--ops-pass); border-color: #c9e8d5; }
.ops .pill-exception { background: var(--ops-exception-soft); color: var(--ops-exception); border-color: #f1d0cd; }
.ops .pill-unknown { background: var(--ops-unknown-soft); color: var(--ops-unknown); border-color: #efdfb3; }
.ops .pill-neutral { background: #eef2f6; color: #526579; border-color: #e0e7ee; }
.ops .pill-blue { background: var(--ops-blue-soft); color: var(--ops-blue); border-color: #c9dff2; }
.ops .toolbar { display: flex; gap: 9px; flex-wrap: wrap; align-items: center; margin-bottom: 14px; }
.ops input, .ops select, .ops textarea { min-height: 36px; border: 1px solid #cbd6e2; border-radius: 5px; padding: 7px 10px; font-size: 12.5px; background: #fff; color: var(--ops-ink); font-family: inherit; max-width: 100%; }
.ops input::placeholder, .ops textarea::placeholder { color: #8292a3; }
.ops textarea { line-height: 1.55; resize: vertical; }
.ops button { border: 1px solid #cbd6e2; background: #fff; color: #27445f; border-radius: 5px; padding: 8px 12px; font-size: 12px; font-weight: 650; cursor: pointer; font-family: inherit; min-height: 34px; }
.ops button:hover:not(:disabled) { background: #f5f9fd; border-color: #aebfd0; }
.ops button.primary { background: var(--ops-blue); border-color: var(--ops-blue); color: #fff; }
.ops button.primary:hover:not(:disabled) { background: #0e568f; border-color: #0e568f; }
.ops button:disabled { opacity: .48; cursor: not-allowed; }
.ops .notice { background: var(--ops-unknown-soft); border: 1px solid #ead7a2; border-left: 3px solid #c99a1e; border-radius: 6px; padding: 12px 15px; font-size: 12px; margin-bottom: 16px; color: #624e17; line-height: 1.6; }
.ops .notice-demo { display: flex; align-items: flex-start; gap: 8px; background: #edf5fc; border-color: #c9dff2; border-left-color: var(--ops-blue); color: #294f70; }
.ops .notice-demo strong:first-child { white-space: nowrap; }
.ops .transcript { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.ops .turn { display: grid; grid-template-columns: 62px 62px minmax(0, 1fr); gap: 10px; padding: 10px 0; border-bottom: 1px solid #e9eef3; overflow-wrap: anywhere; }
.ops .turn:last-child { border-bottom: 0; } .ops .turn .who { font-weight: 750; font-size: 10px; text-transform: uppercase; }
.ops .turn .who.agent { color: var(--ops-blue); } .ops .turn .who.human { color: var(--ops-muted); }
.ops .muted { color: var(--ops-muted); } .ops .empty { padding: 44px 24px; text-align: center; color: var(--ops-faint); }
.ops dl.kv { display: grid; grid-template-columns: minmax(100px, max-content) minmax(0, 1fr); gap: 9px 20px; margin: 0; }
.ops dl.kv dt { color: var(--ops-muted); font-size: 11px; font-weight: 600; }
.ops dl.kv dd { margin: 0; font-size: 12.5px; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
@media (max-width: 720px) {
  .ops { padding: 16px 12px; } .ops .page-head { display: block; }
  .ops .page-actions { justify-content: flex-start; margin-top: 14px; }
  .ops .card { padding: 15px 13px; } .ops .nav a { padding: 10px 11px 12px; }
  .ops .turn { grid-template-columns: 46px 52px minmax(0, 1fr); gap: 6px; }
  .ops dl.kv { grid-template-columns: 1fr; gap: 3px; } .ops dl.kv dd { margin-bottom: 9px; }
}
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
      <style>{OPS_CSS}{CHART_CSS}</style>
      <div className="page-head">
        <div className="page-head-copy">
          <div className="eyebrow">NHID Clinical / Governance workspace</div>
          <h1>{title}</h1>
          {subtitle && <div className="sub">{subtitle}</div>}
        </div>
        <div className="page-actions">
          {active !== "/ops/interactions" && <Link href="/ops/interactions"><button type="button">Browse interactions</button></Link>}
          {active !== "/ops/assessments" && <Link href="/ops/assessments"><button type="button" className="primary">+ New assessment</button></Link>}
        </div>
      </div>
      <nav className="nav" aria-label="Governance workspace">
        {TABS.map((t) => (
          <Link key={t.href} href={t.href} className={active === t.href ? "active" : ""} aria-current={active === t.href ? "page" : undefined}>
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
    <div className="notice notice-demo">
      <strong>Recorded demonstration</strong> · <strong>10 synthetic interactions</strong>,
      replayed from output the real evaluator produced. Not observed traffic, not customer
      data, not a pilot — this product has zero deployments. Writing is disabled; connect an
      API key to evaluate your own interactions.
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

/** Shown wherever a reader might mistake demo data for observed traffic.
 *
 * Silent in demo mode, where `DemoNotice` is already on screen saying the same
 * thing in more detail — two stacked banners making one point read as an
 * unfinished page rather than a careful one. It still fires for a real
 * organization whose workspace contains synthetic rows, which is the case the
 * warning actually exists for and the only case where it is the sole disclosure.
 */
export function SyntheticNotice({ count }: { count: number }) {
  const apiKey = useApiKey();
  if (!count || isDemoKey(apiKey ?? DEMO_API_KEY)) return null;
  return (
    <div className="notice">
      <strong>{count}</strong> record{count === 1 ? " is" : "s are"} synthetic demonstration
      data, not observed traffic. This product has no deployments and no pilots; nothing here
      represents a customer.
    </div>
  );
}
