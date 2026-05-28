import './_group.css';
import { useState } from 'react';

const NAV = [
  { icon: '⬡', label: 'Dashboard', active: true },
  { icon: '◈', label: 'Trace Events', active: false },
  { icon: '◉', label: 'Proof & Audit', active: false },
  { icon: '◎', label: 'Usage', active: false },
];

const STATS = [
  { label: 'API Calls Today', value: '1,284', delta: '+12%', icon: '◈', color: '#00c2a8' },
  { label: 'Monthly Total', value: '38,901', delta: '+8%', icon: '◉', color: '#53d8fb' },
  { label: 'Chain Valid', value: '100%', delta: 'All sessions', icon: '✓', color: '#00c2a8' },
  { label: 'Active Sessions', value: '47', delta: 'Live now', icon: '●', color: '#53d8fb' },
];

const ACTIVITY = [
  { time: '14:23', org: 'MemorialHealth', event: 'trace.append', session: 'sess_8a2f', status: 'ok' },
  { time: '14:22', org: 'BayCare Systems', event: 'proof.export', session: 'sess_3d9c', status: 'ok' },
  { time: '14:21', org: 'Northside AI', event: 'auth.verify', session: 'sess_1e7b', status: 'ok' },
  { time: '14:19', org: 'CedarMed', event: 'trace.append', session: 'sess_5f2a', status: 'warn' },
  { time: '14:17', org: 'MemorialHealth', event: 'proof.export', session: 'sess_9c1d', status: 'ok' },
];

export function Dashboard() {
  const [active, setActive] = useState(0);

  return (
    <div style={{
      display: 'flex', height: '100vh', background: 'var(--nhid-bg)',
      color: 'var(--nhid-text)', overflow: 'hidden'
    }}>
      {/* Sidebar */}
      <div style={{
        width: 'var(--nhid-sidebar-w)', flexShrink: 0,
        background: 'linear-gradient(180deg, rgba(0,194,168,0.06) 0%, rgba(7,12,23,0) 40%)',
        borderRight: '1px solid var(--nhid-border)',
        display: 'flex', flexDirection: 'column', padding: '0',
        backdropFilter: 'blur(12px)',
      }}>
        {/* Logo */}
        <div style={{ padding: '28px 24px 20px', borderBottom: '1px solid var(--nhid-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 34, height: 34, borderRadius: 8,
              background: 'linear-gradient(135deg, #00c2a8, #53d8fb)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, fontWeight: 800, color: '#070c17',
              boxShadow: '0 0 16px rgba(0,194,168,0.4)',
            }}>N</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: '0.05em', color: '#e8f0f7' }}>NHID</div>
              <div style={{ fontSize: 10, fontWeight: 500, color: 'var(--nhid-muted)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Clinical</div>
            </div>
          </div>
        </div>

        {/* Org card */}
        <div style={{ padding: '16px 16px 8px' }}>
          <div style={{
            background: 'var(--nhid-surface)', border: '1px solid var(--nhid-border)',
            borderRadius: 10, padding: '12px 14px',
          }}>
            <div style={{ fontSize: 12, color: 'var(--nhid-muted)', marginBottom: 4 }}>Organization</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--nhid-text)' }}>MemorialHealth AI</div>
            <div style={{ marginTop: 8 }}>
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
                textTransform: 'uppercase', padding: '3px 8px', borderRadius: 20,
                background: 'rgba(0,194,168,0.15)', border: '1px solid var(--nhid-border-bright)',
                color: 'var(--nhid-teal)',
              }}>L2 PRO</span>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '8px 12px' }}>
          {NAV.map((item, i) => (
            <div key={i} onClick={() => setActive(i)} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 12px', borderRadius: 8, marginBottom: 2,
              cursor: 'pointer', transition: 'all 0.15s',
              background: active === i ? 'rgba(0,194,168,0.12)' : 'transparent',
              border: active === i ? '1px solid rgba(0,194,168,0.25)' : '1px solid transparent',
              color: active === i ? 'var(--nhid-teal)' : 'var(--nhid-muted)',
            }}>
              <span style={{ fontSize: 14 }}>{item.icon}</span>
              <span style={{ fontSize: 13, fontWeight: active === i ? 700 : 500 }}>{item.label}</span>
              {active === i && <div style={{ marginLeft: 'auto', width: 5, height: 5, borderRadius: '50%', background: 'var(--nhid-teal)', boxShadow: '0 0 6px var(--nhid-teal)' }} />}
            </div>
          ))}
        </nav>

        {/* System status */}
        <div style={{ padding: '16px', borderTop: '1px solid var(--nhid-border)' }}>
          <div style={{ fontSize: 10, color: 'var(--nhid-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>System Status</div>
          {[['NHID Core', 'up'], ['SaaS Layer', 'up'], ['Stripe', 'ok']].map(([svc, st]) => (
            <div key={svc} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--nhid-muted)' }}>{svc}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#00c2a8', fontWeight: 700 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#00c2a8', display: 'inline-block', boxShadow: '0 0 6px #00c2a8' }} />
                {st.toUpperCase()}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Topbar */}
        <div style={{
          height: 60, borderBottom: '1px solid var(--nhid-border)',
          display: 'flex', alignItems: 'center', padding: '0 28px',
          gap: 16, flexShrink: 0,
          background: 'rgba(7,12,23,0.6)', backdropFilter: 'blur(12px)',
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.01em' }}>Control Plane</div>
            <div style={{ fontSize: 11, color: 'var(--nhid-muted)' }}>NHID Audit Infrastructure</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--nhid-muted)' }}>Wed, 28 May 2026</span>
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              background: 'linear-gradient(135deg, #00c2a8, #53d8fb)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 800, color: '#070c17',
            }}>M</div>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: 'auto', padding: '28px' }}>
          {/* Stats grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
            {STATS.map((s, i) => (
              <div key={i} style={{
                background: 'var(--nhid-surface)', border: '1px solid var(--nhid-border)',
                borderRadius: 'var(--nhid-radius)', padding: '20px',
                backdropFilter: 'blur(8px)',
                boxShadow: `0 0 30px ${s.color}08`,
                transition: 'all 0.2s',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span style={{ fontSize: 12, color: 'var(--nhid-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{s.label}</span>
                  <span style={{ fontSize: 16, color: s.color }}>{s.icon}</span>
                </div>
                <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--nhid-text)', marginBottom: 6 }}>{s.value}</div>
                <div style={{ fontSize: 11, color: s.color, fontWeight: 600 }}>{s.delta}</div>
              </div>
            ))}
          </div>

          {/* Two column */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16 }}>
            {/* Activity */}
            <div style={{
              background: 'var(--nhid-surface)', border: '1px solid var(--nhid-border)',
              borderRadius: 'var(--nhid-radius)', padding: '20px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>Live Activity</div>
                <span style={{ fontSize: 11, color: 'var(--nhid-teal)', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--nhid-teal)', display: 'inline-block', boxShadow: '0 0 6px var(--nhid-teal)' }} />
                  Live
                </span>
              </div>
              {ACTIVITY.map((a, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 14, padding: '10px 0',
                  borderBottom: i < ACTIVITY.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                }}>
                  <span style={{ fontSize: 11, color: 'var(--nhid-muted)', minWidth: 40, fontFamily: 'monospace' }}>{a.time}</span>
                  <span style={{
                    fontSize: 10, padding: '3px 8px', borderRadius: 20, fontWeight: 700,
                    background: a.status === 'ok' ? 'rgba(0,194,168,0.12)' : 'rgba(251,191,36,0.12)',
                    color: a.status === 'ok' ? 'var(--nhid-teal)' : '#fbbd24',
                    border: `1px solid ${a.status === 'ok' ? 'rgba(0,194,168,0.25)' : 'rgba(251,191,36,0.25)'}`,
                  }}>{a.event}</span>
                  <span style={{ fontSize: 12, color: 'var(--nhid-text)', flex: 1 }}>{a.org}</span>
                  <span style={{ fontSize: 10, color: 'var(--nhid-muted)', fontFamily: 'monospace' }}>{a.session}</span>
                </div>
              ))}
            </div>

            {/* Quota + Plan */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{
                background: 'var(--nhid-surface)', border: '1px solid var(--nhid-border)',
                borderRadius: 'var(--nhid-radius)', padding: '20px',
              }}>
                <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Daily Quota</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--nhid-muted)' }}>1,284 / 5,000 calls</span>
                  <span style={{ fontSize: 12, color: 'var(--nhid-teal)', fontWeight: 700 }}>25.7%</span>
                </div>
                <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', width: '25.7%', borderRadius: 3,
                    background: 'linear-gradient(90deg, var(--nhid-teal), var(--nhid-cyan))',
                    boxShadow: '0 0 12px rgba(0,194,168,0.5)',
                  }} />
                </div>
                <div style={{ marginTop: 12, fontSize: 11, color: 'var(--nhid-muted)' }}>Resets in 9h 37m</div>
              </div>

              <div style={{
                background: 'linear-gradient(135deg, rgba(0,194,168,0.1), rgba(83,216,251,0.06))',
                border: '1px solid var(--nhid-border-bright)',
                borderRadius: 'var(--nhid-radius)', padding: '20px',
                boxShadow: '0 0 40px rgba(0,194,168,0.08)',
              }}>
                <div style={{ fontSize: 11, color: 'var(--nhid-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>Current Plan</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--nhid-teal)', marginBottom: 4 }}>L2 Professional</div>
                <div style={{ fontSize: 12, color: 'var(--nhid-muted)', marginBottom: 16 }}>5,000 calls/day · Chain audit · Priority support</div>
                <button style={{
                  width: '100%', padding: '10px', borderRadius: 8, border: '1px solid var(--nhid-border-bright)',
                  background: 'rgba(0,194,168,0.12)', color: 'var(--nhid-teal)', fontWeight: 700,
                  fontSize: 12, cursor: 'pointer', fontFamily: 'Raleway, sans-serif',
                }}>Manage Subscription →</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
