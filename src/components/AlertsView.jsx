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
import AcknowledgeModal from './AcknowledgeModal.jsx'
import AssignedToMeView from './AssignedToMeView.jsx'

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

/* Format duration between two ISO timestamps */
function fmtDuration(from, to) {
  if (!from) return null
  const ms = new Date(to ?? Date.now()) - new Date(from)
  if (ms < 0) return null
  const mins  = Math.floor(ms / 60_000)
  const hours = Math.floor(mins / 60)
  const days  = Math.floor(hours / 24)
  if (days > 0)  return `${days}d ${hours % 24}h`
  if (hours > 0) return `${hours}h ${mins % 60}m`
  return `${mins}m`
}

function TimingBadge({ label, value, color }) {
  if (!value) return null
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      fontSize: 10, padding: '1px 6px', borderRadius: 8,
      background: color + '15', color,
      fontFamily: 'var(--font-mono)', fontWeight: 600,
    }}>
      {label} {value}
    </span>
  )
}

export default function AlertsView({ alerts, models, teams = [], currentUser, onSelectModel, onRefresh }) {
  const [tab,          setTab]          = useState('models')
  const [sevFilter,    setSevFilter]    = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [teamFilter,   setTeamFilter]   = useState('all')
  const [modelFilter,  setModelFilter]  = useState('all')
  const [saving,       setSaving]       = useState(null)
  const [ackModal,     setAckModal]     = useState(null) // alert object

  const isDemo = tab === 'demo'
  const isMine = tab === 'mine'

  // Split alerts by demo vs real
  const demoModelIds  = useMemo(() => new Set(models.filter((m) => m.is_demo).map((m) => m.id)), [models])
  const tabAlerts     = useMemo(() => alerts.filter((a) => isDemo ? demoModelIds.has(a.model_id) : !demoModelIds.has(a.model_id)), [alerts, demoModelIds, isDemo])

  // Tab counts (open alerts only, for the badge)
  const realOpenCount = useMemo(() => alerts.filter((a) => !demoModelIds.has(a.model_id) && a.status === 'open').length, [alerts, demoModelIds])
  const demoOpenCount = useMemo(() => alerts.filter((a) =>  demoModelIds.has(a.model_id) && a.status === 'open').length, [alerts, demoModelIds])
  const mineCount     = useMemo(() => currentUser ? alerts.filter((a) => a.assigned_to_user_id === currentUser.id && a.status !== 'resolved').length : 0, [alerts, currentUser])

  // Build team + model option lists scoped to the active tab's models
  const tabModels = useMemo(() => models.filter((m) => isDemo ? m.is_demo : !m.is_demo), [models, isDemo])

  const teamOptions = useMemo(() => {
    const ts = [...new Set(tabModels.map((m) => m.team).filter(Boolean))].sort()
    return [{ value: 'all', label: 'All Teams' }, ...ts.map((t) => ({ value: t, label: t }))]
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

  async function handleReopen(alertId) {
    setSaving(alertId)
    try {
      await api.updateAlert(alertId, { status: 'open' })
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

  function handleTeamChange(t) {
    setTeamFilter(t)
    setModelFilter('all')
  }

  return (
    <div>
      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, flexWrap: 'wrap' }}>
        {[
          { key: 'models', label: 'Models',         icon: 'grid', count: realOpenCount },
          { key: 'demo',   label: 'Demo Gallery',   icon: 'play', count: demoOpenCount },
          { key: 'mine',   label: 'Assigned to me', icon: 'user', count: mineCount },
        ].map((t) => {
          const active = tab === t.key
          const isMineTab = t.key === 'mine'
          const badgeColor = isMineTab && t.count > 0 ? theme.red : (active ? theme.accent : theme.textDim)
          return (
            <button
              key={t.key}
              onClick={() => handleTabChange(t.key)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 16px', borderRadius: 8,
                border: active ? `1px solid ${theme.accent}40` : `1px solid ${theme.border}`,
                cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: 500,
                background: active ? theme.accent + '14' : theme.bgCard,
                color: active ? theme.accent : theme.textMuted,
                transition: 'all 0.15s',
              }}
            >
              <Icon name={t.icon} size={13} />
              {t.label}
              <span style={{
                fontSize: 11, fontWeight: 700,
                background: active ? theme.accent + '25' : isMineTab && t.count > 0 ? theme.red + '20' : theme.bgInput,
                color: active ? theme.accent : badgeColor,
                padding: '1px 7px', borderRadius: 10,
              }}>
                {t.count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Assigned to me view */}
      {isMine && (
        <AssignedToMeView
          alerts={alerts}
          models={models}
          teams={teams}
          currentUser={currentUser}
          onSelectModel={onSelectModel}
          onRefresh={onRefresh}
        />
      )}

      {isMine ? null : (<>

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
              {['Severity', 'Model', 'Team', 'Reason', 'Metric', 'Value / Thr', 'Assigned To', 'Timing', 'Status', 'Actions'].map((h) => (
                <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: theme.textDim, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => {
              const mdl = models.find((m) => m.id === a.model_id)
              const isSaving = saving === a.id
              const cat = alertCategory(a.metric_name)
              const tta = fmtDuration(a.created_at, a.acknowledged_at)
              const ttr = fmtDuration(a.created_at, a.resolved_at)

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

                  {/* Reason */}
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

                  {/* Assigned To */}
                  <td style={{ padding: '10px 10px', whiteSpace: 'nowrap' }}>
                    {a.assigned_user ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{
                          width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                          background: theme.purple + '25', color: theme.purple,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 10, fontWeight: 700,
                        }}>
                          {a.assigned_user.display_name[0].toUpperCase()}
                        </div>
                        <span style={{ fontSize: 12, color: theme.text }}>{a.assigned_user.display_name}</span>
                      </div>
                    ) : (
                      <span style={{ color: theme.textDim, fontSize: 11 }}>Unassigned</span>
                    )}
                  </td>

                  {/* Timing */}
                  <td style={{ padding: '10px 10px', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {tta && <TimingBadge label="TTA" value={tta} color={theme.yellow} />}
                      {ttr && <TimingBadge label="TTR" value={ttr} color={theme.green} />}
                      {!tta && !ttr && (
                        <TimingBadge label="Age" value={fmtDuration(a.created_at)} color={theme.textDim} />
                      )}
                    </div>
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

                  {/* Actions */}
                  <td style={{ padding: '10px 10px', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {/* Open → Acknowledge (opens modal) */}
                      {a.status === 'open' && (
                        <button
                          onClick={() => setAckModal(a)}
                          disabled={isSaving}
                          style={{
                            background: ACTION_COLOR.open + '18',
                            border: `1px solid ${ACTION_COLOR.open}40`,
                            borderRadius: 5, padding: '3px 8px',
                            fontSize: 10, fontWeight: 600, fontFamily: 'inherit',
                            color: ACTION_COLOR.open,
                            cursor: 'pointer', whiteSpace: 'nowrap',
                          }}
                        >
                          Acknowledge
                        </button>
                      )}
                      {/* Acknowledged → reassign or reopen */}
                      {a.status === 'acknowledged' && (
                        <>
                          <button
                            onClick={() => setAckModal(a)}
                            disabled={isSaving}
                            style={{
                              background: theme.purple + '18',
                              border: `1px solid ${theme.purple}40`,
                              borderRadius: 5, padding: '3px 8px',
                              fontSize: 10, fontWeight: 600, fontFamily: 'inherit',
                              color: theme.purple, cursor: 'pointer', whiteSpace: 'nowrap',
                            }}
                          >
                            Reassign
                          </button>
                          <button
                            onClick={() => handleReopen(a.id)}
                            disabled={isSaving}
                            style={{
                              background: theme.textDim + '15',
                              border: `1px solid ${theme.border}`,
                              borderRadius: 5, padding: '3px 8px',
                              fontSize: 10, fontWeight: 600, fontFamily: 'inherit',
                              color: theme.textDim, cursor: 'pointer', whiteSpace: 'nowrap',
                            }}
                          >
                            Reopen
                          </button>
                        </>
                      )}
                      {/* Resolved — no actions */}
                    </div>
                  </td>

                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} style={{ padding: 30, textAlign: 'center', color: theme.textDim }}>No alerts match your filters</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      </>)}

      {/* Acknowledge / Reassign modal */}
      {ackModal && (
        <AcknowledgeModal
          alert={ackModal}
          models={models}
          teams={teams}
          currentUser={currentUser}
          onConfirm={() => { onRefresh?.() }}
          onClose={() => setAckModal(null)}
        />
      )}
    </div>
  )
}
