/* ═══════════════════════════════════════════
   Model Detail — tabbed deep-dive
   ═══════════════════════════════════════════ */

import { useState, useMemo, useEffect } from 'react'
import {
  AreaChart, Area, BarChart, Bar, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell, Legend,
} from 'recharts'
import Icon from './Icon.jsx'
import {
  Card, Badge, Button, TabBar, MetricCard, StatusDot,
  Sparkline, ChartTooltip, Select,
} from './ui.jsx'
import { theme, statusColor, driftColor } from '../utils/theme.js'
import { fmt, fmtPct } from '../utils/helpers.js'
import { api } from '../api.js'
import { ENGINES } from '../utils/constants.js'

/* ── sub-tabs ── */
const TABS = [
  { key: 'drift',       label: 'Drift Analysis', icon: 'trending-up' },
  { key: 'features',    label: 'Feature Detail',  icon: 'sliders' },
  { key: 'performance', label: 'Performance',     icon: 'activity' },
  { key: 'quality',     label: 'Data Quality',    icon: 'database' },
  { key: 'runs',        label: 'Execution Log',   icon: 'clock' },
  { key: 'config',      label: 'Configuration',   icon: 'settings' },
]

export default function ModelDetail({ model: m, onBack, onRefresh }) {
  const [tab, setTab]                   = useState('drift')
  const [selectedFeature, setFeature]   = useState(null)
  const [histData, setHistData]         = useState(null)
  const [runPending, setRunPending]     = useState(false)

  // Convert stored histogram { bins, counts } into [{ bin, baseline, current }] for Recharts
  function toChartHistogram(baseline_histogram, current_histogram) {
    const bins = baseline_histogram?.bins ?? []
    const bCounts = baseline_histogram?.counts ?? []
    const cCounts = current_histogram?.counts ?? []
    return bins.map((bin, i) => ({
      bin: typeof bin === 'string' ? bin.slice(0, 8) : String(bin).slice(0, 6),
      baseline: bCounts[i] ?? 0,
      current:  cCounts[i] ?? 0,
    }))
  }

  useEffect(() => {
    if (!selectedFeature) { setHistData(null); return }
    // First try to use stored histogram from featureDrift data
    if (selectedFeature.baseline_histogram && selectedFeature.current_histogram) {
      setHistData(toChartHistogram(selectedFeature.baseline_histogram, selectedFeature.current_histogram))
      return
    }
    // Fall back to API call
    api.getHistogram(m.id, selectedFeature.feature)
      .then((r) => setHistData(toChartHistogram(r.baseline_histogram, r.current_histogram)))
      .catch(() => setHistData(null))
  }, [m.id, selectedFeature])

  const handleTriggerRun = async () => {
    setRunPending(true)
    try {
      await api.triggerRun(m.id)
      // Poll until run completes
      const poll = setInterval(async () => {
        const runs = await api.listRuns(m.id).catch(() => null)
        if (runs && runs.length > 0) {
          const latest = runs[0]
          if (latest.status !== 'running') {
            clearInterval(poll)
            setRunPending(false)
            if (onRefresh) onRefresh(m.id)
          }
        }
      }, 2500)
      // Safety timeout after 60s
      setTimeout(() => { clearInterval(poll); setRunPending(false) }, 60000)
    } catch {
      setRunPending(false)
    }
  }

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={onBack} style={{ background: 'none', border: 'none', color: theme.textMuted, cursor: 'pointer', padding: 4 }}>
          <Icon name="chevron-left" size={20} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 22, color: theme.text, fontWeight: 700 }}>{m.name}</h2>
            <StatusDot status={m.status} size={10} />
            <Badge color={statusColor(m.status)} style={{ textTransform: 'capitalize' }}>{m.status}</Badge>
            <Badge color={theme.purple}>{m.type}</Badge>
          </div>
          <div style={{ fontSize: 12, color: theme.textDim, marginTop: 4 }}>
            {m.owner} · {m.team} · Engine: {m.engine} · Schedule: {m.schedule} · Lookback: {m.lookback_window}
          </div>
        </div>
        <Button icon="play" size="sm" onClick={handleTriggerRun} disabled={runPending}>
          {runPending ? 'Running…' : 'Trigger Run'}
        </Button>
        <Button icon="settings" size="sm" variant="ghost" />
      </div>

      {/* ── Summary cards ── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <MetricCard label="Global PSI" value={fmt(m.globalPsi, 3)} color={driftColor(m.globalPsi)} icon="trending-up"
          subtitle={m.globalPsi > 0.25 ? 'Significant drift' : m.globalPsi > 0.1 ? 'Moderate drift' : 'Stable'} />
        <MetricCard label="Pred. Drift" value={fmt(m.predictionDrift[m.predictionDrift.length - 1]?.value, 3)}
          color={driftColor(m.predictionDrift[m.predictionDrift.length - 1]?.value || 0)} icon="bar-chart-2" />
        <MetricCard label="Data Quality" value={fmtPct(m.dqScore)}
          color={m.dqScore > 0.95 ? theme.green : m.dqScore > 0.9 ? theme.yellow : theme.red} icon="database" />
        <MetricCard label="Performance" value={fmt(m.globalPerf, 3)}
          color={m.globalPerf > 0.85 ? theme.green : m.globalPerf > 0.7 ? theme.yellow : theme.red}
          icon="activity" subtitle={m.type === 'regression' ? 'R²' : 'AUC-ROC'} />
      </div>

      <TabBar tabs={TABS} active={tab} onChange={setTab} />

      {/* ════════════════════════ DRIFT TAB ════════════════════════ */}
      {tab === 'drift' && (
        <div>
          <Card style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: theme.text, marginBottom: 12 }}>
              <Icon name="trending-up" size={14} style={{ marginRight: 6, verticalAlign: -2, color: theme.accent }} />
              Drift Timeline (PSI)
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={m.psiTimeline}>
                <CartesianGrid strokeDasharray="3 3" stroke={theme.border} />
                <XAxis dataKey="date" tick={{ fill: theme.textDim, fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                <YAxis tick={{ fill: theme.textDim, fontSize: 10 }} domain={[0, 'auto']} />
                <Tooltip content={<ChartTooltip />} />
                <ReferenceLine y={0.1}  stroke={theme.yellow} strokeDasharray="4 4" label={{ value: 'Warning',  fill: theme.yellow, fontSize: 10 }} />
                <ReferenceLine y={0.25} stroke={theme.red}    strokeDasharray="4 4" label={{ value: 'Critical', fill: theme.red,    fontSize: 10 }} />
                <Area type="monotone" dataKey="value" fill={theme.accent + '15'} stroke={theme.accent} strokeWidth={2} name="PSI" />
              </ComposedChart>
            </ResponsiveContainer>
          </Card>

          {/* ── Feature drift table ── */}
          <Card>
            <div style={{ fontSize: 14, fontWeight: 600, color: theme.text, marginBottom: 12 }}>
              <Icon name="grid" size={14} style={{ marginRight: 6, verticalAlign: -2, color: theme.accent }} />
              Feature Drift Summary
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
                    {['Feature', 'PSI', 'KS Stat', 'JSD', 'Wasserstein', 'Status', 'Trend'].map((h) => (
                      <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: theme.textDim, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {m.featureDrift
                    .slice()
                    .sort((a, b) => b.psi - a.psi)
                    .map((fd) => (
                      <tr
                        key={fd.feature}
                        onClick={() => setFeature(fd)}
                        style={{ borderBottom: `1px solid ${theme.border}08`, cursor: 'pointer', transition: 'background 0.15s' }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = theme.bgCardHover }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                      >
                        <td style={{ padding: '8px 10px', fontWeight: 600, color: theme.text }}>{fd.feature}</td>
                        <td style={{ padding: '8px 10px' }}>
                          <span style={{ color: driftColor(fd.psi), fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{fmt(fd.psi)}</span>
                        </td>
                        <td style={{ padding: '8px 10px', color: theme.textMuted, fontVariantNumeric: 'tabular-nums' }}>{fmt(fd.ks_stat)}</td>
                        <td style={{ padding: '8px 10px', color: theme.textMuted, fontVariantNumeric: 'tabular-nums' }}>{fmt(fd.jsd)}</td>
                        <td style={{ padding: '8px 10px', color: theme.textMuted, fontVariantNumeric: 'tabular-nums' }}>{fmt(fd.wasserstein)}</td>
                        <td style={{ padding: '8px 10px' }}>
                          <Badge color={driftColor(fd.psi)} style={{ textTransform: 'capitalize' }}>{fd.severity}</Badge>
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <Sparkline data={fd.timeline.slice(-10)} color={driftColor(fd.psi)} width={60} height={18} />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* ── Distribution comparison modal ── */}
          {selectedFeature && histData && (
            <div
              style={{
                position: 'fixed', inset: 0,
                background: 'rgba(0,0,0,0.7)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 1000, backdropFilter: 'blur(4px)',
              }}
              onClick={() => setFeature(null)}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: theme.bgCard, border: `1px solid ${theme.border}`,
                  borderRadius: 16, padding: 24,
                  width: '90%', maxWidth: 700, maxHeight: '85vh', overflow: 'auto',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <h3 style={{ margin: 0, color: theme.text }}>{selectedFeature.feature} — Distribution Comparison</h3>
                  <button onClick={() => setFeature(null)} style={{ background: 'none', border: 'none', color: theme.textMuted, cursor: 'pointer' }}>
                    <Icon name="x" size={18} />
                  </button>
                </div>
                <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                  <Badge color={driftColor(selectedFeature.psi)}>PSI: {fmt(selectedFeature.psi)}</Badge>
                  <Badge color={theme.blue}>KS: {fmt(selectedFeature.ks_stat)}</Badge>
                  <Badge color={theme.purple}>JSD: {fmt(selectedFeature.jsd)}</Badge>
                </div>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={histData} barGap={0}>
                    <CartesianGrid strokeDasharray="3 3" stroke={theme.border} />
                    <XAxis dataKey="bin" tick={{ fill: theme.textDim, fontSize: 10 }} />
                    <YAxis tick={{ fill: theme.textDim, fontSize: 10 }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend />
                    <Bar dataKey="baseline" fill={theme.accent + '90'} name="Baseline" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="current"  fill={theme.pink + '90'}   name="Current"  radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, marginBottom: 8 }}>Drift Over Time</div>
                  <ResponsiveContainer width="100%" height={150}>
                    <AreaChart data={selectedFeature.timeline}>
                      <CartesianGrid strokeDasharray="3 3" stroke={theme.border} />
                      <XAxis dataKey="date" tick={{ fill: theme.textDim, fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                      <YAxis tick={{ fill: theme.textDim, fontSize: 10 }} />
                      <Tooltip content={<ChartTooltip />} />
                      <ReferenceLine y={0.1}  stroke={theme.yellow} strokeDasharray="3 3" />
                      <ReferenceLine y={0.25} stroke={theme.red}    strokeDasharray="3 3" />
                      <Area type="monotone" dataKey="value" fill={driftColor(selectedFeature.psi) + '20'} stroke={driftColor(selectedFeature.psi)} strokeWidth={2} name="PSI" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════ FEATURES TAB ════════════════════════ */}
      {tab === 'features' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 12 }}>
          {m.featureDrift
            .slice()
            .sort((a, b) => b.psi - a.psi)
            .map((fd) => {
              const hist = toChartHistogram(fd.baseline_histogram, fd.current_histogram)
              return (
                <Card key={fd.feature} style={{ cursor: 'pointer' }} onClick={() => setFeature(fd)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <span style={{ fontWeight: 600, color: theme.text, fontSize: 13 }}>{fd.feature}</span>
                    <Badge color={driftColor(fd.psi)}>{fd.severity}</Badge>
                  </div>
                  <div style={{ display: 'flex', gap: 16, fontSize: 11, color: theme.textMuted, marginBottom: 10 }}>
                    <span>PSI: <b style={{ color: driftColor(fd.psi) }}>{fmt(fd.psi)}</b></span>
                    <span>KS: <b>{fmt(fd.ks_stat)}</b></span>
                    <span>JSD: <b>{fmt(fd.jsd)}</b></span>
                  </div>
                  <ResponsiveContainer width="100%" height={100}>
                    <BarChart data={hist} barGap={0}>
                      <Bar dataKey="baseline" fill={theme.accent + '60'} radius={[1, 1, 0, 0]} />
                      <Bar dataKey="current"  fill={theme.pink + '60'}   radius={[1, 1, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              )
            })}
        </div>
      )}

      {/* ════════════════════════ PERFORMANCE TAB ════════════════════════ */}
      {tab === 'performance' && (
        <div>
          <Card style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: theme.text, marginBottom: 12 }}>
              <Icon name="activity" size={14} style={{ marginRight: 6, verticalAlign: -2, color: theme.green }} />
              {m.type === 'regression' ? 'R² Score' : 'AUC-ROC'} Over Time
            </div>
            <ResponsiveContainer width="100%" height={250}>
              <ComposedChart data={m.performanceTimeline}>
                <CartesianGrid strokeDasharray="3 3" stroke={theme.border} />
                <XAxis dataKey="date" tick={{ fill: theme.textDim, fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                <YAxis tick={{ fill: theme.textDim, fontSize: 10 }} domain={['auto', 'auto']} />
                <Tooltip content={<ChartTooltip />} />
                <ReferenceLine y={0.8} stroke={theme.yellow} strokeDasharray="4 4" />
                <Area type="monotone" dataKey="value" fill={theme.green + '15'} stroke={theme.green} strokeWidth={2} name={m.type === 'regression' ? 'R²' : 'AUC-ROC'} />
              </ComposedChart>
            </ResponsiveContainer>
          </Card>
          <Card>
            <div style={{ fontSize: 14, fontWeight: 600, color: theme.text, marginBottom: 12 }}>
              <Icon name="bar-chart-2" size={14} style={{ marginRight: 6, verticalAlign: -2, color: theme.accent }} />
              Prediction Distribution Drift
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={m.predictionDrift}>
                <CartesianGrid strokeDasharray="3 3" stroke={theme.border} />
                <XAxis dataKey="date" tick={{ fill: theme.textDim, fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                <YAxis tick={{ fill: theme.textDim, fontSize: 10 }} />
                <Tooltip content={<ChartTooltip />} />
                <ReferenceLine y={0.1}  stroke={theme.yellow} strokeDasharray="3 3" />
                <ReferenceLine y={0.25} stroke={theme.red}    strokeDasharray="3 3" />
                <Area type="monotone" dataKey="value" fill={theme.blue + '15'} stroke={theme.blue} strokeWidth={2} name="Prediction PSI" />
              </AreaChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}

      {/* ════════════════════════ DATA QUALITY TAB ════════════════════════ */}
      {tab === 'quality' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
            <Card>
              <div style={{ fontSize: 14, fontWeight: 600, color: theme.text, marginBottom: 12 }}>
                <Icon name="database" size={14} style={{ marginRight: 6, verticalAlign: -2, color: theme.yellow }} />
                Missing Values Rate
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={m.dqMissing.slice().sort((a, b) => b.rate - a.rate)} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke={theme.border} />
                  <XAxis type="number" tick={{ fill: theme.textDim, fontSize: 10 }} tickFormatter={(v) => fmtPct(v)} domain={[0, 'auto']} />
                  <YAxis type="category" dataKey="feature" tick={{ fill: theme.textMuted, fontSize: 10 }} width={120} />
                  <Tooltip content={<ChartTooltip />} formatter={(v) => fmtPct(v)} />
                  <Bar dataKey="rate" name="Missing %" radius={[0, 4, 4, 0]}>
                    {m.dqMissing.slice().sort((a, b) => b.rate - a.rate).map((d, i) => (
                      <Cell key={i} fill={d.rate > 0.05 ? theme.red : d.rate > 0.02 ? theme.yellow : theme.green} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>

            <Card>
              <div style={{ fontSize: 14, fontWeight: 600, color: theme.text, marginBottom: 12 }}>
                <Icon name="zap" size={14} style={{ marginRight: 6, verticalAlign: -2, color: theme.purple }} />
                Outlier Rate
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={m.dqOutlier.slice().sort((a, b) => b.rate - a.rate)} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke={theme.border} />
                  <XAxis type="number" tick={{ fill: theme.textDim, fontSize: 10 }} tickFormatter={(v) => fmtPct(v)} domain={[0, 'auto']} />
                  <YAxis type="category" dataKey="feature" tick={{ fill: theme.textMuted, fontSize: 10 }} width={120} />
                  <Tooltip content={<ChartTooltip />} formatter={(v) => fmtPct(v)} />
                  <Bar dataKey="rate" name="Outlier %" radius={[0, 4, 4, 0]}>
                    {m.dqOutlier.slice().sort((a, b) => b.rate - a.rate).map((d, i) => (
                      <Cell key={i} fill={d.rate > 0.03 ? theme.red : d.rate > 0.01 ? theme.yellow : theme.accent} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>

          <Card>
            <div style={{ fontSize: 14, fontWeight: 600, color: theme.text, marginBottom: 12 }}>Data Quality Summary</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
                  {['Feature', 'Missing %', 'Outlier %', 'Status'].map((h) => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: theme.textDim, fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {m.features.map((f) => {
                  const miss = m.dqMissing.find((d) => d.feature === f)?.rate || 0
                  const out  = m.dqOutlier.find((d) => d.feature === f)?.rate || 0
                  const ok   = miss < 0.02 && out < 0.02
                  return (
                    <tr key={f} style={{ borderBottom: `1px solid ${theme.border}08` }}>
                      <td style={{ padding: '8px 10px', fontWeight: 600, color: theme.text }}>{f}</td>
                      <td style={{ padding: '8px 10px', color: miss > 0.02 ? theme.yellow : theme.textMuted }}>{fmtPct(miss)}</td>
                      <td style={{ padding: '8px 10px', color: out > 0.02 ? theme.yellow : theme.textMuted }}>{fmtPct(out)}</td>
                      <td style={{ padding: '8px 10px' }}><Badge color={ok ? theme.green : theme.yellow}>{ok ? 'OK' : 'Check'}</Badge></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </Card>
        </div>
      )}

      {/* ════════════════════════ RUNS TAB ════════════════════════ */}
      {tab === 'runs' && (
        <Card>
          <div style={{ fontSize: 14, fontWeight: 600, color: theme.text, marginBottom: 12 }}>
            <Icon name="clock" size={14} style={{ marginRight: 6, verticalAlign: -2, color: theme.accent }} />
            Execution History
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
                {['Run ID', 'Triggered', 'Window', 'Engine', 'Duration', 'Status'].map((h) => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: theme.textDim, fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {m.runs.slice().reverse().map((r) => (
                <tr key={r.id} style={{ borderBottom: `1px solid ${theme.border}08` }}>
                  <td style={{ padding: '8px 10px', color: theme.textDim, fontFamily: 'var(--font-mono)', fontSize: 11 }}>{r.id.slice(0, 8)}</td>
                  <td style={{ padding: '8px 10px', color: theme.textMuted }}>{r.triggered_at.slice(0, 16).replace('T', ' ')}</td>
                  <td style={{ padding: '8px 10px', color: theme.textMuted }}>{r.window_start} → {r.window_end}</td>
                  <td style={{ padding: '8px 10px' }}><Badge color={theme.blue}>{r.engine}</Badge></td>
                  <td style={{ padding: '8px 10px', color: theme.textMuted, fontVariantNumeric: 'tabular-nums' }}>{r.duration_seconds}s</td>
                  <td style={{ padding: '8px 10px' }}>
                    <Badge color={r.status === 'success' ? theme.green : theme.red}>{r.status}</Badge>
                    {r.error_message && <div style={{ fontSize: 10, color: theme.red, marginTop: 2 }}>{r.error_message}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* ════════════════════════ CONFIG TAB ════════════════════════ */}
      {tab === 'config' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <Card>
            <div style={{ fontSize: 14, fontWeight: 600, color: theme.text, marginBottom: 16 }}>Model Configuration</div>
            {[
              ['Model ID', m.id.slice(0, 12) + '…'],
              ['Name', m.model_name],
              ['Version', m.version],
              ['Type', m.type],
              ['Owner', m.owner],
              ['Team', m.team],
              ['Engine', m.engine],
              ['Created', m.created_at.slice(0, 10)],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${theme.border}08`, fontSize: 13 }}>
                <span style={{ color: theme.textDim }}>{k}</span>
                <span style={{ color: theme.text, fontWeight: 500 }}>{v}</span>
              </div>
            ))}
          </Card>
          <Card>
            <div style={{ fontSize: 14, fontWeight: 600, color: theme.text, marginBottom: 16 }}>Schedule & Monitoring</div>
            {[
              ['Schedule', m.schedule],
              ['Lookback Window', m.lookback_window],
              ['Comparison', m.comparison_strategy],
              ['Features', m.features.length + ' tracked'],
              ['PSI Threshold (warn)', '0.10'],
              ['PSI Threshold (crit)', '0.25'],
              ['Alert Channels', 'Slack, Email'],
              ['Cooldown', '6h'],
            ].map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${theme.border}08`, fontSize: 13 }}>
                <span style={{ color: theme.textDim }}>{k}</span>
                <span style={{ color: theme.text, fontWeight: 500 }}>{v}</span>
              </div>
            ))}
          </Card>
          <Card style={{ gridColumn: '1 / -1' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: theme.text, marginBottom: 12 }}>Column Mapping</div>
            <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 12 }}>
              <div><span style={{ color: theme.textDim }}>Features: </span><span style={{ color: theme.accent }}>{m.features.join(', ')}</span></div>
              <div><span style={{ color: theme.textDim }}>Prediction: </span><span style={{ color: theme.pink }}>prediction</span></div>
              <div><span style={{ color: theme.textDim }}>Target: </span><span style={{ color: theme.green }}>target</span></div>
              <div><span style={{ color: theme.textDim }}>Timestamp: </span><span style={{ color: theme.yellow }}>event_timestamp</span></div>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
