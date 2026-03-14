/* ═══════════════════════════════════════════
   Alerts & Incidents View
   ═══════════════════════════════════════════ */

import { useState, useMemo } from 'react'
import Icon from './Icon.jsx'
import { Card, Badge, MetricCard, Select } from './ui.jsx'
import { theme, severityColor } from '../utils/theme.js'
import { fmt } from '../utils/helpers.js'
import { SEVERITIES } from '../utils/constants.js'
import { api } from '../api.js'

const NEXT_ACTION = {
  open:         { label: 'Acknowledge', next: 'acknowledged' },
  acknowledged: { label: 'Resolve',     next: 'resolved' },
  resolved:     { label: 'Reopen',      next: 'open' },
}

const ACTION_COLOR = {
  open:         '#f59e0b',
  acknowledged: '#22c55e',
  resolved:     '#6b7280',
}

/* Infer alert category from metric name */
function alertCategory(metricName) {
  const m = (metricName || '').toLowerCase()
  if (['psi', 'ks_stat', 'jsd', 'wasserstein', 'chi2_stat'].includes(m)) {
    return { label: 'Feature Drift', color: '#6366f1' }
  }
  if (['accuracy', 'f1_score', 'auc_roc', 'precision', 'recall', 'r2', 'mae', 'rmse', 'prediction_psi'].includes(m)) {
    return { label: 'Performance', color: '#f59e0b' }
  }
  if (['missing_rate', 'outlier_rate'].includes(m)) {
    return { label: 'Data Quality', color: '#06b6d4' }
  }
  return { label: 'Alert', color: theme.textDim }
}

export default function AlertsView({ alerts, models, onSelectModel, onRefresh }) {
  const [tab,          setTab]          = useState('models')
  const [sevFilter,    setSevFilter]    = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [teamFilter,   setTeamFilter]   = useState('all')
  const [modelFilter,  setModelFilter]  = useState('all')
  const [editingAssignee, setEditingAssignee] = useState(null)
  const [saving, setSaving] = useState(null)

  const isDemo = tab === 'demo'

  // Split alerts by demo vs real
  const demoModelIds  = useMemo(() => new Set(models.filter((m) => m.is_demo).map((m) => m.id)), [models])
  const tabAlerts     = useMemo(() => alerts.filter((a) => isDemo ? demoModelIds.has(a.model_id) : !demoModelIds.has(a.model_id)), [alerts, demoModelIds, isDemo])

  // Tab counts (open alerts only, for the badge)
  const realOpenCount = useMemo(() => alerts.filter((a) => !demoModelIds.has(a.model_id) && a.status === 'open').length, [alerts, demoModelIds])
  const demoOpenCount = useMemo(() => alerts.filter((a) =>  demoModelIds.has(a.model_id) && a.status === 'open').length, [alerts, demoModelIds])

  // Build team + model option lists scoped to the active tab's models
  const tabModels = useMemo(() => models.filter((m) => isDemo ? m.is_demo : !m.is_demo), [models, isDemo])

  const teamOptions = useMemo(() => {
    const teams = [...new Set(tabModels.map((m) => m.team).filter(Boolean))].sort()
    return [{ value: 'all', label: 'All Teams' }, ...teams.map((t) => ({ value: t, label: t }))]
  }, [tabModels])

  const modelOptions = useMemo(() => {
    const base = teamFilter === 'all' ? tabModels : tabModels.filter((m) => m.team === teamFilter)
    return [{ value: 'all', label: 'All Models' }, ...base.map((m) => ({ value: m.id, label: m.name }))]
  }, [tabModels, teamFilter])

  const filtered = useMemo(() => tabAlerts.filter((a) => {
    if (sevFilter    !== 'all' && a.severity !== sevFilter) return false
    if (statusFilter !== 'all' && a.status   !== statusFilter) return false
    const mdl = models.find((m) => m.id === a.model_id)
    if (teamFilter   !== 'all' && mdl?.team !== teamFilter) return false
    if (modelFilter  !== 'all' && a.model_id !== modelFilter) return false
    return true
  }), [tabAlerts, models, sevFilter, statusFilter, teamFilter, modelFilter])

  const counts = {
    open:     tabAlerts.filter((a) => a.status === 'open').length,
    ack:      tabAlerts.filter((a) => a.status === 'acknowledged').length,
    resolved: tabAlerts.filter((a) => a.status === 'resolved').length,
  }

  async function handleStatusChange(alertId, nextStatus) {
    setSaving(alertId)
    try {
      await api.updateAlert(alertId, { status: nextStatus })
      onRefresh?.()
    } finally {
      setSaving(null)
    }
  }

  async function handleAssigneeSave(alertId, value) {
    setSaving(alertId)
    try {
      await api.updateAlert(alertId, { assigned_to: value || null })
      setEditingAssignee(null)
      onRefresh?.()
    } finally {
      setSaving(null)
    }
  }

  function handleTabChange(t) {
    setTab(t)
    setTeamFilter('all')
    setModelFilter('all')
  }

  // Reset model filter when team filter changes
  function handleTeamChange(t) {
    setTeamFilter(t)
    setModelFilter('all')
  }

  return (
    <div>
      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
        {[
          { key: 'models', label: 'Models',      icon: 'grid', count: realOpenCount },
          { key: 'demo',   label: 'Demo Gallery', icon: 'play', count: demoOpenCount },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => handleTabChange(t.key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 16px', borderRadius: 8,
              border: tab === t.key ? `1px solid ${theme.accent}40` : `1px solid ${theme.border}`,
              cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 500,
              background: tab === t.key ? theme.accent + '14' : theme.bgCard,
              color: tab === t.key ? theme.accent : theme.textMuted,
              transition: 'all 0.15s',
            }}
          >
            <Icon name={t.icon} size={13} />
            {t.label}
            <span style={{
              fontSize: 11, fontWeight: 700,
              background: tab === t.key ? theme.accent + '25' : theme.bgInput,
              color: tab === t.key ? theme.accent : theme.textDim,
              padding: '1px 7px', borderRadius: 10,
            }}>
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* Summary */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <MetricCard label="Open"         value={counts.open}     icon="bell"         color={theme.red} />
        <MetricCard label="Acknowledged" value={counts.ack}      icon="eye"          color={theme.yellow} />
        <MetricCard label="Resolved"     value={counts.resolved} icon="check-circle" color={theme.green} />
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <Select value={sevFilter}    onChange={setSevFilter}    options={[{ value: 'all', label: 'All Severities' }, ...SEVERITIES.map((s) => ({ value: s, label: s }))]} />
        <Select value={statusFilter} onChange={setStatusFilter} options={[{ value: 'all', label: 'All Statuses' }, { value: 'open', label: 'Open' }, { value: 'acknowledged', label: 'Acknowledged' }, { value: 'resolved', label: 'Resolved' }]} />
        <Select value={teamFilter}   onChange={handleTeamChange} options={teamOptions} />
        <Select value={modelFilter}  onChange={setModelFilter}  options={modelOptions} />
      </div>

      {/* Table */}
      <Card style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
              {['Severity', 'Model', 'Team', 'Reason', 'Metric', 'Value / Thr', 'Status', 'Assigned To', 'Actions'].map((h) => (
                <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: theme.textDim, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => {
              const mdl = models.find((m) => m.id === a.model_id)
              const action = NEXT_ACTION[a.status]
              const isEditing = editingAssignee?.id === a.id
              const isSaving = saving === a.id
              const cat = alertCategory(a.metric_name)

              return (
                <tr key={a.id} style={{ borderBottom: `1px solid ${theme.border}18` }}>

                  {/* Severity */}
                  <td style={{ padding: '10px 10px' }}>
                    <Badge color={mdl?.is_demo ? theme.textDim : severityColor(a.severity)}>
                      {mdl?.is_demo ? a.severity.toLowerCase() : a.severity}
                    </Badge>
                  </td>

                  {/* Model name */}
                  <td
                    style={{ padding: '10px 10px', fontWeight: 500, cursor: mdl ? 'pointer' : 'default', color: mdl ? theme.accent : theme.text, whiteSpace: 'nowrap' }}
                    onClick={() => mdl && onSelectModel?.(mdl)}
                  >
                    {mdl?.name || 'Unknown'}
                    {mdl?.is_demo && (
                      <span style={{ fontSize: 10, color: theme.purple, fontWeight: 600, marginLeft: 5 }}>(demo)</span>
                    )}
                  </td>

                  {/* Team */}
                  <td style={{ padding: '10px 10px', color: theme.textMuted, whiteSpace: 'nowrap' }}>
                    {mdl?.team || '—'}
                  </td>

                  {/* Reason — category tag + feature name */}
                  <td style={{ padding: '10px 10px', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{
                        display: 'inline-block', fontSize: 10, fontWeight: 700,
                        padding: '2px 8px', borderRadius: 10,
                        background: cat.color + '20', color: cat.color,
                      }}>
                        {cat.label}
                      </span>
                      {a.feature_name && (
                        <span style={{ fontSize: 11, color: theme.text, fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                          {a.feature_name}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Metric name */}
                  <td style={{ padding: '10px 10px', whiteSpace: 'nowrap' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: theme.textMuted }}>{a.metric_name}</span>
                  </td>

                  {/* Value / Threshold */}
                  <td style={{ padding: '10px 10px', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: severityColor(a.severity) }}>{fmt(a.metric_value)}</span>
                    <span style={{ color: theme.textDim, fontSize: 11, margin: '0 3px' }}>/</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: theme.textDim }}>{fmt(a.threshold)}</span>
                  </td>

                  {/* Status */}
                  <td style={{ padding: '10px 10px' }}>
                    <Badge
                      color={a.status === 'open' ? theme.red : a.status === 'acknowledged' ? theme.yellow : theme.green}
                      style={{ textTransform: 'capitalize' }}
                    >
                      {a.status}
                    </Badge>
                  </td>

                  {/* Assignee inline edit */}
                  <td style={{ padding: '10px 10px' }}>
                    {isEditing ? (
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <input
                          autoFocus
                          value={editingAssignee.value}
                          onChange={(e) => setEditingAssignee({ id: a.id, value: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleAssigneeSave(a.id, editingAssignee.value)
                            if (e.key === 'Escape') setEditingAssignee(null)
                          }}
                          style={{
                            background: theme.bgInput, border: `1px solid ${theme.border}`,
                            borderRadius: 4, padding: '2px 6px', fontSize: 11,
                            color: theme.text, fontFamily: 'inherit', width: 90,
                          }}
                        />
                        <button
                          onClick={() => handleAssigneeSave(a.id, editingAssignee.value)}
                          disabled={isSaving}
                          style={{
                            background: theme.accent + '20', border: `1px solid ${theme.accent}40`,
                            borderRadius: 4, padding: '2px 6px', fontSize: 10,
                            color: theme.accent, cursor: 'pointer', fontFamily: 'inherit',
                          }}
                        >
                          Save
                        </button>
                      </div>
                    ) : (
                      <span
                        onClick={() => setEditingAssignee({ id: a.id, value: a.assigned_to || '' })}
                        style={{ cursor: 'pointer', color: a.assigned_to ? theme.text : theme.textDim, borderBottom: `1px dashed ${theme.border}` }}
                        title="Click to assign"
                      >
                        {a.assigned_to || '—'}
                      </span>
                    )}
                  </td>

                  {/* Action */}
                  <td style={{ padding: '10px 10px' }}>
                    {action && (
                      <button
                        onClick={() => handleStatusChange(a.id, action.next)}
                        disabled={isSaving}
                        style={{
                          background: ACTION_COLOR[a.status] + '18',
                          border: `1px solid ${ACTION_COLOR[a.status]}40`,
                          borderRadius: 5, padding: '3px 8px',
                          fontSize: 10, fontWeight: 600, fontFamily: 'inherit',
                          color: ACTION_COLOR[a.status],
                          cursor: isSaving ? 'default' : 'pointer',
                          opacity: isSaving ? 0.5 : 1,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {action.label}
                      </button>
                    )}
                  </td>

                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} style={{ padding: 30, textAlign: 'center', color: theme.textDim }}>No alerts match your filters</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
