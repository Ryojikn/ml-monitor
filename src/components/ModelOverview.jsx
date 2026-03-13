/* ═══════════════════════════════════════════
   Model Overview — list & filters
   ═══════════════════════════════════════════ */

import { useState, useMemo } from 'react'
import Icon from './Icon.jsx'
import { MetricCard, SearchInput, Select, Badge, Sparkline, StatusDot, Button } from './ui.jsx'
import { theme, driftColor, statusColor } from '../utils/theme.js'
import { MODEL_TYPES, STATUSES, TEAMS } from '../utils/constants.js'

export default function ModelOverview({ models, demoModels = [], overviewTab = 'models', onTabChange, onSelect, onNewModel, loading }) {
  const [search, setSearch]           = useState('')
  const [typeFilter, setTypeFilter]   = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [teamFilter, setTeamFilter]   = useState('all')

  const isDemo = overviewTab === 'demo'
  const activeList = isDemo ? demoModels : models

  const filtered = useMemo(
    () =>
      activeList.filter((m) => {
        if (search && !m.name.toLowerCase().includes(search.toLowerCase()) && !m.team.toLowerCase().includes(search.toLowerCase())) return false
        if (typeFilter   !== 'all' && m.type   !== typeFilter) return false
        if (statusFilter !== 'all' && m.status !== statusFilter) return false
        if (teamFilter   !== 'all' && m.team   !== teamFilter) return false
        return true
      }),
    [activeList, isDemo, search, typeFilter, statusFilter, teamFilter],
  )

  const counts = useMemo(
    () => ({
      total:    activeList.length,
      healthy:  activeList.filter((m) => m.status === 'healthy').length,
      warning:  activeList.filter((m) => m.status === 'warning').length,
      critical: activeList.filter((m) => m.status === 'critical').length,
    }),
    [activeList],
  )

  return (
    <div>
      {/* ── Tab switcher ── */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
        {[
          { key: 'models', label: 'Models',      icon: 'grid',  count: models.length },
          { key: 'demo',   label: 'Demo Gallery', icon: 'play',  count: demoModels.length },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => onTabChange?.(t.key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 16px', borderRadius: 8,
              border: overviewTab === t.key ? `1px solid ${theme.accent}40` : `1px solid ${theme.border}`,
              cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 500,
              background: overviewTab === t.key ? theme.accent + '14' : theme.bgCard,
              color: overviewTab === t.key ? theme.accent : theme.textMuted,
              transition: 'all 0.15s',
            }}
          >
            <Icon name={t.icon} size={13} />
            {t.label}
            <span style={{
              fontSize: 11, fontWeight: 700,
              background: overviewTab === t.key ? theme.accent + '25' : theme.bgInput,
              color: overviewTab === t.key ? theme.accent : theme.textDim,
              padding: '1px 7px', borderRadius: 10,
            }}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* ── Demo banner ── */}
      {isDemo && (
        <div style={{
          padding: '10px 16px', marginBottom: 16, borderRadius: 10,
          background: theme.purple + '12', border: `1px solid ${theme.purple}30`,
          fontSize: 12, color: theme.textMuted, display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <Icon name="info" size={13} style={{ color: theme.purple, flexShrink: 0 }} />
          These are pre-loaded demo models with synthetic monitoring data. Explore them to see how drift detection, performance tracking, and data quality monitoring work in practice.
        </div>
      )}

      {/* ── Summary cards ── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <MetricCard label={isDemo ? 'Demo Models' : 'Total Models'} value={counts.total}    icon="box"            color={theme.accent} />
        <MetricCard label="Healthy"      value={counts.healthy}  icon="check-circle"   color={theme.green} />
        <MetricCard label="Warning"      value={counts.warning}  icon="alert-triangle" color={theme.yellow} />
        <MetricCard label="Critical"     value={counts.critical} icon="zap"            color={theme.red} />
      </div>

      {/* ── Filters ── */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <SearchInput value={search} onChange={setSearch} placeholder="Search models or teams…" />
        </div>
        <Select value={typeFilter}   onChange={setTypeFilter}   options={[{ value: 'all', label: 'All Types' },   ...MODEL_TYPES.map((t) => ({ value: t, label: t }))]} />
        <Select value={statusFilter} onChange={setStatusFilter} options={[{ value: 'all', label: 'All Status' },  ...STATUSES.map((s) => ({ value: s, label: s }))]} />
        <Select value={teamFilter}   onChange={setTeamFilter}   options={[{ value: 'all', label: 'All Teams' },   ...TEAMS.map((t) => ({ value: t, label: t }))]} />
        <Button variant="primary" icon="plus" onClick={onNewModel}>New Model</Button>
      </div>

      {/* ── Table ── */}
      <div style={{ background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12, overflow: 'hidden' }}>
        {/* header */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isDemo ? '2fr 1fr 1fr 80px 100px 90px 60px' : '2fr 1fr 1fr 1fr 100px 90px 60px',
            padding: '10px 18px',
            borderBottom: `1px solid ${theme.border}`,
            fontSize: 11, fontWeight: 600, color: theme.textDim,
            textTransform: 'uppercase', letterSpacing: 0.8,
          }}
        >
          <span>Model</span><span>Team</span><span>Type</span>
          {isDemo ? <span>Demo</span> : <span>Last Run</span>}
          <span>PSI Trend</span><span>Status</span><span />
        </div>

        {/* rows */}
        {filtered.map((m) => (
          <div
            key={m.id}
            onClick={() => onSelect(m)}
            style={{
              display: 'grid',
              gridTemplateColumns: isDemo ? '2fr 1fr 1fr 80px 100px 90px 60px' : '2fr 1fr 1fr 1fr 100px 90px 60px',
              padding: '12px 18px',
              borderBottom: `1px solid ${theme.border}08`,
              alignItems: 'center',
              cursor: 'pointer',
              transition: 'background 0.15s',
              fontSize: 13,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = theme.bgCardHover }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          >
            <div>
              <div style={{ fontWeight: 600, color: theme.text }}>{m.name}</div>
              <div style={{ fontSize: 11, color: theme.textDim }}>{m.owner} · {m.engine}</div>
            </div>
            <div style={{ color: theme.textMuted }}>{m.team}</div>
            <div><Badge color={theme.purple}>{m.type}</Badge></div>
            {isDemo
              ? <div><Badge color={theme.purple} style={{ opacity: 0.8, fontSize: 10 }}>DEMO</Badge></div>
              : <div style={{ fontSize: 12, color: theme.textDim }}>{m.last_run_at?.slice(0, 10) || '—'}</div>
            }
            <div><Sparkline data={m.psiTimeline.slice(-10)} color={driftColor(m.globalPsi)} /></div>
            <div>
              <StatusDot status={m.status} />
              <span style={{ color: statusColor(m.status), fontWeight: 600, fontSize: 12 }}>{m.status}</span>
            </div>
            <div><Icon name="chevron-right" size={14} style={{ color: theme.textDim }} /></div>
          </div>
        ))}

        {filtered.length === 0 && !loading && (
          <div style={{ padding: 40, textAlign: 'center', color: theme.textDim }}>
            {isDemo ? 'Demo models loading…' : 'No models match your filters'}
          </div>
        )}
      </div>

    </div>
  )
}
