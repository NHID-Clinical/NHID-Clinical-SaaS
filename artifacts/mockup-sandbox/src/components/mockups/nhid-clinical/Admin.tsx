import './_group.css';
import { useState } from 'react';

const ORGS = [
  { name: 'MemorialHealth AI', plan: 'L2 Pro', status: 'active', calls: 1284, created: '2026-03-12' },
  { name: 'BayCare Systems', plan: 'L3 Enterprise', status: 'active', calls: 8902, created: '2026-01-08' },
  { name: 'Northside AI Lab', plan: 'L1 Starter', status: 'active', calls: 312, created: '2026-04-22' },
  { name: 'CedarMed Corp', plan: 'L2 Pro', status: 'past_due', calls: 0, created: '2026-02-14' },
  { name: 'PineCrest Health', plan: 'Free', status: 'active', calls: 43, created: '2026-05-01' },
  { name: 'Summit Clinical AI', plan: 'L1 Starter', status: 'canceled', calls: 0, created: '2026-03-28' },
];

const ACTIVITY = [
  { time: '14:23', event: 'ORG_STATUS_UPDATED', org: 'BayCare Systems', detail: 'status → active' },
  { time: '14:19', event: 'STRIPE_WEBHOOK_RECEIVED', org: '—', detail: 'invoice.paid' },
  { time: '13:55', event: 'ADMIN_LOGIN_SUCCESS', org: '—', detail: 'username=admin' },
  { time: '13:44', event: 'BILLING_BLOCK_APPLIED', org: 'CedarMed Corp', detail: 'status=past_due' },
  { time: '12:30', event: 'ORG_STATUS_UPDATED', org: 'Summit Clinical AI', detail: 'status → canceled' },
];

function StatusPill({ status }: { status: string }) {
  const cfg: Record<string, { bg: string; color: string; label: string }> = {
    active: { bg: 'rgba(0,194,168,0.12)', color: '#00c2a8', label: 'Active' },
    past_due: { bg: 'rgba(251,191,36,0.12)', color: '#fbbd24', label: 'Past Due' },
    canceled: { bg: 'rgba(239,68,68,0.12)', color: '#ef4444', label: 'Canceled' },
  };
  const c = cfg[status] || cfg.active;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 20,
      background: c.bg, color: c.color, textTransform: 'uppercase', letterSpacing: '0.08em',
    }}>{c.label}</span>
  );
}

function EventPill({ event }: { event: string }) {
  const color = event.includes('SUCCESS') || event.includes('UPDATED') ? '#00c2a8'
    : event.includes('BLOCK') || event.includes('FAILED') ? '#ef4444' : '#53d8fb';
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 4,
      background: `${color}18`, color, fontFamily: 'monospace', whiteSpace: 'nowrap',
    }}>{event}</span>
  );
}

export function Admin() {
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'orgs' | 'activity'>('orgs');

  const filtered = ORGS.filter(o => o.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{ minHeight: '100vh', background: 'var(--nhid-bg)', color: 'var(--nhid-text)' }}>
      {/* Top bar */}
      <div style={{
        height: 60, borderBottom: '1px solid var(--nhid-border)',
        display: 'flex', alignItems: 'center', padding: '0 28px', gap: 16,
        background: 'rgba(7,12,23,0.8)', backdropFilter: 'blur(12px)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 8,
            background: 'linear-gradient(135deg, #00c2a8, #53d8fb)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 900, color: '#070c17',
            boxShadow: '0 0 12px rgba(0,194,168,0.4)',
          }}>N</div>
          <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--nhid-text)' }}>NHID Clinical</span>
        </div>
        <div style={{ height: 20, width: 1, background: 'var(--nhid-border)' }} />
        <span style={{
          fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
          padding: '4px 10px', borderRadius: 6,
          background: 'rgba(83,216,251,0.1)', color: 'var(--nhid-cyan)',
          border: '1px solid rgba(83,216,251,0.2)',
        }}>Operations Console</span>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--nhid-muted)' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#00c2a8', display: 'inline-block', boxShadow: '0 0 6px #00c2a8' }} />
          admin
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 0, height: 'calc(100vh - 60px)' }}>
        {/* Main content */}
        <div style={{ padding: '24px 28px', overflow: 'auto', borderRight: '1px solid var(--nhid-border)' }}>
          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
            {[
              { label: 'Total Orgs', value: '6', color: '#00c2a8' },
              { label: 'Active', value: '4', color: '#00c2a8' },
              { label: 'Past Due', value: '1', color: '#fbbd24' },
              { label: 'Calls Today', value: '10.5K', color: '#53d8fb' },
            ].map((s, i) => (
              <div key={i} style={{
                background: 'var(--nhid-surface)', border: '1px solid var(--nhid-border)',
                borderRadius: 10, padding: '16px',
              }}>
                <div style={{ fontSize: 11, color: 'var(--nhid-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>{s.label}</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
            {(['orgs', 'activity'] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: tab === t ? 'rgba(0,194,168,0.12)' : 'transparent',
                color: tab === t ? 'var(--nhid-teal)' : 'var(--nhid-muted)',
                fontSize: 13, fontWeight: tab === t ? 700 : 500, fontFamily: 'Raleway, sans-serif',
                borderBottom: tab === t ? '2px solid var(--nhid-teal)' : '2px solid transparent',
              }}>{t === 'orgs' ? 'Organizations' : 'System Events'}</button>
            ))}
          </div>

          {tab === 'orgs' && (
            <>
              {/* Search */}
              <div style={{ marginBottom: 16 }}>
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search organizations..."
                  style={{
                    width: 300, padding: '9px 14px', borderRadius: 8,
                    background: 'rgba(255,255,255,0.04)', border: '1px solid var(--nhid-border)',
                    color: 'var(--nhid-text)', fontSize: 13, outline: 'none',
                    fontFamily: 'Raleway, sans-serif',
                  }}
                />
              </div>

              {/* Table */}
              <div style={{ background: 'var(--nhid-surface)', border: '1px solid var(--nhid-border)', borderRadius: 12, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--nhid-border)' }}>
                      {['Organization', 'Plan', 'Status', 'Calls Today', 'Created'].map(h => (
                        <th key={h} style={{
                          padding: '12px 16px', textAlign: 'left',
                          fontSize: 10, fontWeight: 700, color: 'var(--nhid-muted)',
                          textTransform: 'uppercase', letterSpacing: '0.1em',
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((org, i) => (
                      <tr key={i} style={{
                        borderBottom: i < filtered.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                        transition: 'background 0.15s',
                      }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <td style={{ padding: '12px 16px', fontSize: 13, fontWeight: 600 }}>{org.name}</td>
                        <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--nhid-cyan)' }}>{org.plan}</td>
                        <td style={{ padding: '12px 16px' }}><StatusPill status={org.status} /></td>
                        <td style={{ padding: '12px 16px', fontSize: 13, fontFamily: 'monospace', color: org.calls > 0 ? 'var(--nhid-text)' : 'var(--nhid-muted)' }}>
                          {org.calls.toLocaleString()}
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: 11, color: 'var(--nhid-muted)', fontFamily: 'monospace' }}>{org.created}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {tab === 'activity' && (
            <div style={{ background: 'var(--nhid-surface)', border: '1px solid var(--nhid-border)', borderRadius: 12, overflow: 'hidden' }}>
              {ACTIVITY.map((a, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 16, padding: '14px 20px',
                  borderBottom: i < ACTIVITY.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                }}>
                  <span style={{ fontSize: 11, color: 'var(--nhid-muted)', fontFamily: 'monospace', minWidth: 42 }}>{a.time}</span>
                  <EventPill event={a.event} />
                  <span style={{ fontSize: 12, color: 'var(--nhid-muted)', flex: 1 }}>{a.org !== '—' ? a.org : ''}</span>
                  <span style={{ fontSize: 11, color: 'var(--nhid-muted)', fontFamily: 'monospace' }}>{a.detail}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right rail */}
        <div style={{ padding: '24px 20px', overflow: 'auto' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--nhid-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16 }}>
            System Health
          </div>
          {[
            { svc: 'NHID Core', port: ':8000', st: 'up', color: '#00c2a8' },
            { svc: 'SaaS Gateway', port: ':8010', st: 'up', color: '#00c2a8' },
            { svc: 'Bridge API', port: ':8001', st: 'up', color: '#00c2a8' },
            { svc: 'Stripe', port: '', st: 'ok', color: '#00c2a8' },
          ].map((s, i) => (
            <div key={i} style={{
              background: 'var(--nhid-surface)', border: '1px solid var(--nhid-border)',
              borderRadius: 8, padding: '12px 14px', marginBottom: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{s.svc}</div>
                <div style={{ fontSize: 10, color: 'var(--nhid-muted)', fontFamily: 'monospace' }}>{s.port}</div>
              </div>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: s.color, fontWeight: 700 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.color, display: 'inline-block', boxShadow: `0 0 6px ${s.color}` }} />
                {s.st.toUpperCase()}
              </span>
            </div>
          ))}

          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--nhid-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '20px 0 14px' }}>
            Quick Actions
          </div>
          {[
            { label: '+ Create Organization', color: 'var(--nhid-teal)' },
            { label: 'Export Audit Report', color: 'var(--nhid-muted)' },
            { label: 'Sync Stripe Plans', color: 'var(--nhid-muted)' },
          ].map((btn, i) => (
            <button key={i} style={{
              display: 'block', width: '100%', padding: '10px 14px', borderRadius: 8,
              background: i === 0 ? 'rgba(0,194,168,0.1)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${i === 0 ? 'var(--nhid-border-bright)' : 'var(--nhid-border)'}`,
              color: btn.color, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              fontFamily: 'Raleway, sans-serif', textAlign: 'left', marginBottom: 8,
              transition: 'all 0.15s',
            }}>{btn.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
