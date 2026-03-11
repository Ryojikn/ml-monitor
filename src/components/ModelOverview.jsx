/* ═══════════════════════════════════════════
   Model Overview — list & filters
   ═══════════════════════════════════════════ */

import { useState, useMemo } from 'react'
import Icon from './Icon.jsx'
import { MetricCard, SearchInput, Select, Badge, Sparkline, StatusDot, Button } from './ui.jsx'
import { theme, driftColor, statusColor } from '../utils/theme.js'
import { MODEL_TYPES, STATUSES, TEAMS } from '../utils/constants.js'

export default function ModelOverview({ models, onSelect, onNewModel }) {
  const [search, setSearch]           = useState('')
  const [typeFilter, setTypeFilter]   = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [teamFilter, setTeamFilter]   = useState('all')

  const filtered = useMemo(
    () =>
      models.filter((m) => {
        if (search && !m.name.toLowerCase().includes(search.toLowerCase()) && !m.team.toLowerCase().includes(search.toLowerCase())) return false
        if (typeFilter   !== 'all' && m.type   !== typeFilter) return false
        if (statusFilter !== 'all' && m.status !== statusFilter) return false
        if (teamFilter   !== 'all' && m.team   !== teamFilter) return false
        return true
      }),
    [models, search, typeFilter, statusFilter, teamFilter],
  )

  const counts = useMemo(
    () => ({
      total:    models.length,
      healthy:  models.filter((m) => m.status === 'healthy').length,
      warning:  models.filter((m) => m.status === 'warning').length,
      critical: models.filter((m) => m.status === 'critical').length,
    }),
    [models],
  )

  return (
    <div>
      {/* ── Summary cards ── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <MetricCard label="Total Models" value={counts.total}    icon="box"            color={theme.accent} />
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
            gridTemplateColumns: '2fr 1fr 1fr 1fr 100px 90px 60px',
            padding: '10px 18px',
            borderBottom: `1px solid ${theme.border}`,
            fontSize: 11, fontWeight: 600, color: theme.textDim,
            textTransform: 'uppercase', letterSpacing: 0.8,
          }}
        >
          <span>Model</span><span>Team</span><span>Type</span><span>Last Run</span>
          <span>PSI Trend</span><span>Status</span><span />
        </div>

        {/* rows */}
        {filtered.map((m) => (
          <div
            key={m.id}
            onClick={() => onSelect(m)}
            style={{
              display: 'grid',
              gridTemplateColumns: '2fr 1fr 1fr 1fr 100px 90px 60px',
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
            <div style={{ fontSize: 12, color: theme.textDim }}>
              {m.runs[m.runs.length - 1]?.triggered_at?.slice(0, 10) || '—'}
            </div>
            <div><Sparkline data={m.psiTimeline.slice(-10)} color={driftColor(m.globalPsi)} /></div>
            <div>
              <StatusDot status={m.status} />
              <span style={{ color: statusColor(m.status), fontWeight: 600, fontSize: 12 }}>{m.status}</span>
            </div>
            <div><Icon name="chevron-right" size={14} style={{ color: theme.textDim }} /></div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: theme.textDim }}>No models match your filters</div>
        )}
      </div>
    </div>
  )
}
