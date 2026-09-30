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

import { authApi } from "@/lib/auth-api";
import { OPS_CSS } from "./ops/ops-ui";

export default function SignIn() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  const request = useMutation({
    mutationFn: (address: string) => authApi.requestLink(address),
    // Both paths land here on purpose. Even a transport failure shows the
    // confirmation rather than "that address isn't registered", which is a
    // sentence this product must never be able to produce.
    onSettled: () => setSent(true),
  });

  return (
    <div className="ops" style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
      <style>{OPS_CSS}{EXTRA_CSS}</style>
      <div className="signin-card card">
        <h1 style={{ marginBottom: 6 }}>Sign in</h1>

        {sent ? (
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
            </form>
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
      </div>
    </div>
  );
}

const EXTRA_CSS = `
.ops .signin-card { width: min(440px, calc(100vw - 32px)); padding: 28px 30px 24px; }
.ops .field-label { display:block; font-size:12px; font-weight:600; color:var(--ops-muted);
  text-transform:uppercase; letter-spacing:0.05em; }
.ops .rule { border:0; border-top:1px solid var(--ops-border); margin:22px 0 16px; }
.ops .small { font-size:12.5px; line-height:1.55; margin:0 0 8px; }
`;
