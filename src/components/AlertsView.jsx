/* ═══════════════════════════════════════════
   Alerts & Incidents View
   ═══════════════════════════════════════════ */

import { useState } from 'react'
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

export default function AlertsView({ alerts, models, onSelectModel, onRefresh }) {
  const [sevFilter, setSevFilter]       = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [editingAssignee, setEditingAssignee] = useState(null) // { id, value }
  const [saving, setSaving] = useState(null) // alert id being saved

  const filtered = alerts.filter((a) => {
    if (sevFilter    !== 'all' && a.severity !== sevFilter)    return false
    if (statusFilter !== 'all' && a.status   !== statusFilter) return false
    return true
  })

  const counts = {
    open:     alerts.filter((a) => a.status === 'open').length,
    ack:      alerts.filter((a) => a.status === 'acknowledged').length,
    resolved: alerts.filter((a) => a.status === 'resolved').length,
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

  return (
    <div>
      {/* Summary */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <MetricCard label="Open"         value={counts.open}     icon="bell"         color={theme.red} />
        <MetricCard label="Acknowledged" value={counts.ack}      icon="eye"          color={theme.yellow} />
        <MetricCard label="Resolved"     value={counts.resolved} icon="check-circle" color={theme.green} />
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <Select value={sevFilter}    onChange={setSevFilter}    options={[{ value: 'all', label: 'All Severities' }, ...SEVERITIES.map((s) => ({ value: s, label: s }))]} />
        <Select value={statusFilter} onChange={setStatusFilter} options={[{ value: 'all', label: 'All Statuses' }, { value: 'open', label: 'Open' }, { value: 'acknowledged', label: 'Acknowledged' }, { value: 'resolved', label: 'Resolved' }]} />
      </div>

      {/* Table */}
      <Card>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
              {['Severity', 'Model', 'Metric', 'Value', 'Threshold', 'Status', 'Assigned To', 'Actions'].map((h) => (
                <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: theme.textDim, fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => {
              const mdl = models.find((m) => m.id === a.model_id)
              const action = NEXT_ACTION[a.status]
              const isEditing = editingAssignee?.id === a.id
              const isSaving = saving === a.id

              return (
                <tr key={a.id} style={{ borderBottom: `1px solid ${theme.border}08` }}>
                  <td style={{ padding: '8px 10px' }}>
                    <Badge color={severityColor(a.severity)}>{a.severity}</Badge>
                  </td>

                  {/* Model name — clickable, with (demo) badge */}
                  <td
                    style={{ padding: '8px 10px', fontWeight: 500, cursor: mdl ? 'pointer' : 'default', color: mdl ? theme.accent : theme.text }}
                    onClick={() => mdl && onSelectModel?.(mdl)}
                  >
                    {mdl?.name || 'Unknown'}
                    {mdl?.is_demo && (
                      <span style={{ fontSize: 10, color: theme.purple, fontWeight: 600, marginLeft: 5 }}>(demo)</span>
                    )}
                  </td>

                  <td style={{ padding: '8px 10px', color: theme.textMuted }}>{a.metric_name}</td>
                  <td style={{ padding: '8px 10px', color: theme.red, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmt(a.metric_value)}</td>
                  <td style={{ padding: '8px 10px', color: theme.textDim, fontVariantNumeric: 'tabular-nums' }}>{fmt(a.threshold)}</td>

                  {/* Status badge */}
                  <td style={{ padding: '8px 10px' }}>
                    <Badge
                      color={a.status === 'open' ? theme.red : a.status === 'acknowledged' ? theme.yellow : theme.green}
                      style={{ textTransform: 'capitalize' }}
                    >
                      {a.status}
                    </Badge>
                  </td>

                  {/* Assignee inline edit */}
                  <td style={{ padding: '8px 10px' }}>
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

                  {/* Action button */}
                  <td style={{ padding: '8px 10px' }}>
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
                <td colSpan={8} style={{ padding: 30, textAlign: 'center', color: theme.textDim }}>No alerts match your filters</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
