/* ═══════════════════════════════════════════
   App — Root component
   ═══════════════════════════════════════════ */

import { useState, useEffect, useCallback, useRef } from 'react'
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
import TeamHealthView from './components/TeamHealthView.jsx'
import LoginView from './components/LoginView.jsx'
import { Toaster } from 'sonner'
import { api } from './api.js'
import { theme } from './utils/theme.js'
import { supabase } from './supabase.js'

const CURRENT_USER_KEY = 'ml_monitor_current_user'

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

/* ── Identity picker (header dropdown) ── */
function IdentityPicker({ currentUser, users, onSelect }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const activeUsers = users.filter(u => u.is_active)

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 12px', borderRadius: 8,
          border: `1px solid ${currentUser ? theme.accent + '40' : theme.border}`,
          background: currentUser ? theme.accent + '12' : theme.bgCard,
          color: currentUser ? theme.accent : theme.textMuted,
          cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 500,
          transition: 'all 0.15s',
        }}
      >
        <Icon name="user" size={12} />
        {currentUser ? currentUser.display_name : 'Set identity'}
        <Icon name="chevron-down" size={11} style={{ opacity: 0.6 }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '100%', marginTop: 6,
          background: theme.bgCard, border: `1px solid ${theme.border}`,
          borderRadius: 10, minWidth: 220, zIndex: 200,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          padding: '6px 0',
        }}>
          <div style={{ padding: '4px 12px 8px', fontSize: 10, color: theme.textDim, textTransform: 'uppercase', letterSpacing: 0.7, fontWeight: 600 }}>
            You are…
          </div>
          {activeUsers.length === 0 && (
            <div style={{ padding: '8px 12px', fontSize: 12, color: theme.textDim }}>
              No users — create one in Settings
            </div>
          )}
          {activeUsers.map(u => (
            <button
              key={u.id}
              onClick={() => { onSelect(u); setOpen(false) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                width: '100%', padding: '8px 12px', border: 'none', borderRadius: 0,
                background: currentUser?.id === u.id ? theme.accent + '15' : 'transparent',
                color: currentUser?.id === u.id ? theme.accent : theme.text,
                cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, textAlign: 'left',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => { if (currentUser?.id !== u.id) e.currentTarget.style.background = theme.bgCardHover }}
              onMouseLeave={e => { if (currentUser?.id !== u.id) e.currentTarget.style.background = 'transparent' }}
            >
              <div style={{
                width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                background: theme.accent + '25', color: theme.accent,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 700,
              }}>
                {u.display_name[0].toUpperCase()}
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 12 }}>{u.display_name}</div>
                <div style={{ fontSize: 10, color: theme.textDim }}>{u.email}</div>
              </div>
              {currentUser?.id === u.id && <Icon name="check" size={12} style={{ marginLeft: 'auto', color: theme.accent }} />}
            </button>
          ))}
          {currentUser && (
            <>
              <div style={{ borderTop: `1px solid ${theme.border}`, margin: '6px 0' }} />
              <button
                onClick={() => { onSelect(null); setOpen(false) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  width: '100%', padding: '7px 12px', border: 'none',
                  background: 'transparent', color: theme.textDim,
                  cursor: 'pointer', fontFamily: 'inherit', fontSize: 12,
                }}
              >
                <Icon name="log-out" size={12} />
                Clear identity
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/* ── AppShell: layout + data fetching ── */
function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()

  const [session, setSession]           = useState(null)
  const [authLoading, setAuthLoading]   = useState(true)
  const [showWizard, setShowWizard]     = useState(false)
  const [now, setNow]                   = useState(new Date())
  const [models, setModels]             = useState([])
  const [demoModels, setDemoModels]     = useState([])
  const [overviewTab, setOverviewTab]   = useState('models')
  const [alerts, setAlerts]             = useState([])
  const [teams, setTeams]               = useState([])
  const [users, setUsers]               = useState([])
  const [loading, setLoading]           = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  const fetchData = useCallback(() => {
    setLoading(true)
    Promise.all([
      api.listModels({ is_demo: false }).catch(() => ({ items: [] })),
      api.listModels({ is_demo: true }).catch(() => ({ items: [] })),
      api.listAlerts().catch(() => ({ items: [] })),
      api.listTeams().catch(() => []),
      api.listUsers().catch(() => ({ items: [] })),
    ]).then(([modelsRes, demoRes, alertsRes, teamsRes, usersRes]) => {
      setModels(modelsRes.items ?? [])
      setDemoModels(demoRes.items ?? [])
      setAlerts(alertsRes.items ?? [])
      setTeams(teamsRes ?? [])
      setUsers(usersRes.items ?? usersRes ?? [])
    }).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!session) return
    fetchData()
    const id = setInterval(() => {
      setNow(new Date())
      fetchData()
    }, 30_000)
    return () => clearInterval(id)
  }, [fetchData, session])

  if (authLoading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0f1117', color: '#64748b', fontSize: 13 }}>
      Loading…
    </div>
  )
  if (!session) return <LoginView />

  const openAlerts = alerts.filter((a) => a.status === 'open').length
  const path = location.pathname

  const NAV = [
    { path: '/',         match: (p) => p === '/' || p.startsWith('/models'),  label: 'Models',   icon: 'grid' },
    { path: '/alerts',   match: (p) => p === '/alerts',                        label: 'Alerts',   icon: 'bell' },
    { path: '/teams',    match: (p) => p.startsWith('/teams'),                 label: 'Teams',    icon: 'users' },
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
        <span style={{ fontSize: 11, color: theme.textDim, fontFamily: 'var(--font-mono)', marginRight: 8 }}>
          {now.toISOString().slice(0, 16).replace('T', ' ')} UTC
        </span>

        {/* Logged-in user + sign out */}
        <span style={{ fontSize: 12, color: theme.textDim }}>{session.user.email}</span>
        <button
          onClick={() => supabase.auth.signOut()}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 12px', borderRadius: 8,
            border: `1px solid ${theme.border}`, background: theme.bgCard,
            color: theme.textMuted, cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 12, fontWeight: 500,
          }}
        >
          <Icon name="log-out" size={12} />
          Sign out
        </button>
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
                teams={teams}
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
                teams={teams}
                currentUser={null}
                onSelectModel={(m) => navigate('/models/' + m.id)}
                onRefresh={fetchData}
              />
            }
          />
          <Route
            path="/teams"
            element={
              <TeamHealthView
                models={models}
                alerts={alerts}
                teams={teams}
                loading={loading}
                onSelectModel={(m) => navigate('/models/' + m.id)}
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
          teams={teams}
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
