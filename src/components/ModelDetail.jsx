/* ═══════════════════════════════════════════
   Model Detail — tabbed deep-dive
   ═══════════════════════════════════════════ */

import { useState, useMemo, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
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
import { toast } from 'sonner'

/* ── Histogram shift analyser ── */
function analyzeHistogramShift(baseline, current) {
  const bins = baseline?.bins ?? []
  const bCounts = baseline?.counts ?? []
  const cCounts = current?.counts ?? []
  if (!bins.length) return null

  const isNumeric = bins.every((b) => /^-?[\d.]+/.test(String(b)))
  if (isNumeric) {
    const midpoints = bins.map((b) => {
      const parts = String(b).split(/[–—\-–]/).filter(Boolean)
      if (parts.length < 2) return parseFloat(parts[0]) || 0
      return (parseFloat(parts[0]) + parseFloat(parts[parts.length - 1])) / 2
    })
    const bTotal = bCounts.reduce((s, c) => s + c, 0) || 1
    const cTotal = cCounts.reduce((s, c) => s + c, 0) || 1
    const wMean = (counts, total) => midpoints.reduce((s, m, i) => s + m * (counts[i] || 0) / total, 0)
    const wStd  = (counts, total, mean) => Math.sqrt(midpoints.reduce((s, m, i) => s + ((m - mean) ** 2) * (counts[i] || 0) / total, 0))
    const bMean = wMean(bCounts, bTotal); const cMean = wMean(cCounts, cTotal)
    const bStd  = wStd(bCounts, bTotal, bMean); const cStd  = wStd(cCounts, cTotal, cMean)
    const pctChg = bMean !== 0 ? ((cMean - bMean) / Math.abs(bMean)) * 100 : 0
    const arrow = cMean >= bMean ? '↑' : '↓'
    const spreadNote = cStd > bStd * 1.1
      ? ` Spread widened (σ: ${fmt(bStd, 2)} → ${fmt(cStd, 2)}).`
      : cStd < bStd * 0.9 ? ` Spread narrowed (σ: ${fmt(bStd, 2)} → ${fmt(cStd, 2)}).` : ''
    return `Mean shifted from ${fmt(bMean, 2)} → ${fmt(cMean, 2)} (${arrow} ${Math.abs(pctChg).toFixed(1)}%).${spreadNote}`
  }

  const bTotal = bCounts.reduce((s, c) => s + c, 0) || 1
  const cTotal = cCounts.reduce((s, c) => s + c, 0) || 1
  const diffs = bins.map((b, i) => ({
    bin: b,
    delta: ((cCounts[i] || 0) / cTotal) - ((bCounts[i] || 0) / bTotal),
  })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
  const top = diffs.slice(0, 2).map((d) => `'${d.bin}' ${d.delta > 0 ? '+' : ''}${(d.delta * 100).toFixed(1)} pp`)
  return top.length ? `Category ${top.join('. Category ')}.` : null
}

/* ── Feature drift insight generator ── */
function generateFeatureDriftInsight(fd, warnThreshold = 0.10, critThreshold = 0.25) {
  const psi = fd.psi ?? 0
  const isCrit = fd.severity === 'critical'
  const ratio = critThreshold > 0 ? (psi / critThreshold).toFixed(1) : '?'
  const headline = isCrit
    ? `Critical drift detected in ${fd.feature}`
    : `Moderate drift detected in ${fd.feature}`

  let why = isCrit
    ? `PSI of ${fmt(psi)} is ${ratio}× above the critical threshold (${critThreshold}). A PSI > ${critThreshold} signals the current population is fundamentally different from training data — the model is likely operating outside its learned distribution.`
    : `PSI of ${fmt(psi)} exceeds the warning threshold (${warnThreshold}), indicating moderate distributional shift. PSI between ${warnThreshold}–${critThreshold} warrants close monitoring as performance may begin to degrade.`
  if (fd.ks_stat > 0.15) why += ` KS statistic of ${fmt(fd.ks_stat)} (p=${fmt(fd.ks_pvalue, 3)}) independently confirms the shift.`
  if (fd.jsd > 0.1) why += ` JSD of ${fmt(fd.jsd)} indicates non-trivial divergence in distribution shape.`

  const shift = analyzeHistogramShift(fd.baseline_histogram, fd.current_histogram)
  const actions = isCrit ? [
    'Retrain the model on data from the current period — the training distribution no longer matches production.',
    'Audit the upstream data pipeline: schema changes, data source switches, or collection gaps often cause sudden shifts.',
    'If the shift is intentional (seasonal cohort, market change), update the baseline dataset to the new reference period.',
    'Increase monitoring frequency temporarily (e.g. daily) to catch further acceleration.',
    'If performance metrics (AUC/R²) are also declining, escalate model refresh to highest priority.',
  ] : [
    'Monitor for 2–3 consecutive windows — gradual drift often stabilises without intervention.',
    'Cross-reference with performance metrics: early drift typically precedes AUC/R² degradation by 1–2 cycles.',
    'Review recent engineering changes: feature normalisation, upstream joins, or sampling logic may have shifted.',
    'If drift accelerates or performance drops, initiate a targeted retraining with a sliding window dataset.',
  ]
  return { headline, why, shift, actions, severity: fd.severity }
}

/* ── Performance insight generator ── */
function generatePerformanceInsight(timeline, modelType, threshold = 0.8) {
  const vals = (timeline ?? []).map((t) => t.value).filter((v) => v != null)
  if (!vals.length) return null
  const latest = vals[vals.length - 1]
  const prev3 = vals.slice(-4, -1)
  const avg3 = prev3.length ? prev3.reduce((s, v) => s + v, 0) / prev3.length : latest
  const declining = latest < avg3 * 0.99
  if (latest >= threshold && !declining) return null
  const metricName = modelType === 'regression' ? 'R²' : 'AUC-ROC'
  const drop = avg3 > 0 ? ((avg3 - latest) / avg3 * 100).toFixed(1) : '0'
  const headline = latest < threshold ? `${metricName} below performance threshold` : `${metricName} declining trend detected`
  const why = latest < threshold
    ? `Current ${metricName} of ${fmt(latest, 3)} is below the ${threshold} reference line${declining ? `, and has dropped ${drop}% over the last 3 periods` : ''}. ${modelType === 'regression' ? 'An R² < 0.8 indicates the model explains less than 80% of target variance.' : 'An AUC-ROC < 0.8 means the model has limited discriminative power — it performs only moderately better than random.'}`
    : `${metricName} has declined ${drop}% over the last 3 periods (${fmt(avg3, 3)} → ${fmt(latest, 3)}), approaching the ${threshold} threshold.`
  const actions = [
    'Check the Drift Analysis tab — performance degradation almost always follows distributional shift. Identify which features shifted.',
    'Retrain the model using a recent data window that better represents the current population.',
    'Review the target/label distribution: if labels have shifted (concept drift), retraining is mandatory.',
    `If ${metricName} has been declining gradually, consider a sliding-window retrain schedule rather than a full re-fit.`,
    'Evaluate whether feature engineering or feature selection needs updating for the current data regime.',
  ]
  return { headline, why, shift: null, actions, severity: latest < threshold ? 'critical' : 'warning' }
}

/* ── Data quality insight generator ── */
function generateQualityInsight(feature, missingRate, outlierRate) {
  const isMissingHigh = missingRate > 0.05
  const isOutlierHigh = outlierRate > 0.03
  if (!isMissingHigh && !isOutlierHigh) return null
  const headline = isMissingHigh && isOutlierHigh
    ? `Data quality issues in ${feature}`
    : isMissingHigh ? `High missing rate in ${feature}` : `High outlier rate in ${feature}`
  const parts = []
  if (isMissingHigh) parts.push(`${feature} has a ${fmtPct(missingRate)} missing rate, exceeding the 5% threshold where imputation artifacts commonly bias predictions.`)
  if (isOutlierHigh) parts.push(`${feature} has a ${fmtPct(outlierRate)} outlier rate (IQR method). Extreme values distort tree-split decisions and distance-based models.`)
  const why = parts.join(' ')
  const actions = []
  if (isMissingHigh) {
    actions.push('Check upstream ETL for this column — missing values often indicate a pipeline regression or schema change.')
    actions.push('Consider mean/median imputation, forward-fill if time-series, or excluding the feature if missingness is systematic.')
    if (missingRate > 0.2) actions.push(`At ${fmtPct(missingRate)} missing, the feature may be unreliable — evaluate removing it from the model entirely.`)
  }
  if (isOutlierHigh) {
    actions.push('Inspect for sensor noise or data entry errors in the source system.')
    actions.push('Consider winsorising at the 1st/99th percentile to clip extreme values without removing records.')
  }
  return { headline, why, shift: null, actions, severity: (missingRate > 0.15 || outlierRate > 0.1) ? 'critical' : 'warning' }
}

/* ── InsightPopover ── */
function InsightPopover({ headline, why, shift, actions, severity }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])
  const color = severity === 'critical' ? theme.red : severity === 'warning' ? theme.yellow : theme.textDim
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex', verticalAlign: 'middle' }}>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color, padding: '0 4px', lineHeight: 1, display: 'inline-flex', alignItems: 'center' }}
        title="View insight"
      >
        <Icon name="info" size={13} />
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'absolute', zIndex: 400, top: 22, left: 0,
            width: 360, background: theme.bgCard, border: `1px solid ${color}50`,
            borderRadius: 12, padding: 16, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color, flex: 1, paddingRight: 8, lineHeight: 1.4 }}>{headline}</div>
            <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.textMuted, padding: 0, flexShrink: 0 }}>
              <Icon name="x" size={12} />
            </button>
          </div>
          <div style={{ fontSize: 12, color: theme.textMuted, lineHeight: 1.6, marginBottom: (shift || actions?.length) ? 10 : 0 }}>{why}</div>
          {shift && (
            <div style={{ background: theme.bg + '80', borderRadius: 8, padding: '8px 10px', marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: theme.textDim, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Distribution Shift</div>
              <div style={{ fontSize: 12, color: theme.text }}>{shift}</div>
            </div>
          )}
          {actions?.length > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: theme.textDim, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Recommended Actions</div>
              <ol style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: theme.textMuted, lineHeight: 1.6 }}>
                {actions.map((a, i) => <li key={i} style={{ marginBottom: 4 }}>{a}</li>)}
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

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
  const { tab: urlTab } = useParams()
  const navigate = useNavigate()
  const [tab, setTab] = useState(urlTab || 'drift')

  // Sync tab with URL when navigating via browser back/forward
  useEffect(() => { setTab(urlTab || 'drift') }, [urlTab])

  const handleTabChange = (newTab) => {
    setTab(newTab)
    navigate(`/models/${m.id}/${newTab}`, { replace: true })
  }
  const [selectedFeature, setFeature]   = useState(null)
  const [histData, setHistData]         = useState(null)
  const [runPending, setRunPending]     = useState(false)
  const [showEdit, setShowEdit]         = useState(false)
  const [editForm, setEditForm]         = useState({})
  const [showDelete, setShowDelete]     = useState(false)
  const [saving, setSaving]             = useState(false)
  const [saveError, setSaveError]       = useState(null)
  const eu = (k, v) => setEditForm((p) => ({ ...p, [k]: v }))

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

  const openEdit = () => {
    setSaveError(null)
    setEditForm({
      name: m.name ?? '',
      version: m.version ?? '',
      owner: m.owner ?? '',
      team: m.team ?? '',
      description: m.description ?? '',
      engine: m.engine ?? 'local',
      schedule: m.schedule ?? '0 6 * * *',
      lookback_window: m.lookback_window ?? '7d',
      psi_warn_threshold: String(m.psi_warn_threshold ?? 0.10),
      psi_crit_threshold: String(m.psi_crit_threshold ?? 0.25),
      alert_channels: m.alert_channels?.[0] ?? 'slack',
    })
    setShowEdit(true)
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      await api.updateModel(m.id, {
        name: editForm.name,
        version: editForm.version,
        owner: editForm.owner,
        team: editForm.team,
        description: editForm.description || null,
        engine: editForm.engine,
        schedule: editForm.schedule,
        lookback_window: editForm.lookback_window,
        psi_warn_threshold: parseFloat(editForm.psi_warn_threshold) || 0.10,
        psi_crit_threshold: parseFloat(editForm.psi_crit_threshold) || 0.25,
        alert_channels: editForm.alert_channels ? [editForm.alert_channels] : [],
      })
      setShowEdit(false)
      if (onRefresh) onRefresh(m.id)
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    try {
      await api.deleteModel(m.id)
      toast.success(`"${m.name}" deleted`, { duration: 1000 })
      onBack()
    } catch {
      setShowDelete(false)
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
        <Button icon="settings" size="sm" variant="ghost" onClick={openEdit}>Edit</Button>
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

      <TabBar tabs={TABS} active={tab} onChange={handleTabChange} />

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
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Badge color={driftColor(fd.psi)} style={{ textTransform: 'capitalize' }}>{fd.severity}</Badge>
                            {fd.severity !== 'stable' && (
                              <InsightPopover {...generateFeatureDriftInsight(fd, m.psi_warn_threshold, m.psi_crit_threshold)} />
                            )}
                          </span>
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
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <Badge color={driftColor(fd.psi)}>{fd.severity}</Badge>
                      {fd.severity !== 'stable' && (
                        <InsightPopover {...generateFeatureDriftInsight(fd, m.psi_warn_threshold, m.psi_crit_threshold)} />
                      )}
                    </span>
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
            <div style={{ fontSize: 14, fontWeight: 600, color: theme.text, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="activity" size={14} style={{ color: theme.green }} />
              <span>{m.type === 'regression' ? 'R² Score' : 'AUC-ROC'} Over Time</span>
              {(() => { const pi = generatePerformanceInsight(m.performanceTimeline, m.type, 0.8); return pi ? <InsightPopover {...pi} /> : null })()}
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
                      <td style={{ padding: '8px 10px' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Badge color={ok ? theme.green : theme.yellow}>{ok ? 'OK' : 'Check'}</Badge>
                          {!ok && (() => { const qi = generateQualityInsight(f, miss, out); return qi ? <InsightPopover {...qi} /> : null })()}
                        </span>
                      </td>
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
              ['Schedule', m.schedule || '—'],
              ['Lookback Window', m.lookback_window || '—'],
              ['Comparison', m.comparison_strategy || '—'],
              ['Features', m.features.length + ' tracked'],
              ['PSI Threshold (warn)', m.psi_warn_threshold ?? 0.10],
              ['PSI Threshold (crit)', m.psi_crit_threshold ?? 0.25],
              ['Alert Channels', (m.alert_channels ?? []).join(', ') || '—'],
              ['Cooldown', (m.alert_cooldown_hours ?? 6) + 'h'],
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
              <div><span style={{ color: theme.textDim }}>Features: </span><span style={{ color: theme.accent }}>{m.features.join(', ') || '—'}</span></div>
              <div><span style={{ color: theme.textDim }}>Prediction: </span><span style={{ color: theme.pink }}>{m.column_mapping?.prediction_col || '—'}</span></div>
              <div><span style={{ color: theme.textDim }}>Target: </span><span style={{ color: theme.green }}>{m.column_mapping?.target_col || '—'}</span></div>
              <div><span style={{ color: theme.textDim }}>Score: </span><span style={{ color: theme.purple }}>{m.column_mapping?.score_col || '—'}</span></div>
              <div><span style={{ color: theme.textDim }}>Timestamp: </span><span style={{ color: theme.yellow }}>{m.column_mapping?.timestamp_col || '—'}</span></div>
            </div>
          </Card>
        </div>
      )}

      {/* ════════════════════════ EDIT MODAL ════════════════════════ */}
      {showEdit && (
        <div
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={(e) => e.target === e.currentTarget && setShowEdit(false)}
        >
          <div style={{
            background: theme.bgCard, border: `1px solid ${theme.border}`,
            borderRadius: 16, width: '90%', maxWidth: 560, maxHeight: '90vh',
            overflow: 'auto',
          }}>
            {/* Header */}
            <div style={{ padding: '16px 24px', borderBottom: `1px solid ${theme.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="settings" size={14} style={{ color: theme.accent }} />
              <span style={{ fontWeight: 600, fontSize: 15, flex: 1 }}>Edit Model Configuration</span>
              <button onClick={() => setShowEdit(false)} style={{ background: 'none', border: 'none', color: theme.textMuted, cursor: 'pointer' }}>
                <Icon name="x" size={16} />
              </button>
            </div>

            {/* Body */}
            <div style={{ padding: 24 }}>
              {/* Name + Version */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: theme.textMuted, marginBottom: 5, fontWeight: 600 }}>Name</label>
                  <input value={editForm.name} onChange={(e) => eu('name', e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', background: theme.bgInput, border: `1px solid ${theme.border}`, borderRadius: 8, color: theme.text, fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: theme.textMuted, marginBottom: 5, fontWeight: 600 }}>Version</label>
                  <input value={editForm.version} onChange={(e) => eu('version', e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', background: theme.bgInput, border: `1px solid ${theme.border}`, borderRadius: 8, color: theme.text, fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                </div>
              </div>

              {/* Owner + Team */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: theme.textMuted, marginBottom: 5, fontWeight: 600 }}>Owner</label>
                  <input value={editForm.owner} onChange={(e) => eu('owner', e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', background: theme.bgInput, border: `1px solid ${theme.border}`, borderRadius: 8, color: theme.text, fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: theme.textMuted, marginBottom: 5, fontWeight: 600 }}>Team</label>
                  <input value={editForm.team} onChange={(e) => eu('team', e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', background: theme.bgInput, border: `1px solid ${theme.border}`, borderRadius: 8, color: theme.text, fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                </div>
              </div>

              {/* Description */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, color: theme.textMuted, marginBottom: 5, fontWeight: 600 }}>Description</label>
                <input value={editForm.description} onChange={(e) => eu('description', e.target.value)}
                  placeholder="Optional description"
                  style={{ width: '100%', padding: '8px 12px', background: theme.bgInput, border: `1px solid ${theme.border}`, borderRadius: 8, color: theme.text, fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
              </div>

              {/* Engine */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, color: theme.textMuted, marginBottom: 5, fontWeight: 600 }}>Execution Engine</label>
                <Select value={editForm.engine} onChange={(v) => eu('engine', v)} style={{ width: '100%' }}
                  options={ENGINES.map((e) => ({ value: e, label: e }))} />
              </div>

              {/* Schedule */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, color: theme.textMuted, marginBottom: 5, fontWeight: 600 }}>Schedule (cron expression)</label>
                <input value={editForm.schedule} onChange={(e) => eu('schedule', e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', background: theme.bgInput, border: `1px solid ${theme.border}`, borderRadius: 8, color: theme.text, fontSize: 13, outline: 'none', boxSizing: 'border-box', fontFamily: 'var(--font-mono)' }} />
                <div style={{ fontSize: 11, color: theme.textDim, marginTop: 4 }}>
                  Examples: <code style={{ color: theme.accent }}>0 6 * * *</code> (daily 06:00) · <code style={{ color: theme.accent }}>0 * * * *</code> (hourly) · <code style={{ color: theme.accent }}>0 9 * * 1</code> (Mon 09:00)
                </div>
              </div>

              {/* Lookback Window */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, color: theme.textMuted, marginBottom: 5, fontWeight: 600 }}>Lookback Window</label>
                <Select value={editForm.lookback_window} onChange={(v) => eu('lookback_window', v)} style={{ width: '100%' }}
                  options={[{ value: '1d', label: '1 Day' }, { value: '7d', label: '7 Days' }, { value: '14d', label: '14 Days' }, { value: '30d', label: '30 Days' }]} />
              </div>

              {/* PSI Thresholds */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: theme.textMuted, marginBottom: 5, fontWeight: 600 }}>PSI Warning Threshold</label>
                  <input value={editForm.psi_warn_threshold} onChange={(e) => eu('psi_warn_threshold', e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', background: theme.bgInput, border: `1px solid ${theme.border}`, borderRadius: 8, color: theme.text, fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 12, color: theme.textMuted, marginBottom: 5, fontWeight: 600 }}>PSI Critical Threshold</label>
                  <input value={editForm.psi_crit_threshold} onChange={(e) => eu('psi_crit_threshold', e.target.value)}
                    style={{ width: '100%', padding: '8px 12px', background: theme.bgInput, border: `1px solid ${theme.border}`, borderRadius: 8, color: theme.text, fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
                </div>
              </div>

              {/* Alert Channels */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ display: 'block', fontSize: 12, color: theme.textMuted, marginBottom: 5, fontWeight: 600 }}>Alert Channel</label>
                <Select value={editForm.alert_channels} onChange={(v) => eu('alert_channels', v)} style={{ width: '100%' }}
                  options={[
                    { value: 'slack', label: 'Slack' },
                    { value: 'email', label: 'Email' },
                    { value: 'pagerduty', label: 'PagerDuty' },
                    { value: 'webhook', label: 'Webhook' },
                  ]} />
              </div>

              {saveError && (
                <div style={{ padding: '8px 12px', borderRadius: 8, background: theme.red + '18', border: `1px solid ${theme.red}40`, color: theme.red, fontSize: 12, marginBottom: 14 }}>
                  {saveError}
                </div>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '12px 24px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: `1px solid ${theme.border}` }}>
              <Button
                icon="trash" variant="ghost"
                style={{ color: theme.red }}
                onClick={() => { setShowEdit(false); setShowDelete(true) }}
                disabled={saving}
              >
                Delete Model
              </Button>
              <div style={{ display: 'flex', gap: 10 }}>
                <Button variant="ghost" onClick={() => setShowEdit(false)} disabled={saving}>Cancel</Button>
                <Button variant="primary" onClick={handleSave} disabled={saving} icon="check">
                  {saving ? 'Saving…' : 'Save Changes'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════ DELETE MODAL ════════════════════════ */}
      {showDelete && (
        <div
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={(e) => e.target === e.currentTarget && setShowDelete(false)}
        >
          <div style={{
            background: theme.bgCard, border: `1px solid ${theme.red}40`,
            borderRadius: 16, width: '90%', maxWidth: 420, padding: 28,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: theme.red + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name="trash" size={16} style={{ color: theme.red }} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, color: theme.text }}>Delete Model</div>
                <div style={{ fontSize: 12, color: theme.textDim, marginTop: 2 }}>This action cannot be undone</div>
              </div>
            </div>
            <p style={{ fontSize: 13, color: theme.textDim, marginBottom: 24, lineHeight: 1.6 }}>
              Are you sure you want to delete <strong style={{ color: theme.text }}>"{m.name}"</strong>?
              All runs, drift results, performance history, and alerts will be permanently deleted.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <Button variant="ghost" onClick={() => setShowDelete(false)}>Cancel</Button>
              <Button
                icon="trash"
                onClick={handleDelete}
                style={{ background: theme.red, color: '#fff', border: 'none' }}
              >
                Delete Model
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
