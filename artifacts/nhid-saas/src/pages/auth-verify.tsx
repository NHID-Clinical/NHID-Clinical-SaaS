/**
 * Redeem a sign-in link.
 *
 * The token arrives in the query string, is exchanged for a session cookie the
 * server sets, and is then gone from the URL — replaced rather than pushed, so
 * that the back button cannot return to a page whose address contains a
 * credential. Nothing is written to `localStorage`: the session is the cookie,
 * and this page never holds it.
 *
 * A spent or expired link lands here too. It says so plainly and offers a new
 * one, because the most common reason to see this is the benign one — the link
 * sat in a mailbox too long, or a scanner followed it first.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";

import { authApi } from "@/lib/auth-api";
import { SESSION_QUERY_KEY } from "@/hooks/use-session";
import { OPS_CSS } from "./ops/ops-ui";

type State = { phase: "working" } | { phase: "failed"; detail: string };

export default function AuthVerify() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [state, setState] = useState<State>({ phase: "working" });
  // React runs effects twice in development's StrictMode. A single-use token
  // would be spent by the first run and rejected by the second, so a verified
  // sign-in would show an error. Guarding here is not defensive noise.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const token = new URLSearchParams(window.location.search).get("token");
    if (!token) {
      setState({ phase: "failed", detail: "That link is missing its token." });
      return;
    }

    // Out of the address bar before anything else, including before the
    // request resolves: the URL is in history, and on a shared machine that is
    // a live credential sitting in plain sight.
    window.history.replaceState({}, "", window.location.pathname);

    authApi.verify(token)
      .then((session) => {
        queryClient.setQueryData(SESSION_QUERY_KEY, session);
        navigate("/ops", { replace: true });
      })
      .catch((error) => setState({
        phase: "failed",
        detail: error?.message ?? "That sign-in link did not work.",
      }));
  }, [navigate, queryClient]);

  return (
    <div className="ops" style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
      <style>{OPS_CSS}</style>
      <div className="card" style={{ width: "min(440px, calc(100vw - 32px))", padding: "28px 30px" }}>
        {state.phase === "working" ? (
          <>
            <h1 style={{ marginBottom: 6 }}>Signing you in…</h1>
            <p className="muted" style={{ margin: 0 }}>One moment.</p>
          </>
        ) : (
          <>
            <h1 style={{ marginBottom: 6 }}>That link didn&apos;t work</h1>
            <p className="muted" style={{ marginTop: 0 }}>{state.detail}</p>
            <p className="muted" style={{ fontSize: 12.5 }}>
              Sign-in links work once and expire after 15 minutes — so a link
              you already used, or one that sat in your inbox overnight, will
              land here.
            </p>
            <Link href="/signin">
              <button className="primary" style={{ marginTop: 10 }}>Get a new link</button>
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
