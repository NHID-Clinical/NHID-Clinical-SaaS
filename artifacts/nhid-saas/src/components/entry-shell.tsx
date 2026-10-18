/**
 * The frame around every screen a person sees before they are signed in:
 * workspace creation, API-key sign-in, email sign-in and the admin console
 * login.
 *
 * Same visual system as the governance workspace (OPS_CSS): a navy product
 * bar, off-white canvas, white cards, one clinical blue accent, no gradients,
 * glows or glass. A compliance analyst should recognise it as the same tool
 * they will be working in once they are through the door.
 */
import { ReactNode } from "react";
import { Link } from "wouter";
import { OPS_CSS } from "@/pages/ops/ops-ui";
import { API_CONNECTED } from "@/lib/config";

export const ENTRY_CSS = `
.ops.entry { padding: 0; min-height: 100dvh; display: flex; flex-direction: column; }
.entry-bar { display: flex; align-items: center; gap: 14px; height: 52px; padding: 0 24px; background: #102a43; color: #fff; }
.entry-bar .mark { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 6px; background: #1769aa; font-weight: 800; font-size: 14px; }
.entry-bar .name { font-weight: 650; letter-spacing: -.01em; }
.entry-bar .name span { color: #9fb3c8; font-weight: 450; margin-left: 8px; }
.entry-bar nav { margin-left: auto; display: flex; gap: 4px; }
.ops .entry-bar a { color: #d9e2ec; font-size: 12.5px; padding: 6px 10px; border-radius: 5px; }
.ops .entry-bar a:hover { background: rgba(255,255,255,.08); color: #fff; text-decoration: none; }
.entry-main { flex: 1; width: 100%; max-width: 1080px; margin: 0 auto; padding: clamp(24px, 5vw, 56px) 24px 40px;
  display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 440px); gap: clamp(24px, 4vw, 56px); align-items: start; }
.entry-main.single { grid-template-columns: minmax(0, 440px); justify-content: center; }
.entry-intro h1 { font-size: clamp(26px, 3vw, 34px); margin-bottom: 12px; }
.entry-intro .lead { color: var(--ops-muted); font-size: 15px; line-height: 1.6; max-width: 520px; margin: 0 0 24px; }
.entry-intro ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 14px; }
.entry-intro li { display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: 12px; align-items: start; }
.entry-intro li .n { width: 32px; height: 32px; border-radius: 6px; background: var(--ops-blue-soft); color: var(--ops-blue); display: flex; align-items: center; justify-content: center; font-weight: 750; font-size: 13px; }
.entry-intro li b { display: block; font-size: 13.5px; margin-bottom: 2px; }
.entry-intro li span { color: var(--ops-muted); font-size: 12.5px; }
.ops .entry-card { padding: 0; overflow: hidden; }
.entry-card .tabs { display: flex; border-bottom: 1px solid var(--ops-border); background: #f8fafc; }
.ops .entry-card .tabs button { flex: 1; border: 0; border-radius: 0; background: transparent; min-height: 44px; color: var(--ops-muted); border-bottom: 3px solid transparent; margin-bottom: -1px; }
.ops .entry-card .tabs button[aria-selected="true"] { color: var(--ops-blue); border-bottom-color: var(--ops-blue); background: #fff; }
.entry-card .body { padding: 22px 24px 24px; }
.entry-card h2 { font-size: 17px; margin-bottom: 4px; }
.entry-card .field { margin-top: 16px; }
.entry-card .field label { display: block; font-size: 12px; font-weight: 650; color: #334e68; margin-bottom: 5px; }
.entry-card .field .hint { font-size: 11.5px; color: var(--ops-faint); margin-top: 5px; line-height: 1.5; }
.entry-card .field .err { font-size: 11.5px; color: var(--ops-exception); margin-top: 5px; }
.ops .entry-card input { width: 100%; min-height: 40px; font-size: 14px; }
.ops .entry-card input.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; }
.ops a.btn { display: inline-flex; align-items: center; justify-content: center; border: 1px solid #cbd6e2; border-radius: 5px; padding: 8px 12px; font-size: 12px; font-weight: 650; min-height: 34px; color: #27445f; background: #fff; }
.ops a.btn:hover { text-decoration: none; background: #f5f9fd; color: #27445f; }
.ops a.btn.primary { background: var(--ops-blue); border-color: var(--ops-blue); color: #fff; }
.ops a.btn.primary:hover { background: #0e568f; color: #fff; }
.ops .entry-card a.btn.block, .ops .entry-card button.block { width: 100%; min-height: 40px; margin-top: 18px; font-size: 13px; }
.entry-card .plan { margin-top: 16px; border: 1px solid var(--ops-border); border-radius: 6px; padding: 12px 14px; background: #f8fafc; font-size: 12.5px; }
.entry-card .plan .row { display: flex; justify-content: space-between; font-weight: 650; margin-bottom: 4px; }
.entry-card .alt { padding: 14px 24px; border-top: 1px solid var(--ops-border); background: #f8fafc; font-size: 12.5px; color: var(--ops-muted); }
.entry-card .alt p { margin: 0 0 6px; } .entry-card .alt p:last-child { margin: 0; }
.entry-foot { text-align: center; font-size: 11.5px; color: var(--ops-faint); padding: 0 24px 24px; }
.ops .keybox { display: flex; gap: 8px; align-items: center; border: 1px solid var(--ops-border); border-radius: 6px; padding: 10px 12px; background: #f8fafc; margin-top: 14px; }
.ops .keybox code { flex: 1; font-size: 12px; overflow-wrap: anywhere; color: #102a43; }
@media (max-width: 860px) {
  .entry-main { grid-template-columns: minmax(0, 1fr); }
  .entry-bar nav a.optional { display: none; }
  .entry-bar .name span:not(.mark) { display: none; }
  /* On a phone the action comes first; the explanation follows it. */
  .entry-main > section:last-child { order: -1; }
}
`;

export function EntryShell({ intro, children, single = false }: { intro?: ReactNode; children: ReactNode; single?: boolean }) {
  return (
    <div className="ops entry">
      <style>{OPS_CSS}{ENTRY_CSS}</style>
      <header className="entry-bar">
        <Link href="/" className="name" style={{ display: "flex", alignItems: "center", gap: 10, color: "#fff", padding: 0 }}>
          <span className="mark" aria-hidden="true" style={{ marginLeft: 0, color: "#fff" }}>N</span>
          NHID Clinical<span>Governance workspace</span>
        </Link>
        <nav aria-label="Public">
          <Link href="/ops">Demonstration</Link>
          <Link href="/pricing" className="optional">Plans</Link>
          <Link href="/signin">Sign in</Link>
        </nav>
      </header>
      <main className={`entry-main${single ? " single" : ""}`}>
        {intro && <section className="entry-intro">{intro}</section>}
        <section>{children}</section>
      </main>
      <footer className="entry-foot">
        NHID Clinical · Healthcare voice-AI governance monitoring and evidence
        {!API_CONNECTED && " · Public demonstration build"}
      </footer>
    </div>
  );
}

/**
 * Shown in place of a form that needs the backend when this build has none.
 * The reader gets the reason and a working next step, not an error toast.
 */
export function NotConnected({ what }: { what: string }) {
  return (
    <>
      <div className="notice notice-demo" style={{ marginTop: 16 }}>
        <span>
          <strong>Not available in this build.</strong> This is the public demonstration, hosted
          without a backend, so {what} cannot work here yet. Workspaces open when the hosted
          service launches.
        </span>
      </div>
      <Link href="/ops" className="btn primary block">Open the recorded demonstration</Link>
    </>
  );
}
