/**
 * Security & audit — the organization's trust center.
 *
 * Calm, operational layout (neutral cards, 8pt spacing, semantic colour only
 * for status): a posture strip, the scoped keys, the activity log with an
 * export, and two lists side by side — the controls in place and the gaps
 * that are not. The gaps come from the API (gateway.SECURITY_GAPS), so this
 * page cannot show a reassuring picture without them.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, KeyRound, ListChecks, LogIn, ScrollText, ShieldCheck } from "lucide-react";
import { useApiKey } from "@/hooks/use-nhid";
import { apiUrl } from "@/lib/config";
import { securityApi, SecurityApiError, type KeyScope, type ScopedKey, type SsoConfigInput } from "@/lib/security-api";

const SOON_MS = 14 * 86_400_000;

const tone = {
  ok: { fg: "#0e7a57", bg: "rgba(14,122,87,0.08)", border: "rgba(14,122,87,0.25)" },
  warn: { fg: "#8a5a00", bg: "rgba(201,138,0,0.10)", border: "rgba(201,138,0,0.35)" },
  risk: { fg: "#a8271a", bg: "rgba(168,39,26,0.08)", border: "rgba(168,39,26,0.28)" },
  neutral: { fg: "#3d4a5c", bg: "#f1f4f8", border: "#dfe5ec" },
};

function Pill({ kind, children }: { kind: keyof typeof tone; children: React.ReactNode }) {
  const t = tone[kind];
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: 11,
                   fontWeight: 600, color: t.fg, background: t.bg, border: `1px solid ${t.border}`,
                   whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

function Card({ title, icon: Icon, action, children }: {
  title: string; icon: React.ElementType; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section style={{ background: "var(--nhid-surface, #fff)", border: "1px solid var(--nhid-border, #dfe5ec)",
                      borderRadius: 8, padding: 24, marginBottom: 16 }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                       gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <h2 style={{ display: "flex", alignItems: "center", gap: 8, margin: 0, fontSize: 14,
                     fontWeight: 700, color: "var(--nhid-text, #172b4d)" }}>
          <Icon size={16} aria-hidden /> {title}
        </h2>
        {action}
      </header>
      {children}
    </section>
  );
}

function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="animate-pulse"
             style={{ height: 16, borderRadius: 4, background: "#e9eef4", marginBottom: 8,
                      width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: 0, padding: "16px 0", fontSize: 13, color: "var(--nhid-muted, #5f6b7a)" }}>{children}</p>;
}

function Problem({ error }: { error: unknown }) {
  const message = error instanceof SecurityApiError ? error.message : "Could not load this section.";
  return (
    <div role="alert" style={{ padding: 12, borderRadius: 6, fontSize: 13, color: tone.risk.fg,
                               background: tone.risk.bg, border: `1px solid ${tone.risk.border}` }}>
      {message}
    </div>
  );
}

function Stat({ label, value, note, testId, kind = "neutral" }: {
  label: string; value: React.ReactNode; note?: string; testId: string; kind?: keyof typeof tone;
}) {
  return (
    <div data-testid={testId}
         style={{ flex: "1 1 160px", padding: 16, borderRadius: 8, background: "var(--nhid-surface, #fff)",
                  border: `1px solid ${kind === "neutral" ? "var(--nhid-border, #dfe5ec)" : tone[kind].border}` }}>
      <div style={{ fontSize: 12, color: "var(--nhid-muted, #5f6b7a)", marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: kind === "neutral" ? "var(--nhid-text, #172b4d)" : tone[kind].fg }}>
        {value}
      </div>
      {note && <div style={{ fontSize: 12, color: "var(--nhid-muted, #5f6b7a)", marginTop: 4 }}>{note}</div>}
    </div>
  );
}

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—");
const th: React.CSSProperties = { textAlign: "left", padding: "8px 12px", fontSize: 12, fontWeight: 600,
                                  color: "var(--nhid-muted, #5f6b7a)", borderBottom: "1px solid var(--nhid-border, #dfe5ec)" };
const td: React.CSSProperties = { padding: "10px 12px", fontSize: 13, color: "var(--nhid-text, #172b4d)",
                                  borderBottom: "1px solid #eef2f6", verticalAlign: "top" };

function KeyStatus({ k }: { k: ScopedKey }) {
  if (k.revoked_at) return <Pill kind="neutral">Revoked</Pill>;
  if (!k.active) return <Pill kind="neutral">Expired</Pill>;
  if (new Date(k.expires_at).getTime() - Date.now() <= SOON_MS) return <Pill kind="warn">Expires soon</Pill>;
  return <Pill kind="ok">Active</Pill>;
}

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

const buttonStyle: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", fontSize: 12,
  fontWeight: 600, borderRadius: 6, border: "1px solid var(--nhid-border, #dfe5ec)",
  background: "#fff", color: "var(--nhid-text, #172b4d)", cursor: "pointer",
};

function KeysCard({ apiKey }: { apiKey: string }) {
  const qc = useQueryClient();
  const keys = useQuery({ queryKey: ["security-keys", apiKey], queryFn: () => securityApi.keys(apiKey) });
  const [label, setLabel] = useState("");
  const [scope, setScope] = useState<KeyScope>("read");
  const [days, setDays] = useState(90);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [problem, setProblem] = useState<unknown>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["security-keys"] });
    qc.invalidateQueries({ queryKey: ["security-summary"] });
    qc.invalidateQueries({ queryKey: ["security-activity"] });
  };
  const create = useMutation({
    mutationFn: () => securityApi.createKey(apiKey, { label: label.trim(), scope, expires_in_days: days }),
    onSuccess: (k) => { setRevealed(k.api_key); setLabel(""); setProblem(null); refresh(); },
    onError: setProblem,
  });
  const revoke = useMutation({
    mutationFn: (keyId: string) => securityApi.revokeKey(apiKey, keyId),
    onSuccess: () => { setProblem(null); refresh(); },
    onError: setProblem,
  });

  return (
    <Card title="API keys" icon={KeyRound}>
      <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--nhid-muted, #5f6b7a)", lineHeight: 1.6 }}>
        Give each pipeline or person the narrowest key that works. <strong>Ingest</strong> keys can
        only send evidence in; <strong>read</strong> keys can only look. Every key expires within a
        year. Creating and revoking keys needs an owner's sign-in.
      </p>
      {revealed && (
        <div role="status" style={{ padding: 12, marginBottom: 16, borderRadius: 6, fontSize: 13,
                                     background: tone.warn.bg, border: `1px solid ${tone.warn.border}` }}>
          Copy this key now. It cannot be shown again:{" "}
          <code style={{ fontFamily: "monospace", wordBreak: "break-all" }}>{revealed}</code>
        </div>
      )}
      {problem != null && <div style={{ marginBottom: 16 }}><Problem error={problem} /></div>}
      <form onSubmit={(e) => { e.preventDefault(); if (label.trim()) create.mutate(); }}
            style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 16 }}>
        <label style={{ fontSize: 12, color: "var(--nhid-muted, #5f6b7a)" }}>Label<br />
          <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80}
                 placeholder="e.g. Claims ingest pipeline"
                 style={{ padding: "6px 8px", fontSize: 13, borderRadius: 6, border: "1px solid #cfd8e3", minWidth: 220 }} />
        </label>
        <label style={{ fontSize: 12, color: "var(--nhid-muted, #5f6b7a)" }}>Scope<br />
          <select value={scope} onChange={(e) => setScope(e.target.value as KeyScope)}
                  style={{ padding: "6px 8px", fontSize: 13, borderRadius: 6, border: "1px solid #cfd8e3" }}>
            <option value="read">read (look only)</option>
            <option value="ingest">ingest (send evidence only)</option>
            <option value="full">full</option>
          </select>
        </label>
        <label style={{ fontSize: 12, color: "var(--nhid-muted, #5f6b7a)" }}>Expires in (days)<br />
          <input type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))}
                 style={{ padding: "6px 8px", fontSize: 13, borderRadius: 6, border: "1px solid #cfd8e3", width: 96 }} />
        </label>
        <button type="submit" disabled={create.isPending || !label.trim()} style={buttonStyle}>
          {create.isPending ? "Creating…" : "Create key"}
        </button>
      </form>
      {keys.isLoading && <Skeleton />}
      {keys.isError && <Problem error={keys.error} />}
      {keys.data && keys.data.length === 0 && (
        <Empty>No scoped keys yet. The organization's primary key is the only credential in use.</Empty>
      )}
      {keys.data && keys.data.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>
              <th style={th}>Label</th><th style={th}>Key</th><th style={th}>Scope</th>
              <th style={th}>Expires</th><th style={th}>Last used</th><th style={th}>Status</th><th style={th} />
            </tr></thead>
            <tbody>
              {keys.data.map((k) => (
                <tr key={k.key_id} data-testid={`key-row-${k.key_id}`}>
                  <td style={td}>{k.label}<div style={{ fontSize: 11, color: "#7a8696" }}>by {k.created_by ?? "—"}</div></td>
                  <td style={td}><code style={{ fontFamily: "monospace", fontSize: 12 }}>{k.key_prefix}…</code></td>
                  <td style={td}><Pill kind="neutral">{k.scope}</Pill></td>
                  <td style={td}>{fmt(k.expires_at)}</td>
                  <td style={td}>{fmt(k.last_used_at)}</td>
                  <td style={td}><KeyStatus k={k} /></td>
                  <td style={td}>
                    {k.active && (
                      <button type="button" style={buttonStyle} disabled={revoke.isPending}
                              onClick={() => revoke.mutate(k.key_id)}>Revoke</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

const inputStyle: React.CSSProperties = { padding: "6px 8px", fontSize: 13, borderRadius: 6,
                                          border: "1px solid #cfd8e3", width: "100%" };

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div style={{ flex: "1 1 240px" }}>
      <label htmlFor={id} style={{ display: "block", fontSize: 12, color: "var(--nhid-muted, #5f6b7a)", marginBottom: 4 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const EMPTY_SSO: SsoConfigInput = { issuer: "", client_id: "", client_secret: "", authorization_endpoint: "",
                                     token_endpoint: "", jwks_uri: "", allowed_domains: [], default_role: "member" };

function SsoCard({ apiKey }: { apiKey: string }) {
  const qc = useQueryClient();
  const config = useQuery({ queryKey: ["security-sso", apiKey], queryFn: () => securityApi.sso(apiKey) });
  const [form, setForm] = useState<SsoConfigInput>(EMPTY_SSO);
  const [domains, setDomains] = useState("");
  const [editing, setEditing] = useState(false);
  const [problem, setProblem] = useState<unknown>(null);
  const done = () => { setEditing(false); setProblem(null);
                       qc.invalidateQueries({ queryKey: ["security-sso"] });
                       qc.invalidateQueries({ queryKey: ["security-activity"] }); };
  const save = useMutation({
    mutationFn: () => securityApi.saveSso(apiKey, {
      ...form, client_secret: form.client_secret || undefined,
      allowed_domains: domains.split(/[\s,]+/).filter(Boolean) }),
    onSuccess: done, onError: setProblem,
  });
  const remove = useMutation({ mutationFn: () => securityApi.removeSso(apiKey), onSuccess: done, onError: setProblem });
  const set = (k: keyof SsoConfigInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm({ ...form, [k]: e.target.value });

  const c = config.data;
  const showForm = config.data === null || editing;
  return (
    <Card title="Single sign-on (OpenID Connect)" icon={LogIn}>
      {config.isLoading && <Skeleton rows={2} />}
      {config.isError && <Problem error={config.error} />}
      {problem != null && <div style={{ marginBottom: 16 }}><Problem error={problem} /></div>}
      {c && !editing && (
        <div data-testid="sso-status">
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <Pill kind="ok">Configured</Pill>
            <span style={{ fontSize: 13 }}>{c.issuer}</span>
          </div>
          <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "6px 16px", margin: 0, fontSize: 13 }}>
            <dt style={{ color: "var(--nhid-muted, #5f6b7a)" }}>Allowed domains</dt><dd style={{ margin: 0 }}>{c.allowed_domains.join(", ")}</dd>
            <dt style={{ color: "var(--nhid-muted, #5f6b7a)" }}>New people join as</dt><dd style={{ margin: 0 }}>{c.default_role}</dd>
            <dt style={{ color: "var(--nhid-muted, #5f6b7a)" }}>Client ID</dt><dd style={{ margin: 0 }}><code>{c.client_id}</code></dd>
            <dt style={{ color: "var(--nhid-muted, #5f6b7a)" }}>Client secret</dt>
            <dd style={{ margin: 0 }}>{c.has_client_secret ? "Client secret stored (encrypted; never shown)" : "None (public client, PKCE only)"}</dd>
          </dl>
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button type="button" style={buttonStyle} onClick={() => {
              setForm({ ...EMPTY_SSO, issuer: c.issuer, client_id: c.client_id,
                        authorization_endpoint: c.authorization_endpoint, token_endpoint: c.token_endpoint,
                        jwks_uri: c.jwks_uri, default_role: c.default_role });
              setDomains(c.allowed_domains.join(", ")); setEditing(true); }}>Edit</button>
            <button type="button" style={buttonStyle} disabled={remove.isPending} onClick={() => remove.mutate()}>Remove</button>
          </div>
        </div>
      )}
      {config.data !== undefined && showForm && (
        <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          {config.data === null && (
            <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--nhid-muted, #5f6b7a)", lineHeight: 1.6 }}>
              Single sign-on is not configured. People sign in with an email link. Connect your
              identity provider (Okta, Entra ID, Google Workspace) so they sign in there instead.
              Register this callback with your provider: <code>{apiUrl("/saas/auth/sso/callback")}</code>.
            </p>
          )}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
            <Field id="sso-issuer" label="Issuer"><input id="sso-issuer" style={inputStyle} value={form.issuer} onChange={set("issuer")} placeholder="https://your-idp.example" /></Field>
            <Field id="sso-client" label="Client ID"><input id="sso-client" style={inputStyle} value={form.client_id} onChange={set("client_id")} /></Field>
            <Field id="sso-secret" label="Client secret (optional)"><input id="sso-secret" type="password" autoComplete="off" style={inputStyle} value={form.client_secret} onChange={set("client_secret")} /></Field>
            <Field id="sso-auth" label="Authorization endpoint"><input id="sso-auth" style={inputStyle} value={form.authorization_endpoint} onChange={set("authorization_endpoint")} /></Field>
            <Field id="sso-token" label="Token endpoint"><input id="sso-token" style={inputStyle} value={form.token_endpoint} onChange={set("token_endpoint")} /></Field>
            <Field id="sso-jwks" label="JWKS URI"><input id="sso-jwks" style={inputStyle} value={form.jwks_uri} onChange={set("jwks_uri")} /></Field>
            <Field id="sso-domains" label="Allowed email domains"><input id="sso-domains" style={inputStyle} value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="payer.example, payer-ops.example" /></Field>
            <Field id="sso-role" label="New people join as">
              <select id="sso-role" style={inputStyle} value={form.default_role} onChange={set("default_role")}>
                <option value="member">member</option><option value="auditor">auditor (read-only)</option>
              </select>
            </Field>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" style={buttonStyle} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save"}</button>
            {editing && <button type="button" style={buttonStyle} onClick={() => setEditing(false)}>Cancel</button>}
          </div>
        </form>
      )}
    </Card>
  );
}

function ActivityCard({ apiKey }: { apiKey: string }) {
  const events = useQuery({ queryKey: ["security-activity", apiKey], queryFn: () => securityApi.activity(apiKey) });
  const [problem, setProblem] = useState<unknown>(null);
  const exportAs = async (format: "csv" | "json") => {
    try {
      const body = await securityApi.exportActivity(apiKey, format);
      download(`nhid-activity.${format}`, body, format === "csv" ? "text/csv" : "application/json");
      setProblem(null);
    } catch (error) { setProblem(error); }
  };
  return (
    <Card title="Activity log" icon={ScrollText} action={
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" style={buttonStyle} onClick={() => exportAs("csv")}><Download size={14} aria-hidden />Export CSV</button>
        <button type="button" style={buttonStyle} onClick={() => exportAs("json")}><Download size={14} aria-hidden />Export JSON</button>
      </div>
    }>
      <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--nhid-muted, #5f6b7a)" }}>
        Every key, member and purge action, with who did it. Append-only: no one can edit an entry.
      </p>
      {problem != null && <div style={{ marginBottom: 16 }}><Problem error={problem} /></div>}
      {events.isLoading && <Skeleton rows={4} />}
      {events.isError && <Problem error={events.error} />}
      {events.data && events.data.length === 0 && <Empty>No administrative activity recorded yet.</Empty>}
      {events.data && events.data.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr><th style={th}>When</th><th style={th}>Who</th><th style={th}>Action</th><th style={th}>Target</th></tr></thead>
            <tbody>
              {events.data.map((e) => (
                <tr key={e.activity_id}>
                  <td style={td}>{new Date(e.occurred_at).toLocaleString()}</td>
                  <td style={td}>{e.actor}</td>
                  <td style={td}><code style={{ fontFamily: "monospace", fontSize: 12 }}>{e.action}</code></td>
                  <td style={td}>{e.target ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function SecurityPanel({ apiKey }: { apiKey: string }) {
  const summary = useQuery({ queryKey: ["security-summary", apiKey], queryFn: () => securityApi.summary(apiKey) });
  const s = summary.data;
  return (
    <div style={{ maxWidth: 1080, margin: "0 auto", padding: "24px 16px" }}>
      <header style={{ marginBottom: 24 }}>
        <h1 style={{ display: "flex", alignItems: "center", gap: 8, margin: 0, fontSize: 20, fontWeight: 700,
                     color: "var(--nhid-text, #172b4d)" }}>
          <ShieldCheck size={20} aria-hidden /> Security &amp; audit
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--nhid-muted, #5f6b7a)" }}>
          What protects this organization's data, who changed what, and what is not yet in place.
        </p>
      </header>

      {summary.isError && <div style={{ marginBottom: 16 }}><Problem error={summary.error} /></div>}
      {summary.isLoading && <Skeleton rows={2} />}
      {s && (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
          <Stat testId="posture-active-keys" label="Active scoped keys" value={s.keys.active}
                note={Object.entries(s.keys.by_scope).map(([k, v]) => `${v} ${k}`).join(" · ") || "none"} />
          <Stat testId="posture-expiring" label="Expiring within 14 days" value={s.keys.expiring_within_14_days}
                kind={s.keys.expiring_within_14_days > 0 ? "warn" : "ok"} />
          <Stat testId="posture-members" label="Members" value={s.members.total}
                note={Object.entries(s.members.by_role).map(([r, n]) => `${n} ${r}`).join(" · ")} />
          <Stat testId="posture-retention" label="Transcript retention" value={`${s.retention.effective_days} days`}
                note={`${s.retention.transcripts_held} held · ${s.retention.policy_source.replace("_", " ")}`} />
        </div>
      )}

      {s && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: 16, marginBottom: 16 }}>
          <Card title="Controls in place" icon={ListChecks}>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {s.controls.map((c) => (
                <li key={c} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "6px 0", fontSize: 13 }}>
                  <CheckCircle2 size={16} color={tone.ok.fg} aria-hidden style={{ flexShrink: 0, marginTop: 1 }} />{c}
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Not in place" icon={AlertTriangle}>
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {s.gaps.map((g) => (
                <li key={g.id} style={{ padding: "6px 0", fontSize: 13 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 600, color: tone.warn.fg }}>
                    <AlertTriangle size={16} aria-hidden style={{ flexShrink: 0 }} />{g.title}
                  </div>
                  <div style={{ color: "var(--nhid-muted, #5f6b7a)", marginLeft: 24 }}>{g.detail}</div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      <KeysCard apiKey={apiKey} />
      <SsoCard apiKey={apiKey} />
      <ActivityCard apiKey={apiKey} />
    </div>
  );
}

export default function SecurityPage() {
  const apiKey = useApiKey();
  if (!apiKey) return null;
  return <SecurityPanel apiKey={apiKey} />;
}
