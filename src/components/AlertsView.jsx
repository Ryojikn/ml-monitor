/* ═══════════════════════════════════════════
   Alerts & Incidents View
   ═══════════════════════════════════════════ */

import { useState } from 'react'
import { Card, Badge, MetricCard, Select } from './ui.jsx'
import { theme, severityColor } from '../utils/theme.js'
import { fmt } from '../utils/helpers.js'
import { SEVERITIES } from '../utils/constants.js'

export default function AlertsView({ alerts, models }) {
  const [sevFilter, setSevFilter]       = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')

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
              {['Severity', 'Model', 'Metric', 'Value', 'Threshold', 'Status', 'Time', 'Channels'].map((h) => (
                <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: theme.textDim, fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => {
              const mdl = models.find((m) => m.id === a.model_id)
              return (
                <tr key={a.id} style={{ borderBottom: `1px solid ${theme.border}08` }}>
                  <td style={{ padding: '8px 10px' }}>
                    <Badge color={severityColor(a.severity)}>{a.severity}</Badge>
                  </td>
                  <td style={{ padding: '8px 10px', color: theme.text, fontWeight: 500 }}>{mdl?.name || 'Unknown'}</td>
                  <td style={{ padding: '8px 10px', color: theme.textMuted }}>{a.metric_name}</td>
                  <td style={{ padding: '8px 10px', color: theme.red, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{fmt(a.metric_value)}</td>
                  <td style={{ padding: '8px 10px', color: theme.textDim, fontVariantNumeric: 'tabular-nums' }}>{fmt(a.threshold)}</td>
                  <td style={{ padding: '8px 10px' }}>
                    <Badge color={a.status === 'open' ? theme.red : a.status === 'acknowledged' ? theme.yellow : theme.green} style={{ textTransform: 'capitalize' }}>
                      {a.status}
                    </Badge>
                  </td>
                  <td style={{ padding: '8px 10px', color: theme.textDim }}>{a.created_at.slice(0, 16).replace('T', ' ')}</td>
                  <td style={{ padding: '8px 10px', color: theme.textDim }}>{a.notified_channels?.join(', ')}</td>
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
