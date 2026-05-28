import './_group.css';
import { useState } from 'react';

const PLANS = [
  { id: 'free', name: 'Free', calls: '100 calls/day', price: '$0', desc: 'Explore NHID audit core' },
  { id: 'l1', name: 'L1 Starter', calls: '1,000 calls/day', price: '$49/mo', desc: 'For small clinical teams' },
  { id: 'l2', name: 'L2 Pro', calls: '5,000 calls/day', price: '$149/mo', desc: 'For growing health systems' },
];

type Step = 'welcome' | 'setup' | 'reveal';

export function Onboarding() {
  const [step, setStep] = useState<Step>('welcome');
  const [org, setOrg] = useState('');
  const [plan, setPlan] = useState('l1');
  const [copied, setCopied] = useState(false);
  const apiKey = 'nhid_a7f3c9e2b01d58f6a4c2e9071d3b5f82c6a8e1d4';

  const handleCopy = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--nhid-bg)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Background glow effects */}
      <div style={{
        position: 'absolute', top: -200, left: '50%', transform: 'translateX(-50%)',
        width: 600, height: 600, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(0,194,168,0.12) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: -150, right: '20%',
        width: 400, height: 400, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(83,216,251,0.08) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* Subtle grid */}
      <div style={{
        position: 'absolute', inset: 0, opacity: 0.03,
        backgroundImage: 'linear-gradient(rgba(0,194,168,1) 1px, transparent 1px), linear-gradient(90deg, rgba(0,194,168,1) 1px, transparent 1px)',
        backgroundSize: '40px 40px',
        pointerEvents: 'none',
      }} />

      {/* Card */}
      <div style={{
        width: '100%', maxWidth: 520, margin: '0 20px', position: 'relative', zIndex: 1,
      }}>
        {/* Logo header */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 64, height: 64, borderRadius: 18,
            background: 'linear-gradient(135deg, #00c2a8, #53d8fb)',
            boxShadow: '0 0 40px rgba(0,194,168,0.5), 0 0 80px rgba(0,194,168,0.2)',
            fontSize: 28, fontWeight: 900, color: '#070c17',
            marginBottom: 16,
          }}>N</div>
          <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--nhid-text)', marginBottom: 6 }}>NHID Clinical</div>
          <div style={{ fontSize: 13, color: 'var(--nhid-muted)' }}>Enterprise AI Audit Infrastructure</div>
        </div>

        {/* Step: Welcome */}
        {step === 'welcome' && (
          <div style={{
            background: 'rgba(255,255,255,0.03)', border: '1px solid var(--nhid-border)',
            borderRadius: 16, padding: '36px',
            backdropFilter: 'blur(20px)',
            boxShadow: '0 20px 80px rgba(0,0,0,0.4), 0 0 0 1px rgba(0,194,168,0.05) inset',
          }}>
            <div style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>Initialize Workspace</div>
            <div style={{ fontSize: 13, color: 'var(--nhid-muted)', marginBottom: 28, lineHeight: 1.6 }}>
              Set up your organization on the NHID audit platform. Your API key will be generated automatically.
            </div>

            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--nhid-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
              Organization Name
            </label>
            <input
              value={org}
              onChange={e => setOrg(e.target.value)}
              placeholder="e.g. MemorialHealth AI"
              style={{
                width: '100%', padding: '12px 14px', borderRadius: 10,
                background: 'rgba(255,255,255,0.05)', border: '1px solid var(--nhid-border)',
                color: 'var(--nhid-text)', fontSize: 14, outline: 'none',
                fontFamily: 'Raleway, sans-serif', marginBottom: 20,
                transition: 'border-color 0.2s',
              }}
            />

            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--nhid-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>
              Select Plan
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
              {PLANS.map(p => (
                <div key={p.id} onClick={() => setPlan(p.id)} style={{
                  padding: '14px 16px', borderRadius: 10, cursor: 'pointer',
                  border: `1px solid ${plan === p.id ? 'var(--nhid-border-bright)' : 'var(--nhid-border)'}`,
                  background: plan === p.id ? 'rgba(0,194,168,0.08)' : 'rgba(255,255,255,0.02)',
                  display: 'flex', alignItems: 'center', gap: 14,
                  transition: 'all 0.15s',
                }}>
                  <div style={{
                    width: 18, height: 18, borderRadius: '50%',
                    border: `2px solid ${plan === p.id ? 'var(--nhid-teal)' : 'var(--nhid-muted)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    {plan === p.id && <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--nhid-teal)' }} />}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: plan === p.id ? 'var(--nhid-text)' : 'var(--nhid-muted)' }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--nhid-muted)' }}>{p.desc} · {p.calls}</div>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: plan === p.id ? 'var(--nhid-teal)' : 'var(--nhid-muted)' }}>{p.price}</div>
                </div>
              ))}
            </div>

            <button
              onClick={() => org.trim() && setStep('reveal')}
              style={{
                width: '100%', padding: '14px', borderRadius: 10,
                background: org.trim() ? 'linear-gradient(135deg, #00c2a8, #53d8fb)' : 'rgba(255,255,255,0.06)',
                border: 'none', color: org.trim() ? '#070c17' : 'var(--nhid-muted)',
                fontSize: 14, fontWeight: 800, cursor: org.trim() ? 'pointer' : 'not-allowed',
                fontFamily: 'Raleway, sans-serif', letterSpacing: '0.02em',
                boxShadow: org.trim() ? '0 0 30px rgba(0,194,168,0.35)' : 'none',
                transition: 'all 0.2s',
              }}
            >
              {org.trim() ? 'Create Workspace →' : 'Enter organization name'}
            </button>
          </div>
        )}

        {/* Step: API Key Reveal */}
        {step === 'reveal' && (
          <div style={{
            background: 'rgba(255,255,255,0.03)', border: '1px solid var(--nhid-border-bright)',
            borderRadius: 16, padding: '36px',
            backdropFilter: 'blur(20px)',
            boxShadow: '0 20px 80px rgba(0,0,0,0.4), 0 0 60px rgba(0,194,168,0.06)',
          }}>
            <div style={{ textAlign: 'center', marginBottom: 28 }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>✓</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--nhid-teal)', marginBottom: 6 }}>Workspace Created</div>
              <div style={{ fontSize: 13, color: 'var(--nhid-muted)' }}>
                <strong style={{ color: 'var(--nhid-text)' }}>{org}</strong> is now live on NHID Clinical
              </div>
            </div>

            <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--nhid-border)', borderRadius: 10, padding: '16px', marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--nhid-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 10 }}>Your API Key</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <code style={{ flex: 1, fontSize: 11, color: 'var(--nhid-cyan)', fontFamily: 'monospace', wordBreak: 'break-all', lineHeight: 1.5 }}>
                  {apiKey}
                </code>
                <button onClick={handleCopy} style={{
                  padding: '6px 12px', borderRadius: 6, flexShrink: 0,
                  background: copied ? 'rgba(0,194,168,0.2)' : 'rgba(255,255,255,0.06)',
                  border: '1px solid var(--nhid-border)',
                  color: copied ? 'var(--nhid-teal)' : 'var(--nhid-muted)',
                  fontSize: 11, cursor: 'pointer', fontFamily: 'Raleway, sans-serif',
                  transition: 'all 0.15s',
                }}>
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>

            <div style={{
              fontSize: 11, color: 'var(--nhid-muted)', padding: '10px 12px',
              background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)',
              borderRadius: 8, marginBottom: 24, lineHeight: 1.6,
            }}>
              ⚠ Save your API key now — it will not be shown again.
            </div>

            <button
              onClick={() => setStep('welcome')}
              style={{
                width: '100%', padding: '14px', borderRadius: 10,
                background: 'linear-gradient(135deg, #00c2a8, #53d8fb)',
                border: 'none', color: '#070c17', fontSize: 14, fontWeight: 800,
                cursor: 'pointer', fontFamily: 'Raleway, sans-serif',
                boxShadow: '0 0 30px rgba(0,194,168,0.35)',
              }}
            >
              Go to Dashboard →
            </button>
          </div>
        )}

        <div style={{ textAlign: 'center', marginTop: 20, fontSize: 11, color: 'var(--nhid-muted)' }}>
          NHID Clinical · HIPAA-aligned audit infrastructure · v2.0
        </div>
      </div>
    </div>
  );
}
