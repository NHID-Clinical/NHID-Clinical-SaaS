/**
 * The getting-started card at the top of the dashboard.
 *
 * Reads the same `useSetupProgress()` as the /setup page, so a step that is
 * done there is done here. Goes away on its own once all four are done, or
 * when someone dismisses it; either way the /setup page stays reachable.
 */
import { Link } from "wouter";
import { Check } from "lucide-react";

import { useSetupProgress } from "@/hooks/use-setup";

const NOTES: Record<string, string> = {
  team: "Give colleagues access to review findings.",
  source: "Generic export, Twilio or VAPI.",
  interactions: "Load the synthetic set or upload your own.",
  pipeline: "The header and call your pipeline will make.",
};

export function SetupChecklist() {
  const p = useSetupProgress();
  if (p.loading || !p.orgId || p.allDone || p.dismissed) return null;

  const pct = Math.round((p.doneCount / p.steps.length) * 100);
  return (
    <section
      aria-labelledby="setup-checklist-h"
      data-testid="setup-checklist"
      style={{
        background: "var(--nhid-surface)", border: "1px solid var(--nhid-border)",
        borderRadius: 14, padding: "18px 20px 16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h2 id="setup-checklist-h" style={{ fontSize: 15, fontWeight: 700, color: "var(--nhid-text)", margin: 0 }}>
            Getting started
          </h2>
          <div style={{ fontSize: 12, color: "var(--nhid-muted)", marginTop: 2 }}>
            {p.doneCount} of {p.steps.length} done
          </div>
        </div>
        <button
          type="button"
          onClick={p.dismiss}
          style={{
            border: "1px solid var(--nhid-border)", background: "transparent", color: "var(--nhid-muted)",
            borderRadius: 6, padding: "5px 10px", fontSize: 11.5, fontWeight: 650, cursor: "pointer",
          }}
        >
          Dismiss
        </button>
      </div>

      <div
        role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}
        aria-label="Setup progress"
        style={{ height: 4, borderRadius: 2, background: "var(--nhid-border)", margin: "12px 0 14px", overflow: "hidden" }}
      >
        <div style={{ width: `${pct}%`, height: "100%", background: "var(--nhid-teal)", transition: "width 240ms ease" }} />
      </div>

      <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 2 }}>
        {p.steps.map((s) => (
          <li
            key={s.id}
            style={{
              display: "grid", gridTemplateColumns: "22px minmax(0, 1fr) auto", alignItems: "center",
              gap: 12, padding: "8px 4px", borderTop: s.n === 1 ? 0 : "1px solid var(--nhid-border)",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 20, height: 20, borderRadius: "50%", display: "inline-flex", alignItems: "center",
                justifyContent: "center",
                background: s.done ? "var(--nhid-teal)" : "transparent",
                border: s.done ? "1px solid var(--nhid-teal)" : "1.5px solid var(--nhid-border-bright)",
                color: "#fff",
              }}
            >
              {s.done && <Check size={12} strokeWidth={3} />}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{
                fontSize: 13, fontWeight: 650, color: "var(--nhid-text)",
                textDecoration: s.done ? "line-through" : "none", opacity: s.done ? 0.65 : 1,
              }}>
                {s.n}. {s.label}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--nhid-muted)" }}>{NOTES[s.id]}</div>
            </div>
            <Link
              href={`/setup?step=${s.n}`}
              style={{ fontSize: 12, fontWeight: 700, color: "var(--nhid-teal)", textDecoration: "none", whiteSpace: "nowrap" }}
            >
              {s.done ? "Change" : "Open"} →
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
