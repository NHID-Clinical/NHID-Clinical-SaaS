/**
 * Sign in with a link to your mailbox.
 *
 * No password field, and that is the design. A password is a stored secret to
 * protect, a reset flow to build, and a reuse liability inherited from every
 * other site the person has an account on. A link to a verified mailbox proves
 * the same thing — control of that address — using a credential they already
 * maintain.
 *
 * The screen tells the same story whatever is typed. A known address, an
 * unknown one and a malformed one all reach the same confirmation, because the
 * alternative is an oracle for which members of a payer's compliance team hold
 * accounts. That is reconnaissance for a phishing run, and it is free if this
 * page distinguishes the cases.
 */
import { useState } from "react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";

import { AuthError, authApi } from "@/lib/auth-api";
import { EntryShell, NotConnected } from "@/components/entry-shell";
import { API_CONNECTED, apiUrl } from "@/lib/config";

// What a refused single sign-on means, in words. The API sends back only a
// short code (gateway._sso_fail), never the detail of which check failed.
const SSO_ERRORS: Record<string, string> = {
  domain_not_allowed: "That email domain is not allowed to sign in to this organization.",
  email_not_verified: "Your identity provider has not verified that email address.",
  invalid_state: "That sign-in link was already used or has expired. Please start again.",
  invalid_nonce: "The sign-in could not be verified. Please start again.",
  invalid_id_token: "Your identity provider's response could not be verified.",
  token_exchange_failed: "Your identity provider did not complete the sign-in.",
  provider_error: "Your identity provider declined the sign-in.",
  no_email: "Your identity provider did not share an email address.",
};

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  // Set only when the deployment has email sign-in switched off (503). That
  // answer is the same for every address, so showing it reveals nothing.
  const [disabled, setDisabled] = useState<string | null>(null);
  const [ssoProblem, setSsoProblem] = useState<string | null>(() => {
    const code = new URLSearchParams(window.location.search).get("sso_error");
    return code ? (SSO_ERRORS[code] ?? "Single sign-on did not complete. Please start again.") : null;
  });
  const [ssoPending, setSsoPending] = useState(false);

  // Ask the API whether this domain uses SSO without following the redirect:
  // a redirect means yes (then go there for real), a 404 means no.
  const startSso = async () => {
    const address = email.trim();
    if (!address) return;
    setSsoPending(true);
    setSsoProblem(null);
    const url = apiUrl(`/saas/auth/sso/start?email=${encodeURIComponent(address)}`);
    try {
      const res = await fetch(url, { redirect: "manual", credentials: "include" });
      if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
        window.location.assign(url);
        return;
      }
      setSsoProblem(res.status === 404
        ? "Single sign-on isn't set up for that email domain. Use an email link instead."
        : "Single sign-on could not start. Use an email link instead.");
    } catch {
      setSsoProblem("Single sign-on could not start. Use an email link instead.");
    } finally {
      setSsoPending(false);
    }
  };

  const request = useMutation({
    mutationFn: (address: string) => authApi.requestLink(address),
    // Both paths land here on purpose. Even a transport failure shows the
    // confirmation rather than "that address isn't registered", which is a
    // sentence this product must never be able to produce.
    onError: (error) => {
      if (error instanceof AuthError && error.status === 503) setDisabled(error.message);
    },
    onSettled: (_data, error) => {
      if (!(error instanceof AuthError && error.status === 503)) setSent(true);
    },
  });

  return (
    <EntryShell single>
      <style>{EXTRA_CSS}</style>
      <div className="signin-card card">
        <h1 style={{ marginBottom: 6 }}>Sign in</h1>

        {!API_CONNECTED ? (
          <NotConnected what="email sign-in" />
        ) : disabled ? (
          <div className="notice notice-demo" style={{ marginTop: 16 }} role="status">
            <span>{disabled}</span>
          </div>
        ) : sent ? (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              If that address has access to an organization, a sign-in link is on its
              way. It works once and expires in 15&nbsp;minutes.
            </p>
            <div className="notice notice-demo" style={{ marginTop: 18 }}>
              Nothing arrived? The address may not be a member of any organization
              yet — an <strong>owner</strong> has to invite it from their Settings
              screen. There is no self-service sign-up.
            </div>
            <button style={{ marginTop: 16 }} onClick={() => { setSent(false); setEmail(""); }}>
              Use a different address
            </button>
          </>
        ) : (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              We&apos;ll email you a link. No password to remember, and nothing for
              this site to store.
            </p>
            <form
              onSubmit={(e) => { e.preventDefault(); if (email.trim()) request.mutate(email.trim()); }}
              style={{ marginTop: 18 }}
            >
              <label htmlFor="signin-email" className="field-label">Work email</label>
              <input
                id="signin-email"
                type="email"
                autoComplete="email"
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@payer.example"
                style={{ width: "100%", marginTop: 6, padding: "9px 11px", fontSize: 14 }}
              />
              <button type="submit" className="primary"
                      disabled={request.isPending || !email.trim()}
                      style={{ width: "100%", marginTop: 14, padding: "9px 12px" }}>
                {request.isPending ? "Sending…" : "Email me a link"}
              </button>
              <button type="button" onClick={startSso}
                      disabled={ssoPending || !email.trim()}
                      style={{ width: "100%", marginTop: 8, padding: "9px 12px" }}>
                {ssoPending ? "Checking…" : "Continue with single sign-on"}
              </button>
            </form>
            {ssoProblem && (
              <div className="notice notice-demo" role="alert" style={{ marginTop: 14 }}>
                <span>{ssoProblem}</span>
              </div>
            )}
          </>
        )}

        <hr className="rule" />

        <p className="muted small">
          Running a pipeline rather than a browser? Ingest and evaluation
          authenticate with your organization&apos;s <strong>API key</strong>, which
          is unchanged. This sign-in exists so that a review decision carries the
          name of the person who made it.
        </p>
        <p className="muted small">
          <Link href="/ops">Look around the recorded demonstration</Link> — no
          account needed, and nothing in it is customer data.
        </p>
        <p className="muted small">
          New organization? <Link href="/">Create a workspace</Link>. Platform
          administrator? <Link href="/admin">Operations console</Link>.
        </p>
      </div>
    </EntryShell>
  );
}

const EXTRA_CSS = `
.ops .signin-card { width: 100%; padding: 28px 30px 24px; }
.ops .field-label { display:block; font-size:12px; font-weight:600; color:var(--ops-muted);
  text-transform:uppercase; letter-spacing:0.05em; }
.ops .rule { border:0; border-top:1px solid var(--ops-border); margin:22px 0 16px; }
.ops .small { font-size:12.5px; line-height:1.55; margin:0 0 8px; }
`;
