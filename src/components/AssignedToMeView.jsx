/* ═══════════════════════════════════════════
   Assigned to Me — personal alert queue
   ═══════════════════════════════════════════ */

import { useState } from 'react'
import Icon from './Icon.jsx'
import { Badge, StatusDot } from './ui.jsx'
import { theme, severityColor } from '../utils/theme.js'
import { fmt } from '../utils/helpers.js'
import { api } from '../api.js'
import AcknowledgeModal from './AcknowledgeModal.jsx'

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

function alertCategory(metricName) {
  const m = (metricName || '').toLowerCase()
  if (['psi', 'ks_stat', 'jsd', 'wasserstein', 'chi2_stat'].includes(m)) return { label: 'Drift',   color: '#6366f1' }
  if (['accuracy', 'f1_score', 'auc_roc', 'precision', 'recall', 'r2', 'mae', 'rmse', 'prediction_psi'].includes(m)) return { label: 'Perf',    color: '#f59e0b' }
  if (['missing_rate', 'outlier_rate'].includes(m)) return { label: 'Quality', color: '#06b6d4' }
  return { label: 'Alert', color: theme.textDim }
}

export default function AssignedToMeView({ alerts, models, teams, currentUser, onSelectModel, onRefresh }) {
  const [reassignModal, setReassignModal] = useState(null)
  const [saving, setSaving] = useState(null)
  const [confirmResolve, setConfirmResolve] = useState(null)

  if (!currentUser) {
    return (
      <div style={{ padding: '60px 24px', textAlign: 'center' }}>
        <Icon name="user" size={32} style={{ color: theme.textDim, opacity: 0.4, marginBottom: 16 }} />
        <div style={{ fontSize: 15, fontWeight: 600, color: theme.text, marginBottom: 8 }}>Who are you?</div>
        <div style={{ fontSize: 13, color: theme.textMuted }}>
          Set your identity using the <strong style={{ color: theme.accent }}>identity picker</strong> in the top-right header to see alerts assigned to you.
        </div>
      </div>
    )
  }

  const myAlerts = alerts.filter(a => a.assigned_to_user_id === currentUser.id && a.status !== 'resolved')
  const resolvedCount = alerts.filter(a => a.assigned_to_user_id === currentUser.id && a.status === 'resolved').length

  async function handleResolve(alertId) {
    setSaving(alertId)
    try {
      await api.updateAlert(alertId, { status: 'resolved' })
      setConfirmResolve(null)
      onRefresh?.()
    } finally {
      setSaving(null)
    }
  }

  if (myAlerts.length === 0) {
    return (
      <div style={{ padding: '60px 24px', textAlign: 'center' }}>
        <Icon name="check-circle" size={32} style={{ color: theme.green, opacity: 0.5, marginBottom: 16 }} />
        <div style={{ fontSize: 15, fontWeight: 600, color: theme.text, marginBottom: 8 }}>
          All clear, {currentUser.display_name}
        </div>
        <div style={{ fontSize: 13, color: theme.textMuted }}>
          No open alerts assigned to you.
          {resolvedCount > 0 && ` You've resolved ${resolvedCount} alert${resolvedCount > 1 ? 's' : ''}.`}
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: theme.text }}>
            {myAlerts.length} open alert{myAlerts.length > 1 ? 's' : ''} assigned to you
          </div>
          {resolvedCount > 0 && (
            <div style={{ fontSize: 12, color: theme.textDim, marginTop: 2 }}>
              {resolvedCount} resolved by you
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: theme.textMuted }}>
          <div style={{
            width: 26, height: 26, borderRadius: '50%',
            background: theme.accent + '20', color: theme.accent,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 700,
          }}>
            {currentUser.display_name[0].toUpperCase()}
          </div>
          {currentUser.display_name}
        </div>
      </div>

      {/* Alert cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {myAlerts.map(a => {
          const mdl = models.find(m => m.id === a.model_id)
          const cat = alertCategory(a.metric_name)
          const tta = fmtDuration(a.created_at, a.acknowledged_at)
          const age = fmtDuration(a.created_at)
          const isSaving = saving === a.id

          return (
            <div key={a.id} style={{
              background: theme.bgCard, border: `1px solid ${theme.border}`,
              borderRadius: 12, padding: '14px 18px',
              borderLeft: `3px solid ${severityColor(a.severity)}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                {/* Left: alert info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
                    <Badge color={severityColor(a.severity)}>{a.severity}</Badge>
                    <span style={{ fontWeight: 600, fontSize: 13, color: theme.text }}>{a.metric_name}</span>
                    {a.feature_name && <span style={{ fontSize: 11, color: theme.textDim }}>· {a.feature_name}</span>}
                    <span style={{
                      fontSize: 10, padding: '1px 7px', borderRadius: 8,
                      background: cat.color + '18', color: cat.color, fontWeight: 600,
                    }}>{cat.label}</span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: theme.textMuted, flexWrap: 'wrap' }}>
                    <span
                      onClick={() => mdl && onSelectModel?.(mdl)}
                      style={{ cursor: mdl ? 'pointer' : 'default', color: mdl ? theme.accent : theme.textMuted, fontWeight: 500 }}
                    >
                      {mdl?.name ?? 'Unknown model'}
                    </span>
                    <span>{mdl?.team ?? '—'}</span>
                    <span style={{ fontFamily: 'var(--font-mono)' }}>
                      {fmt(a.metric_value)} / {fmt(a.threshold)}
                    </span>
                  </div>

                  {/* Timing */}
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    {age && (
                      <span style={{ fontSize: 10, color: theme.textDim }}>
                        <Icon name="clock" size={9} style={{ marginRight: 3 }} />
                        Opened {age} ago
                      </span>
                    )}
                    {tta && (
                      <span style={{ fontSize: 10, color: theme.yellow, fontFamily: 'var(--font-mono)' }}>
                        TTA: {tta}
                      </span>
                    )}
                  </div>
                </div>

                {/* Right: actions */}
                <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                  {/* Reassign */}
                  <button
                    onClick={() => setReassignModal(a)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '5px 12px', borderRadius: 7,
                      border: `1px solid ${theme.purple}40`,
                      background: theme.purple + '12', color: theme.purple,
                      cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 600,
                    }}
                  >
                    <Icon name="user-check" size={11} />
                    Reassign
                  </button>

                  {/* Resolve */}
                  {confirmResolve === a.id ? (
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: theme.textMuted }}>Confirm?</span>
                      <button
                        onClick={() => handleResolve(a.id)}
                        disabled={isSaving}
                        style={{
                          padding: '4px 10px', borderRadius: 7, border: 'none',
                          background: theme.green, color: '#000',
                          cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 600,
                        }}
                      >
                        {isSaving ? '…' : 'Resolve'}
                      </button>
                      <button
                        onClick={() => setConfirmResolve(null)}
                        style={{
                          padding: '4px 8px', borderRadius: 7,
                          border: `1px solid ${theme.border}`,
                          background: 'transparent', color: theme.textDim,
                          cursor: 'pointer', fontFamily: 'inherit', fontSize: 11,
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmResolve(a.id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        padding: '5px 12px', borderRadius: 7,
                        border: `1px solid ${theme.green}40`,
                        background: theme.green + '12', color: theme.green,
                        cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, fontWeight: 600,
                      }}
                    >
                      <Icon name="check" size={11} />
                      Mark Resolved
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Reassign modal */}
      {reassignModal && (
        <AcknowledgeModal
          alert={reassignModal}
          models={models}
          teams={teams}
          currentUser={currentUser}
          onConfirm={() => { onRefresh?.() }}
          onClose={() => setReassignModal(null)}
        />
      )}
    </div>
  )
}
