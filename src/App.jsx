/* ═══════════════════════════════════════════
   App — Root component
   ═══════════════════════════════════════════ */

import { useState, useEffect, useCallback } from 'react'
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useNavigate,
  useLocation,
  useParams,
} from 'react-router-dom'
import Icon from './components/Icon.jsx'
import ModelOverview from './components/ModelOverview.jsx'
import ModelDetail from './components/ModelDetail.jsx'
import AlertsView from './components/AlertsView.jsx'
import SettingsView from './components/SettingsView.jsx'
import OnboardingWizard from './components/OnboardingWizard.jsx'
import { Toaster } from 'sonner'
import { api } from './api.js'
import { theme } from './utils/theme.js'

/* ── ModelDetailRoute: fetches model by URL param ── */
function ModelDetailRoute({ onRefresh }) {
  const { modelId } = useParams()
  const navigate = useNavigate()
  const [model, setModel] = useState(null)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    setModel(null)
    setNotFound(false)
    api.getModel(modelId)
      .then(setModel)
      .catch(() => setNotFound(true))
  }, [modelId])

  if (notFound) return <Navigate to="/" replace />
  if (!model) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300, color: theme.textDim, fontSize: 13 }}>
        Loading model…
      </div>
    )
  }

  return (
    <ModelDetail
      model={model}
      onBack={() => navigate('/')}
      onRefresh={async (id) => {
        const m = await api.getModel(id)
        setModel(m)
        onRefresh()
      }}
    />
  )
}

/* ── AppShell: layout + data fetching ── */
function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()

  const [showWizard, setShowWizard] = useState(false)
  const [now, setNow]               = useState(new Date())
  const [models, setModels]         = useState([])
  const [demoModels, setDemoModels] = useState([])
  const [overviewTab, setOverviewTab] = useState('models')
  const [alerts, setAlerts]         = useState([])
  const [loading, setLoading]       = useState(true)

  const fetchData = useCallback(() => {
    setLoading(true)
    Promise.all([
      api.listModels({ is_demo: false }).catch(() => ({ items: [] })),
      api.listModels({ is_demo: true }).catch(() => ({ items: [] })),
      api.listAlerts().catch(() => ({ items: [] })),
    ]).then(([modelsRes, demoRes, alertsRes]) => {
      setModels(modelsRes.items ?? [])
      setDemoModels(demoRes.items ?? [])
      setAlerts(alertsRes.items ?? [])
    }).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchData()
    const id = setInterval(() => {
      setNow(new Date())
      fetchData()
    }, 30_000)
    return () => clearInterval(id)
  }, [fetchData])

  const openAlerts = alerts.filter((a) => a.status === 'open').length
  const path = location.pathname

  const NAV = [
    { path: '/',         match: (p) => p === '/' || p.startsWith('/models'),  label: 'Models',   icon: 'grid' },
    { path: '/alerts',   match: (p) => p === '/alerts',                        label: 'Alerts',   icon: 'bell' },
    { path: '/settings', match: (p) => p.startsWith('/settings'),              label: 'Settings', icon: 'settings' },
  ]

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
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}
          onClick={() => navigate('/')}
        >
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
          {NAV.map((n) => {
            const active = n.match(path)
            return (
              <button
                key={n.path}
                onClick={() => navigate(n.path)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 14px', borderRadius: 8,
                  border: 'none', cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: 13, fontWeight: 500,
                  background: active ? theme.accent + '18' : 'transparent',
                  color: active ? theme.accent : theme.textMuted,
                  transition: 'all 0.15s',
                }}
              >
                <Icon name={n.icon} size={14} />
                {n.label}
                {n.label === 'Alerts' && openAlerts > 0 && (
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
            )
          })}
        </nav>

        <div style={{ flex: 1 }} />

        {/* Clock */}
        <span style={{ fontSize: 11, color: theme.textDim, fontFamily: 'var(--font-mono)' }}>
          {now.toISOString().slice(0, 16).replace('T', ' ')} UTC
        </span>
      </header>

      {/* ═══════════ Content ═══════════ */}
      <main style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 24px 60px' }}>
        <Routes>
          <Route
            path="/"
            element={
              <ModelOverview
                models={models}
                demoModels={demoModels}
                overviewTab={overviewTab}
                onTabChange={setOverviewTab}
                loading={loading}
                onSelect={(m) => navigate('/models/' + m.id)}
                onNewModel={() => setShowWizard(true)}
              />
            }
          />
          <Route path="/models/:modelId" element={<ModelDetailRoute onRefresh={fetchData} />} />
          <Route path="/models/:modelId/:tab" element={<ModelDetailRoute onRefresh={fetchData} />} />
          <Route
            path="/alerts"
            element={
              <AlertsView
                alerts={alerts}
                models={[...models, ...demoModels]}
                onSelectModel={(m) => navigate('/models/' + m.id)}
                onRefresh={fetchData}
              />
            }
          />
          <Route path="/settings" element={<Navigate to="/settings/connections" replace />} />
          <Route path="/settings/:tab" element={<SettingsView />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {/* ═══════════ Wizard overlay ═══════════ */}
      {showWizard && (
        <OnboardingWizard
          onClose={(opts) => {
            setShowWizard(false)
            if (opts?.refresh) fetchData()
          }}
        />
      )}
      <Toaster position="bottom-right" theme="dark" richColors />
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  )
}
