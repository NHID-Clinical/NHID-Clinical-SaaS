/**
 * The front door: create a workspace, or sign in to one with its API key.
 *
 * Two kinds of credential exist and this page says which is which. An
 * organization's API key is for machines and pipelines; people sign in with an
 * emailed link (/signin), which is why creating a workspace asks for the
 * owner's email -- without it the organization has no human who can ever sign
 * in that way.
 *
 * On a build with no backend (the GitHub Pages demonstration) both forms are
 * replaced by a plain statement and a route into the recorded demonstration,
 * instead of forms that can only ever fail.
 */
import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Copy, Check } from "lucide-react";

import { useCreateOrg, useApiKey } from "@/hooks/use-nhid";
import { useToast } from "@/hooks/use-toast";
import { API_CONNECTED, apiUrl } from "@/lib/config";
import { EntryShell, NotConnected } from "@/components/entry-shell";

type Tab = "create" | "key";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function Intro() {
  return (
    <>
      <div className="eyebrow">Healthcare voice-AI governance</div>
      <h1>Evidence for what your voice agents did on the call</h1>
      <p className="lead">
        Evaluate AI voice agents against the NHID-Clinical controls and keep a reproducible record
        of every decision: which rule applied, what the agent attempted, and what was allowed,
        escalated or denied.
      </p>
      <ul>
        <li><span className="n">1</span><div><b>Identity and disclosure</b><span>Did the agent say it was automated, and before anything sensitive was exchanged?</span></div></li>
        <li><span className="n">2</span><div><b>Authorization before data</b><span>Was the caller's authority established before protected information moved?</span></div></li>
        <li><span className="n">3</span><div><b>Reproducible evidence</b><span>Scenario, control version, expected and observed outcome, reason code and trace for every finding.</span></div></li>
      </ul>
      <p className="muted" style={{ fontSize: 12, marginTop: 22, maxWidth: 520 }}>
        Evaluation results are evidence, not certification. Passing these tests does not make a
        deployment HIPAA-compliant.
      </p>
    </>
  );
}

function KeyReveal({ apiKey, orgName, ownerInvited, onContinue }: {
  apiKey: string; orgName: string; ownerInvited: boolean; onContinue: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(apiKey).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };
  return (
    <div className="body">
      <span className="pill pill-pass">Workspace created</span>
      <h2 style={{ marginTop: 12 }}>{orgName}</h2>
      <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
        This is the organization&apos;s API key. It is shown once and cannot be recovered; only
        its fingerprint is stored.
      </p>
      <div className="keybox">
        <code data-testid="api-key">{apiKey}</code>
        <button type="button" onClick={copy} aria-label="Copy API key">
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className="notice" style={{ marginTop: 14 }}>
        Store it in your secrets manager now. Rotate it from Settings if it is ever exposed.
      </div>
      {ownerInvited && (
        <p className="muted" style={{ fontSize: 12.5 }}>
          A sign-in link is on its way to the owner&apos;s email, for signing in as a person.
        </p>
      )}
      <button type="button" className="primary block" onClick={onContinue}>Continue to dashboard</button>
    </div>
  );
}

function CreateForm({ onCreated }: { onCreated: (key: string, org: string, invited: boolean) => void }) {
  const createOrg = useCreateOrg();
  const { toast } = useToast();
  const [orgName, setOrgName] = useState("");
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);

  const nameErr = orgName.trim().length < 2 ? "Enter at least 2 characters." : orgName.length > 120 ? "Keep it under 120 characters." : "";
  const emailErr = !EMAIL_RE.test(email.trim()) ? "Enter the owner's work email." : "";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (nameErr || emailErr) return;
    createOrg.mutate({ orgName: orgName.trim(), ownerEmail: email.trim() }, {
      onSuccess: (res) => onCreated(res.api_key, res.org_name, !!res.owner_invited),
      onError: (err) => toast({
        title: "Could not create workspace",
        description: err instanceof Error && err.message ? err.message : "The service did not respond. Try again in a moment.",
        variant: "destructive",
      }),
    });
  };

  return (
    <form className="body" onSubmit={submit} noValidate>
      <h2>Create a workspace</h2>
      <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>Free to start. Change plan any time from Billing.</p>
      <div className="field">
        <label htmlFor="org-name">Organization name</label>
        <input id="org-name" data-testid="input-orgname" value={orgName} onChange={(e) => setOrgName(e.target.value)}
               placeholder="e.g. Lakeside Health Plan" autoComplete="organization" aria-invalid={touched && !!nameErr} />
        {touched && nameErr && <div className="err">{nameErr}</div>}
      </div>
      <div className="field">
        <label htmlFor="owner-email">Owner email</label>
        <input id="owner-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
               placeholder="you@organization.example" autoComplete="email" aria-invalid={touched && !!emailErr} />
        {touched && emailErr
          ? <div className="err">{emailErr}</div>
          : <div className="hint">The owner signs in with an emailed link and can invite colleagues.</div>}
      </div>
      <div className="plan">
        <div className="row"><span>Free plan</span><span>$0 / month</span></div>
        <div className="muted">100 audit events a day · tamper-evident trail · chain verification</div>
      </div>
      <button type="submit" className="primary block" data-testid="button-submit" disabled={createOrg.isPending}>
        {createOrg.isPending ? "Creating workspace…" : "Create workspace"}
      </button>
    </form>
  );
}

function KeySignIn({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const [key, setKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(apiUrl("/saas/orgs/me"), { headers: { "X-API-Key": trimmed } });
      if (!res.ok) {
        setError(res.status === 401 || res.status === 403
          ? "That key was not recognised, or its organization is inactive."
          : `The service returned an error (${res.status}). Try again in a moment.`);
        return;
      }
      const data = await res.json();
      localStorage.setItem("nhid_api_key", trimmed);
      localStorage.setItem("nhid_org", JSON.stringify({ org_id: data.org_id, org_name: data.org_name, plan: data.plan }));
      window.dispatchEvent(new Event("storage"));
      toast({ title: "Signed in", description: data.org_name });
      onSuccess();
    } catch {
      setError("Could not reach the service. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form className="body" onSubmit={submit}>
      <h2>Sign in with an API key</h2>
      <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
        For integrations and administrators holding the organization&apos;s key.
      </p>
      <div className="field">
        <label htmlFor="api-key">API key</label>
        <input id="api-key" className="mono" value={key} onChange={(e) => { setKey(e.target.value); setError(""); }}
               placeholder="nhid_…" autoComplete="off" spellCheck={false} aria-invalid={!!error} />
        {error && <div className="err" role="alert">{error}</div>}
      </div>
      <button type="submit" className="primary block" disabled={loading || !key.trim()}>
        {loading ? "Verifying…" : "Sign in"}
      </button>
    </form>
  );
}

export default function Onboarding() {
  const [, setLocation] = useLocation();
  const apiKey = useApiKey();
  const [tab, setTab] = useState<Tab>("create");
  const [created, setCreated] = useState<{ key: string; org: string; invited: boolean } | null>(null);

  useEffect(() => {
    if (apiKey && !created) setLocation("/dashboard");
  }, [apiKey, created, setLocation]);

  return (
    <EntryShell intro={<Intro />}>
      <div className="card entry-card">
        {created ? (
          <KeyReveal apiKey={created.key} orgName={created.org} ownerInvited={created.invited}
                     onContinue={() => setLocation("/dashboard")} />
        ) : (
          <>
            <div className="tabs" role="tablist" aria-label="Get started">
              <button type="button" role="tab" aria-selected={tab === "create"} onClick={() => setTab("create")}>Create workspace</button>
              <button type="button" role="tab" aria-selected={tab === "key"} onClick={() => setTab("key")}>API key sign-in</button>
            </div>
            {!API_CONNECTED ? (
              <div className="body">
                <h2>{tab === "create" ? "Create a workspace" : "Sign in with an API key"}</h2>
                <NotConnected what={tab === "create" ? "creating a workspace" : "signing in"} />
              </div>
            ) : tab === "create" ? (
              <CreateForm onCreated={(key, org, invited) => setCreated({ key, org, invited })} />
            ) : (
              <KeySignIn onSuccess={() => setLocation("/dashboard")} />
            )}
            <div className="alt">
              <p>Team member? <Link href="/signin">Sign in with your work email</Link>.</p>
              <p>Platform administrator? <Link href="/admin">Operations console</Link>.</p>
            </div>
          </>
        )}
      </div>
    </EntryShell>
  );
}
