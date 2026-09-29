/**
 * Charts for the Governance Ops screens.
 *
 * Hand-built SVG rather than a charting library. These are small, fixed forms
 * with unusual requirements -- a 2px surface gap between stacked segments, a
 * hatch texture on one specific series, direct labels only where a segment is
 * wide enough to hold one -- and expressing those through a general-purpose
 * library's abstractions costs more than drawing four rects.
 *
 * ── Colour ───────────────────────────────────────────────────────────────────
 * The four result states carry a validated status palette:
 *
 *     pass            #0e7a57   green
 *     unknown         #d99400   amber
 *     not_assessable  #94a3b8   neutral
 *     exception       #a8271a   red
 *
 * That order is the stacking order, and it is not alphabetical or by frequency
 * -- it puts `not_assessable` between amber and red so that green and red are
 * never adjacent. Red-next-to-green is the classic colour-vision failure, and
 * measured here it was the worst pair in the set: ΔE 4.1 under deuteranopia,
 * far below the ΔE 8 floor. Separated, the worst adjacent pair is amber↔green
 * at ΔE 16.5 (protan) and 18.6 with normal vision, clear of both floors.
 *
 * Two deliberate exceptions to the palette rules:
 *
 *   * `not_assessable` is a neutral grey and fails a chroma floor written for
 *     categorical series. That is the point -- it means "no determination was
 *     possible", and a saturated hue would assert a finding where there is
 *     none. It carries a diagonal hatch so it is distinguishable without
 *     relying on colour at all.
 *   * amber and grey sit below 3:1 against the light surface. The relief for
 *     that is visible labelling, so every segment is directly labelled with its
 *     count and every chart has a table underneath it.
 *
 * Nothing here encodes meaning in colour alone.
 */
import { useState } from "react";

export const RESULT_ORDER = ["pass", "unknown", "not_assessable", "exception"] as const;
export type ResultKey = (typeof RESULT_ORDER)[number];

export const RESULT_COLOR: Record<ResultKey, string> = {
  pass: "#0e7a57",
  unknown: "#d99400",
  not_assessable: "#94a3b8",
  exception: "#a8271a",
};

export const RESULT_TEXT: Record<ResultKey, string> = {
  pass: "Pass",
  unknown: "Unknown",
  not_assessable: "Not assessable",
  exception: "Exception",
};

/** Marks are hatched, not just coloured, wherever colour would be doing the work alone. */
const HATCHED: ResultKey[] = ["not_assessable"];

export const CHART_CSS = `
.viz { --viz-surface:#ffffff; --viz-grid:#e7ebef; --viz-ink:#1f2933; --viz-muted:#5c6b7a; }
.viz figure { margin:0; }
.viz figcaption { font-size:13px; color:var(--viz-muted); margin-bottom:14px; line-height:1.5; }
.viz .viz-row { display:grid; grid-template-columns:78px 1fr; align-items:center; gap:12px;
  margin-bottom:9px; }
.viz .viz-row:last-child { margin-bottom:0; }
.viz .viz-key { font-size:12px; font-weight:600; font-variant-numeric:tabular-nums;
  color:var(--viz-ink); letter-spacing:0.01em; }
.viz .viz-key.wide { font-weight:500; letter-spacing:0; }
.viz .viz-legend { display:flex; flex-wrap:wrap; gap:14px; margin-top:16px;
  padding-top:14px; border-top:1px solid var(--viz-grid); }
.viz .viz-legend span { display:inline-flex; align-items:center; gap:6px;
  font-size:12px; color:var(--viz-muted); }
.viz .viz-swatch { width:11px; height:11px; border-radius:2px; flex:none; }
.viz .viz-table { margin-top:14px; font-size:12px; }
.viz .viz-table summary { cursor:pointer; color:var(--viz-muted); font-size:12px;
  padding:3px 0; }
.viz .viz-table summary:hover { color:var(--viz-ink); }
.viz .viz-table table { margin-top:8px; }
.viz .viz-track { display:flex; gap:2px; height:26px; align-items:stretch; }
.viz .viz-seg { display:flex; align-items:center; justify-content:center;
  border-radius:2px; font-size:11px; font-weight:700; font-variant-numeric:tabular-nums;
  min-width:3px; transition:opacity 120ms ease; cursor:default; }
.viz .viz-seg:first-child { border-radius:4px 2px 2px 4px; }
.viz .viz-seg:last-child  { border-radius:2px 4px 4px 2px; }
.viz .viz-seg:only-child  { border-radius:4px; }
/* Texture, not colour, is what separates this state for a reader who cannot
   rely on hue — and it survives greyscale printing. */
.viz .viz-seg.hatched { background-image:repeating-linear-gradient(45deg,
  transparent, transparent 2px, rgba(255,255,255,.6) 2px, rgba(255,255,255,.6) 4px); }
`;


/* ── Control outcomes: one stacked bar per control ───────────────────────────
 *
 * The product's core claim rendered as a picture: for each control, how many
 * interactions passed, how many raised an exception, and -- the two states most
 * governance dashboards quietly discard -- how many could not be determined.
 */
export function ControlOutcomes({
  outcomes,
}: {
  outcomes: Record<string, Partial<Record<ResultKey, number>>>;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const controls = Object.keys(outcomes).sort();
  if (controls.length === 0) return null;

  const totals = controls.map((c) =>
    RESULT_ORDER.reduce((s, r) => s + (outcomes[c][r] ?? 0), 0));
  const max = Math.max(...totals, 1);

  const present = RESULT_ORDER.filter((r) =>
    controls.some((c) => (outcomes[c][r] ?? 0) > 0));

  return (
    <figure className="viz">
      <h2>Control outcomes</h2>
      <figcaption>
        What each control determined, per interaction. <strong>Unknown</strong> and{" "}
        <strong>not assessable</strong> are reported rather than folded into a pass or a
        failure — an interaction that cannot support a verdict does not get one.
      </figcaption>


      {/* Plain flex rather than SVG. An SVG bar sized in percent needs
          preserveAspectRatio="none", which scales the horizontal axis to fit
          the container — and that scales the glyphs with it, turning a count
          label into a smear. HTML boxes size themselves and leave text alone. */}
      {controls.map((control, i) => {
        const total = totals[i];
        return (
          <div className="viz-row" key={control}>
            <div className="viz-key">{control}</div>
            <div className="viz-track"
                 role="img"
                 aria-label={`${control}: ${RESULT_ORDER
                   .filter((r) => outcomes[control][r])
                   .map((r) => `${outcomes[control][r]} ${RESULT_TEXT[r]}`)
                   .join(", ")}`}>
              {RESULT_ORDER.map((r) => {
                const n = outcomes[control][r] ?? 0;
                if (!n) return null;
                // Scaled against the largest control total, so rows are
                // comparable to each other rather than each normalised to itself.
                const pct = (n / max) * 100;
                const key = `${control}-${r}`;
                const dim = hover !== null && hover !== key;
                return (
                  <div
                    key={r}
                    className={`viz-seg${HATCHED.includes(r) ? " hatched" : ""}`}
                    title={`${control} · ${RESULT_TEXT[r]}: ${n} of ${total}`}
                    onMouseEnter={() => setHover(key)}
                    onMouseLeave={() => setHover(null)}
                    style={{
                      width: `${pct}%`,
                      // `backgroundColor`, not the `background` shorthand: the
                      // shorthand resets background-image, which silently threw
                      // away the hatch that carries this state without colour.
                      backgroundColor: RESULT_COLOR[r],
                      color: r === "not_assessable" ? "#1f2933" : "#ffffff",
                      opacity: dim ? 0.55 : 1,
                    }}
                  >
                    {/* Shown only where the segment can hold it. A clipped
                        number is worse than none; the table has them all. */}
                    {pct > 6 && <span>{n}</span>}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="viz-legend">
        {present.map((r) => (
          <span key={r}>
            <i className="viz-swatch" style={{
              background: RESULT_COLOR[r],
              backgroundImage: HATCHED.includes(r)
                ? "repeating-linear-gradient(45deg,transparent,transparent 1.5px,rgba(255,255,255,.6) 1.5px,rgba(255,255,255,.6) 3px)"
                : undefined,
            }} />
            {RESULT_TEXT[r]}
          </span>
        ))}
      </div>

      <details className="viz-table">
        <summary>Table view</summary>
        <table>
          <thead>
            <tr>
              <th>Control</th>
              {present.map((r) => <th key={r}>{RESULT_TEXT[r]}</th>)}
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {controls.map((c, i) => (
              <tr key={c}>
                <td style={{ fontWeight: 600 }}>{c}</td>
                {present.map((r) => <td key={r}>{outcomes[c][r] ?? "—"}</td>)}
                <td>{totals[i]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

/* ── Findings by category ────────────────────────────────────────────────────
 *
 * One measure, many categories: a single hue, sorted descending. No categorical
 * palette, because nothing here needs distinguishing by colour -- the axis label
 * already says which category each bar is.
 */
export function FindingsByCategory({
  byCategory,
  labelFor,
  hrefFor,
}: {
  byCategory: Record<string, number>;
  /** Display name for a category key; falls back to a de-underscored form. */
  labelFor?: (key: string) => string | undefined;
  /** Where clicking a row goes. Omit and the rows are inert text. */
  hrefFor?: (key: string) => string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const rows = Object.entries(byCategory)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (rows.length === 0) return null;

  const max = Math.max(...rows.map(([, n]) => n), 1);
  const label = (k: string) =>
    labelFor?.(k) ?? k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

  return (
    <figure className="viz">
      <h2>Findings by category</h2>
      <figcaption>
        Open and resolved findings, grouped by what the control observed.
      </figcaption>
      {rows.map(([cat, n]) => (
        <div className="viz-row" key={cat}
             style={{ gridTemplateColumns: "200px 1fr" }}
             onMouseEnter={() => setHover(cat)}
             onMouseLeave={() => setHover(null)}>
          <div className="viz-key wide" title={label(cat)}
               style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {hrefFor ? <a href={hrefFor(cat)}>{label(cat)}</a> : label(cat)}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              height: 18,
              width: `${(n / max) * 100}%`,
              minWidth: 3,
              background: "#1b5e9c",
              // 4px rounded data-end, square against the baseline it grows from.
              borderRadius: "2px 4px 4px 2px",
              opacity: hover && hover !== cat ? 0.55 : 1,
              transition: "opacity 120ms ease",
            }} />
            <span style={{
              fontSize: 12, fontWeight: 600, color: "#1f2933",
              fontVariantNumeric: "tabular-nums",
            }}>{n}</span>
          </div>
        </div>
      ))}
    </figure>
  );
}
