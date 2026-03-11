/* ═══════════════════════════════════════════
   App — Root component
   ═══════════════════════════════════════════ */

import { useState, useEffect } from 'react'
import Icon from './components/Icon.jsx'
import ModelOverview from './components/ModelOverview.jsx'
import ModelDetail from './components/ModelDetail.jsx'
import AlertsView from './components/AlertsView.jsx'
import OnboardingWizard from './components/OnboardingWizard.jsx'
import { MODELS, ALL_ALERTS } from './data/generators.js'
import { theme } from './utils/theme.js'

export default function App() {
  const [view, setView]             = useState('overview')
  const [selectedModel, setModel]   = useState(null)
  const [showWizard, setShowWizard] = useState(false)
  const [now, setNow]               = useState(new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  const openAlerts = ALL_ALERTS.filter((a) => a.status === 'open').length

  return (
    <div style={{ minHeight: '100vh', background: theme.bg, color: theme.text, fontFamily: "var(--font-body, 'DM Sans', system-ui, sans-serif)" }}>
      <link
        href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
        rel="stylesheet"
      />

      {/* ═══════════ Top bar ═══════════ */}
      <header
        style={{
          background: theme.bgSurface,
          borderBottom: `1px solid ${theme.border}`,
          padding: '0 24px', height: 56,
          display: 'flex', alignItems: 'center', gap: 20,
          position: 'sticky', top: 0, zIndex: 100,
          backdropFilter: 'blur(12px)',
        }}
      >
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 32, height: 32, borderRadius: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: `linear-gradient(135deg, ${theme.accent}, ${theme.purple})`,
              fontWeight: 800, fontSize: 14, color: '#000',
            }}
          >
            M
          </div>
          <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: -0.3 }}>MLMonitor</span>
          <span
            style={{
              fontSize: 10, color: theme.textDim,
              background: theme.bgInput, padding: '2px 8px',
              borderRadius: 10, fontWeight: 600,
            }}
          >
            v1.0
          </span>
        </div>

        {/* Nav */}
        <nav style={{ display: 'flex', gap: 2, marginLeft: 20 }}>
          {[
            { key: 'overview', label: 'Models', icon: 'grid' },
            { key: 'alerts',   label: 'Alerts', icon: 'bell' },
          ].map((n) => (
            <button
              key={n.key}
              onClick={() => { setView(n.key); setModel(null) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', borderRadius: 8,
                border: 'none', cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 13, fontWeight: 500,
                background: (view === n.key || (n.key === 'overview' && view === 'detail'))
                  ? theme.accent + '18'
                  : 'transparent',
                color: (view === n.key || (n.key === 'overview' && view === 'detail'))
                  ? theme.accent
                  : theme.textMuted,
                transition: 'all 0.15s',
              }}
            >
              <Icon name={n.icon} size={14} />
              {n.label}
              {n.key === 'alerts' && openAlerts > 0 && (
                <span
                  style={{
                    background: theme.red, color: '#fff',
                    fontSize: 10, fontWeight: 700,
                    padding: '1px 6px', borderRadius: 10,
                    minWidth: 18, textAlign: 'center',
                  }}
                >
                  {openAlerts}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div style={{ flex: 1 }} />

        {/* Clock */}
        <span style={{ fontSize: 11, color: theme.textDim, fontFamily: 'var(--font-mono)' }}>
          {now.toISOString().slice(0, 16).replace('T', ' ')} UTC
        </span>
      </header>

      {/* ═══════════ Content ═══════════ */}
      <main style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 24px 60px' }}>
        {view === 'overview' && (
          <ModelOverview
            models={MODELS}
            onSelect={(m) => { setModel(m); setView('detail') }}
            onNewModel={() => setShowWizard(true)}
          />
        )}

        {view === 'detail' && selectedModel && (
          <ModelDetail
            model={selectedModel}
            onBack={() => { setModel(null); setView('overview') }}
          />
        )}

        {view === 'alerts' && (
          <AlertsView alerts={ALL_ALERTS} models={MODELS} />
        )}
      </main>

      {/* ═══════════ Wizard overlay ═══════════ */}
      {showWizard && <OnboardingWizard onClose={() => setShowWizard(false)} />}
    </div>
  )
}
