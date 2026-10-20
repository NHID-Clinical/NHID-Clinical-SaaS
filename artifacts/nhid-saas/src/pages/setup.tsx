/**
 * First-time setup: the four things that make a new workspace useful, in
 * order, after the API key has been revealed once on the front door.
 *
 *   1. Invite your team            (server: POST /saas/orgs/members)
 *   2. Choose your source format   (this browser: nhid_setup_vendor)
 *   3. Your first interactions     (server: assessment + ingest + evaluate)
 *   4. Connect your pipeline       (this browser: key-stored acknowledgement)
 *
 * Every step says what it writes and where. Nothing here is decorative: a
 * step that had no real effect would be a step pretending, and this product's
 * whole claim is that its records do not overstate what happened. Progress is
 * `?step=n`, so the dashboard checklist can open any step directly.
 *
 * On a build with no backend the stepper still renders, with each step's card
 * replaced by the same statement the front door shows.
 */
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Copy } from "lucide-react";

import { OPS_CSS } from "@/pages/ops/ops-ui";
import { ENTRY_CSS, NotConnected } from "@/components/entry-shell";
import { useApiKey } from "@/hooks/use-nhid";
import { useSetupProgress, VENDORS, STEP_ORDER, STEP_LABELS, type Vendor } from "@/hooks/use-setup";
import { authApi, AuthError } from "@/lib/auth-api";
import { monitorApi } from "@/lib/monitoring-api";
import { API_BASE_URL, API_CONNECTED } from "@/lib/config";
import { DEMO_INTERACTIONS } from "@/pages/ops/demo-data";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DONE = 5; // the summary screen, one past the last step

export const SETUP_CSS = `
.ops.setup { max-width: 920px; margin: 0 auto; }
.ops .stepper { list-style: none; margin: 0 0 18px; padding: 0; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.ops .stepper li { position: relative; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 8px; padding: 0 6px; }
.ops .stepper li::before, .ops .stepper li::after { content: ""; position: absolute; top: 15px; height: 2px; background: #cbd6e2; width: calc(50% - 20px); }
.ops .stepper li::before { left: 0; } .ops .stepper li::after { right: 0; }
.ops .stepper li:first-child::before, .ops .stepper li:last-child::after { content: none; }
.ops .stepper li.done::before, .ops .stepper li.done::after, .ops .stepper li.current::before { background: var(--ops-blue); }
.ops .stepper button.dot { width: 32px; height: 32px; border-radius: 50%; padding: 0; min-height: 0; display: inline-flex; align-items: center; justify-content: center; font-size: 12.5px; font-weight: 750; position: relative; z-index: 1; background: #fff; border: 2px solid #cbd6e2; color: #61778d; }
.ops .stepper li.done button.dot { background: var(--ops-blue); border-color: var(--ops-blue); color: #fff; }
.ops .stepper li.current button.dot { border-color: var(--ops-blue); color: var(--ops-blue); box-shadow: 0 0 0 4px var(--ops-blue-soft); }
.ops .stepper .lbl { font-size: 11.5px; font-weight: 600; color: var(--ops-muted); line-height: 1.3; }
.ops .stepper li.current .lbl { color: #102a43; font-weight: 700; }
.ops .setup-card { padding: 22px 24px; }
.ops .setup-card .step-eyebrow { font-size: 10px; font-weight: 750; letter-spacing: .13em; text-transform: uppercase; color: #61778d; margin-bottom: 6px; }
.ops .setup-card h2 { font-size: 19px; margin-bottom: 6px; }
.ops .setup-card .lead { color: var(--ops-muted); font-size: 13px; margin: 0 0 16px; max-width: 640px; line-height: 1.6; }
.ops .setup-card .writes { font-size: 11.5px; color: var(--ops-faint); margin: 14px 0 0; line-height: 1.55; }
.ops .setup-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--ops-border); }
.ops .setup-foot .right { display: flex; gap: 8px; align-items: center; }
.ops .setup-foot .state { font-size: 12px; color: var(--ops-muted); }
.ops .tiles { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 230px), 1fr)); }
.ops button.tile { text-align: left; padding: 14px 15px; border-radius: 8px; border: 1.5px solid var(--ops-border); background: #fff; display: block; width: 100%; min-height: 0; font-weight: 450; }
.ops button.tile:hover:not(:disabled) { border-color: #aebfd0; background: #fff; }
.ops button.tile[aria-pressed="true"] { border-color: var(--ops-blue); background: #f7fbff; box-shadow: 0 0 0 3px var(--ops-blue-soft); }
.ops .tile .t-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
.ops .tile .t-name { font-size: 13.5px; font-weight: 700; color: #102a43; }
.ops .tile .t-blurb { font-size: 12px; color: var(--ops-muted); margin-bottom: 8px; }
.ops .tile ul { list-style: none; margin: 0; padding: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: #334e68; }
.ops .tile li { padding: 2px 0; }
.ops .fork { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); }
.ops .fork .opt { border: 1px solid var(--ops-border); border-radius: 8px; padding: 15px 16px; background: #fff; display: flex; flex-direction: column; }
.ops .fork .opt h3 { font-size: 14px; margin-bottom: 4px; }
.ops .fork .opt p { font-size: 12.5px; color: var(--ops-muted); margin: 0 0 12px; line-height: 1.55; flex: 1; }
.ops .fork .opt .act { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.ops .result { font-size: 12.5px; margin-top: 10px; }
.ops .members { margin: 0 0 14px; padding: 0; list-style: none; border: 1px solid var(--ops-border); border-radius: 8px; overflow: hidden; }
.ops .members li { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 10px; align-items: center; padding: 9px 13px; border-top: 1px solid #e9eef3; font-size: 12.5px; }
.ops .members li:first-child { border-top: 0; }
.ops .members li .email { overflow-wrap: anywhere; }
.ops .invite { display: grid; grid-template-columns: minmax(0, 1fr) 120px auto; gap: 8px; align-items: start; }
.ops .invite input, .ops .invite select { width: 100%; }
.ops .invite .err { grid-column: 1 / -1; font-size: 11.5px; color: var(--ops-exception); }
.ops .setup-card code { overflow-wrap: anywhere; }
.ops .snippet { position: relative; background: #102a43; color: #d9e2ec; border-radius: 8px; padding: 14px 16px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; line-height: 1.6; overflow-x: auto; white-space: pre; margin: 0; }
.ops .snippet .k { color: #9fd0ff; } .ops .snippet .s { color: #ffd98a; }
.ops .copy { position: absolute; top: 8px; right: 8px; min-height: 0; padding: 5px 9px; font-size: 11px; background: rgba(255,255,255,.08); border-color: rgba(255,255,255,.18); color: #fff; display: inline-flex; gap: 5px; align-items: center; }
.ops .copy:hover:not(:disabled) { background: rgba(255,255,255,.16) !important; border-color: rgba(255,255,255,.3) !important; }
.ops label.ack { display: flex; gap: 10px; align-items: flex-start; font-size: 13px; margin-top: 16px; cursor: pointer; }
.ops label.ack input { width: 16px; height: 16px; min-height: 0; margin-top: 2px; }
.ops .summary { list-style: none; margin: 0 0 18px; padding: 0; border: 1px solid var(--ops-border); border-radius: 8px; overflow: hidden; }
.ops .summary li { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto auto; gap: 12px; align-items: center; padding: 11px 14px; border-top: 1px solid #e9eef3; font-size: 13px; }
.ops .summary li:first-child { border-top: 0; }
.ops .summary .mark { width: 22px; height: 22px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; border: 1.5px solid #cbd6e2; color: #fff; }
.ops .summary li.done .mark { background: var(--ops-pass); border-color: var(--ops-pass); }
.ops .next { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); }
.ops .next a { display: block; border: 1px solid var(--ops-border); border-radius: 8px; padding: 13px 15px; color: inherit; background: #fff; }
.ops .next a:hover { text-decoration: none; border-color: #aebfd0; background: #f7fbff; }
.ops .next a b { display: block; font-size: 13.5px; color: var(--ops-blue); margin-bottom: 3px; }
.ops .next a span { font-size: 12px; color: var(--ops-muted); }
@media (max-width: 720px) {
  .ops .stepper .lbl { display: none; }
  .ops .stepper { margin-bottom: 14px; }
  .ops .setup-card { padding: 16px 14px; }
  .ops .invite { grid-template-columns: 1fr; }
  .ops .setup-foot { flex-direction: column; align-items: stretch; }
  .ops .setup-foot .right { justify-content: flex-end; }
  .ops .members li { grid-template-columns: minmax(0, 1fr) auto; }
  .ops .members li .pill-role { display: none; }
  .ops .snippet { padding-top: 44px; }
}
`;

function useStep(): [number, (n: number) => void] {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const raw = Number(new URLSearchParams(search).get("step"));
  const step = Number.isInteger(raw) && raw >= 1 && raw <= DONE ? raw : 1;
  const go = (n: number) => setLocation(n === 1 ? "/setup" : `/setup?step=${n}`);
  return [step, go];
}

export default function SetupPage() {
  const [step, go] = useStep();
  const p = useSetupProgress();

  useEffect(() => { window.scrollTo({ top: 0 }); }, [step]);

  const current = step <= 4 ? p.steps[step - 1] : null;

  return (
    <div className="ops setup">
      <style>{OPS_CSS}{ENTRY_CSS}{SETUP_CSS}</style>
      <div className="page-head">
        <div className="page-head-copy">
          <div className="eyebrow">NHID Clinical / First-time setup</div>
          <h1>{p.orgName ? `Set up ${p.orgName}` : "Set up your workspace"}</h1>
          <div className="sub">
            Four steps. Each one is optional, and each says what it changes. You can come back
            from the dashboard at any time.
          </div>
        </div>
        <div className="page-actions">
          <Link href="/dashboard"><button type="button">Skip setup for now</button></Link>
        </div>
      </div>

      <ol className="stepper" aria-label="Setup steps">
        {p.steps.map((s) => {
          const cls = s.done ? "done" : s.n === step ? "current" : "";
          return (
            <li key={s.id} className={cls} aria-current={s.n === step ? "step" : undefined}>
              <button type="button" className="dot" onClick={() => go(s.n)}
                      aria-label={`Step ${s.n}: ${s.label}${s.done ? " (done)" : ""}`}>
                {s.done ? <Check size={15} strokeWidth={3} /> : s.n}
              </button>
              <span className="lbl" aria-hidden="true">{s.label}</span>
            </li>
          );
        })}
      </ol>

      <div className="card setup-card">
        {!API_CONNECTED ? (
          <>
            <div className="step-eyebrow">{current ? `Step ${step} of 4` : "Setup"}</div>
            <h2>{current ? current.label : "Setup complete"}</h2>
            <NotConnected what="first-time setup" />
          </>
        ) : step === DONE ? (
          <Summary p={p} go={go} />
        ) : (
          <>
            <div className="step-eyebrow">Step {step} of 4</div>
            {step === 1 && <TeamStep p={p} />}
            {step === 2 && <SourceStep p={p} />}
            {step === 3 && <InteractionsStep p={p} />}
            {step === 4 && <PipelineStep p={p} />}
            <div className="setup-foot">
              <div>
                {step > 1 && <button type="button" onClick={() => go(step - 1)}>Back</button>}
              </div>
              <div className="right">
                <span className="state">{current?.done ? "Done" : "Not done yet"}</span>
                {!current?.done && step < 4 && (
                  <button type="button" onClick={() => go(step + 1)}>Skip for now</button>
                )}
                <button type="button" className="primary" onClick={() => go(step + 1)}>
                  {step === 4 ? "Finish" : "Continue"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

type Progress = ReturnType<typeof useSetupProgress>;

/* ── 1. Invite your team ─────────────────────────────────────────────── */

function TeamStep({ p }: { p: Progress }) {
  const apiKey = useApiKey();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"owner" | "member">("member");
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState<{ email: string; delivered: boolean }[]>([]);

  const invite = useMutation({
    mutationFn: () => authApi.invite(apiKey!, email.trim(), role),
    onSuccess: (r) => {
      setSent((s) => [...s, { email: r.email, delivered: r.invite_delivered }]);
      setEmail("");
      setProblem(null);
      p.markTeam();
      qc.invalidateQueries({ queryKey: ["org-members"] });
    },
    onError: (e) => setProblem(e instanceof AuthError ? e.message : "Could not send that invitation."),
  });

  const session = p.session;
  const members = p.members.data?.members ?? [];
  const you = session.data?.user.email;

  return (
    <>
      <h2>Invite your team</h2>
      <p className="lead">
        Reviewers, compliance and QA colleagues sign in with a link to their own mailbox. No
        passwords. A review decision records which person made it, so each reviewer needs their
        own access.
      </p>

      {session.isLoading ? (
        <p className="muted" style={{ fontSize: 12.5 }}>Checking who is signed in…</p>
      ) : !session.data ? (
        <>
          <div className="notice notice-demo" style={{ marginBottom: 12 }}>
            <span>
              <strong>Sign in first.</strong> The API key says which organization; a sign-in
              session says which person is inviting, and both are required to add people. Sign in
              with the owner email you gave when creating the workspace, then return to this step.
            </span>
          </div>
          <Link href="/signin"><button type="button" className="primary">Sign in with your work email</button></Link>
          <p className="writes">
            Writes nothing until you are signed in. Skipping leaves you as the only person with access.
          </p>
        </>
      ) : (
        <>
          {members.length > 0 && (
            <ul className="members" aria-label="People with access">
              {members.map((m) => (
                <li key={m.user_id}>
                  <span className="email">{m.email}{m.email === you && <span className="muted"> · you</span>}</span>
                  <span className="pill pill-neutral pill-role">{m.role}</span>
                  <span className="pill pill-pass">has access</span>
                </li>
              ))}
            </ul>
          )}
          {p.members.isError && (
            <div className="notice" style={{ marginBottom: 12 }}>
              Could not load the current member list. Invitations still work.
            </div>
          )}
          <form className="invite" noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!EMAIL_RE.test(email.trim())) { setProblem("Enter a work email address."); return; }
                  invite.mutate();
                }}>
            <input type="email" value={email} placeholder="colleague@organization.example"
                   aria-label="Email address to invite" autoComplete="off"
                   onChange={(e) => { setEmail(e.target.value); setProblem(null); }} />
            <select value={role} aria-label="Role" onChange={(e) => setRole(e.target.value as "owner" | "member")}>
              <option value="member">Member</option>
              <option value="owner">Owner</option>
            </select>
            <button type="submit" className="primary" disabled={invite.isPending || !email.trim()}>
              {invite.isPending ? "Inviting…" : "Invite"}
            </button>
            {problem && <div className="err" role="alert">{problem}</div>}
          </form>
          {sent.length > 0 && (
            <ul className="members" style={{ marginTop: 12 }} aria-label="Invitations sent in this session">
              {sent.map((s, i) => (
                <li key={i}>
                  <span className="email">{s.email}</span>
                  <span />
                  {s.delivered
                    ? <span className="pill pill-pass">sign-in link sent</span>
                    : <span className="pill pill-unknown" title="The account exists. Send them the sign-in page and they can request their own link.">created, email not delivered</span>}
                </li>
              ))}
            </ul>
          )}
          <p className="writes">
            Writes a membership for this organization and emails a sign-in link. Done when more
            than one person has access. Members can be removed later from Settings.
          </p>
        </>
      )}
    </>
  );
}

/* ── 2. Choose your source format ────────────────────────────────────── */

function SourceStep({ p }: { p: Progress }) {
  return (
    <>
      <h2>Choose your source format</h2>
      <p className="lead">
        Where your call transcripts come from. Each format goes through its own adapter into one
        canonical interaction shape, so the evaluator never sees a vendor payload. Pick the one
        you will upload most; the others stay available on every ingest.
      </p>
      <div className="tiles" role="group" aria-label="Source format">
        {VENDORS.map((v) => {
          const selected = p.vendor === v.id;
          return (
            <button key={v.id} type="button" className="tile" aria-pressed={selected}
                    onClick={() => p.setVendor(v.id as Vendor)}>
              <div className="t-head">
                <span className="t-name">{v.label}</span>
                {selected ? <span className="pill pill-blue">Selected</span> : <span className="pill pill-neutral">Select</span>}
              </div>
              <div className="t-blurb">{v.blurb}</div>
              <ul aria-label="Fields read">
                {v.fields.map((f) => <li key={f}>{f}</li>)}
              </ul>
            </button>
          );
        })}
      </div>
      <p className="writes">
        Stored in this browser only, as the default on the Assessments page and in the pipeline
        snippet in step 4. Nothing is sent to the server. Done when a format is selected.
      </p>
    </>
  );
}

/* ── 3. Your first interactions ──────────────────────────────────────── */

function InteractionsStep({ p }: { p: Progress }) {
  const apiKey = useApiKey();
  const qc = useQueryClient();
  const [result, setResult] = useState<string | null>(null);

  const load = useMutation({
    mutationFn: async () => {
      const a = await monitorApi.createAssessment(apiKey!, { name: "First look (synthetic)", is_synthetic: true });
      const ing = await monitorApi.ingest(apiKey!, {
        assessment_id: a.assessment_id, vendor: "generic",
        interactions: DEMO_INTERACTIONS, is_synthetic: true,
      });
      const ev = await monitorApi.evaluate(apiKey!, a.assessment_id);
      return { ing, ev };
    },
    onSuccess: ({ ing, ev }) => {
      setResult(
        `Ingested ${ing.ingested}, evaluated ${ev.evaluated}, ${ev.findings_created} finding${ev.findings_created === 1 ? "" : "s"} raised.` +
        (ing.errors.length ? ` ${ing.errors.length} rejected.` : ""),
      );
      for (const k of ["ops-assessments", "ops-metrics", "ops-interactions", "ops-findings"]) {
        qc.invalidateQueries({ queryKey: [k] });
      }
    },
    onError: (e: Error) => setResult(`Failed: ${e.message}`),
  });

  const n = p.assessmentCount;

  return (
    <>
      <h2>Your first interactions</h2>
      <p className="lead">
        The screens are empty until an assessment holds interactions. Start with the synthetic
        set to see the whole workflow end to end, or go straight to your own transcripts.
      </p>
      <div className="fork">
        <div className="opt">
          <h3>Load the synthetic demonstration set</h3>
          <p>
            {DEMO_INTERACTIONS.length} authored interactions, flagged synthetic on ingestion and
            labelled as such on every screen and in the report. Creates an assessment named
            “First look (synthetic)”, ingests the set and runs the evaluation.
          </p>
          <div className="act">
            <button type="button" className="primary" disabled={load.isPending} onClick={() => load.mutate()}>
              {load.isPending ? "Loading and evaluating…" : "Load and evaluate"}
            </button>
            {load.isSuccess && <Link href="/ops/findings">See the findings</Link>}
          </div>
          {result && <div className={`result${load.isError ? "" : " muted"}`} role="status">{result}</div>}
        </div>
        <div className="opt">
          <h3>Upload my own</h3>
          <p>
            Paste transcripts or event exports on the Assessments page, in the format you chose in
            step 2. Synthetic and test data only, until this deployment, its contracts and its
            security controls have been separately validated.
          </p>
          <div className="act">
            <Link href="/ops/assessments"><button type="button">Open Assessments</button></Link>
          </div>
        </div>
      </div>
      <p className="writes">
        Writes an assessment, its interactions and their evaluations to this organization.
        {n > 0 ? ` ${n} assessment${n === 1 ? "" : "s"} exist${n === 1 ? "s" : ""} now.` : " Done when at least one assessment exists."}
      </p>
    </>
  );
}

/* ── 4. Connect your pipeline ────────────────────────────────────────── */

function PipelineStep({ p }: { p: Progress }) {
  const [copied, setCopied] = useState(false);
  const vendor = p.vendor ?? "generic";
  const base = useMemo(() => {
    if (/^https?:\/\//i.test(API_BASE_URL)) return API_BASE_URL;
    return `${window.location.origin}${API_BASE_URL}`;
  }, []);

  const plain =
`curl -X POST ${base}/saas/monitor/ingest \\
  -H "X-API-Key: $NHID_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"assessment_id": "<assessment_id>", "vendor": "${vendor}", "interactions": [ ... ]}'`;

  const copy = async () => {
    await navigator.clipboard.writeText(plain).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <>
      <h2>Connect your pipeline</h2>
      <p className="lead">
        Nothing in your telephony has to change. A script, a CI job or an export task sends
        interactions to one endpoint with the organization&apos;s API key in a header, then asks
        for an evaluation.
      </p>
      <pre className="snippet" aria-label="Ingest request example">
        <button type="button" className="copy" onClick={copy} aria-label="Copy example">
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
        </button>
        {`curl -X POST ${base}/saas/monitor/ingest \\\n  -H `}<span className="k">&quot;X-API-Key: $NHID_API_KEY&quot;</span>{` \\\n  -H "Content-Type: application/json" \\\n  -d '{"assessment_id": "<assessment_id>", "vendor": `}<span className="s">&quot;{vendor}&quot;</span>{`, "interactions": [ ... ]}'`}
      </pre>
      <p className="muted" style={{ fontSize: 12.5, margin: "12px 0 0" }}>
        Then <code>POST /saas/monitor/assessments/&lt;assessment_id&gt;/evaluate</code> with the same
        header. The <Link href="/docs/sdk">SDK documentation</Link> has the full request shapes and a
        client you can drop in.
      </p>
      <label className="ack">
        <input type="checkbox" checked={p.acknowledged} onChange={(e) => { if (e.target.checked) p.acknowledge(); }}
               disabled={p.acknowledged} />
        <span>
          I have stored the API key in a secrets manager. It was shown once when the workspace was
          created and is not shown again; it can be rotated from Settings.
        </span>
      </label>
      <p className="writes">
        Records this acknowledgement in this browser only. Done when the box is ticked.
      </p>
    </>
  );
}

/* ── 5. Summary ──────────────────────────────────────────────────────── */

function Summary({ p, go }: { p: Progress; go: (n: number) => void }) {
  return (
    <>
      <div className="step-eyebrow">Setup</div>
      <h2>{p.allDone ? "Setup complete" : `Setup: ${p.doneCount} of ${p.steps.length} done`}</h2>
      <p className="lead">
        {p.allDone
          ? "Everything a new workspace needs is in place. The steps stay editable from the dashboard."
          : "Skipped steps are listed below and can be finished from the dashboard at any time."}
      </p>
      <ul className="summary">
        {p.steps.map((s) => (
          <li key={s.id} className={s.done ? "done" : ""}>
            <span className="mark" aria-hidden="true">{s.done && <Check size={13} strokeWidth={3} />}</span>
            <span>{s.n}. {STEP_LABELS[STEP_ORDER[s.n - 1]]}</span>
            {s.done ? <span className="pill pill-pass">Done</span> : <span className="pill pill-neutral">Skipped</span>}
            <button type="button" onClick={() => go(s.n)} style={{ minHeight: 0, padding: "4px 9px", fontSize: 11.5 }}>
              {s.done ? "Change" : "Finish"}
            </button>
          </li>
        ))}
      </ul>
      <h3>Next</h3>
      <div className="next">
        <Link href="/ops"><b>Open Governance Ops</b><span>Counts and rates with their denominators.</span></Link>
        <Link href="/ops/findings"><b>Browse findings</b><span>Each one tied to a control, a turn and a reason.</span></Link>
        <Link href="/docs/sdk"><b>Read the SDK docs</b><span>Request shapes and a drop-in client.</span></Link>
      </div>
      <p className="writes">
        Evaluation results are evidence, not certification. Passing these tests does not make a
        deployment HIPAA-compliant.
      </p>
    </>
  );
}
