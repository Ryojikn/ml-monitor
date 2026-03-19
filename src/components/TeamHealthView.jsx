/* ═══════════════════════════════════════════
   Team Maturity Dashboard
   ═══════════════════════════════════════════ */

import { useState, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import Icon from './Icon.jsx'
import { MetricCard, StatusDot } from './ui.jsx'
import { theme, severityColor } from '../utils/theme.js'

/* ── Metric classification ───────────────── */
const DRIFT_METRICS   = new Set(['psi','ks_stat','jsd','wasserstein','chi2_stat','prediction_psi'])
const PERF_METRICS    = new Set(['accuracy','f1_score','auc_roc','precision','recall','r2','mae','rmse'])
const QUALITY_METRICS = new Set(['missing_rate','outlier_rate'])

function classifyMetric(name) {
  if (DRIFT_METRICS.has(name))   return 'drift'
  if (PERF_METRICS.has(name))    return 'performance'
  if (QUALITY_METRICS.has(name)) return 'quality'
  return 'other'
}

const TYPE_COLOR = {
  drift:       theme.yellow,
  performance: theme.red,
  quality:     theme.purple,
  other:       theme.textDim,
}

/* ── Duration formatter ─────────────────── */
function fmtMs(ms) {
  if (ms == null || isNaN(ms) || ms <= 0) return null
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  if (h >= 48) return `${Math.round(h / 24)}d`
  if (h >= 1)  return `${h}h ${m}m`
  return `${m || '<1'}m`
}

/* ── Maturity score computation ──────────── */
function computeMaturity(teamModels, teamAlerts) {
  const now = Date.now()
  const DAY = 86_400_000

  // D1: Alert Resolution Rate (0-100) — are issues actually being closed?
  const totalAlerts    = teamAlerts.length
  const resolvedAlerts = teamAlerts.filter(a => a.status !== 'open').length
  const resolutionScore = totalAlerts > 0 ? (resolvedAlerts / totalAlerts) * 100 : 100

  // D2: Model Health Score (0-100) — what fraction of models are healthy?
  const total   = teamModels.length
  const healthy = teamModels.filter(m => m.status === 'healthy').length
  const warning = teamModels.filter(m => m.status === 'warning').length
  const healthScore = total > 0 ? ((healthy * 100 + warning * 50) / total) : 100

  // D3: Alert Velocity Trend (0-100) — is the alert rate improving over time?
  const recent = teamAlerts.filter(a => now - new Date(a.created_at).getTime() <  7 * DAY).length
  const prev   = teamAlerts.filter(a => {
    const age = now - new Date(a.created_at).getTime()
    return age >= 7 * DAY && age < 14 * DAY
  }).length
  let velocityScore = 70
  if (recent === 0 && prev === 0) velocityScore = 100
  else if (prev === 0 && recent > 0) velocityScore = 20
  else {
    const ratio = recent / Math.max(prev, 1)
    velocityScore = ratio <= 0.5 ? 100 : ratio <= 0.8 ? 80 : ratio <= 1.0 ? 60 : ratio <= 1.5 ? 30 : 10
  }

  // D4: Drift Stability (0-100) — how stable are PSI scores?
  const psiPoints = teamModels.flatMap(m => (m.psiTimeline ?? []).slice(-5))
  let driftScore = 100
  if (psiPoints.length > 0) {
    const avg = psiPoints.reduce((s, v) => s + v, 0) / psiPoints.length
    driftScore = avg < 0.1 ? 100 : avg < 0.15 ? 80 : avg < 0.2 ? 60 : avg < 0.3 ? 35 : 10
  }

  const score = Math.round(
    resolutionScore * 0.30 +
    healthScore     * 0.25 +
    velocityScore   * 0.25 +
    driftScore      * 0.20,
  )

  const trend = velocityScore >= 65 ? 'improving' : velocityScore <= 35 ? 'declining' : 'stable'
  const level = score >= 70 ? 'mature' : score >= 50 ? 'established' : score >= 30 ? 'developing' : 'emerging'

  return {
    score,
    level,
    trend,
    dimensions: {
      resolution: Math.round(resolutionScore),
      health:     Math.round(healthScore),
      velocity:   Math.round(velocityScore),
      drift:      Math.round(driftScore),
    },
  }
}

/* ── Alert activity: 6-week buckets ─────── */
function weeklyBuckets(alerts, weeks = 6) {
  const now = Date.now()
  const WEEK = 7 * 86_400_000
  return Array.from({ length: weeks }, (_, i) => {
    const start = now - (weeks - i) * WEEK
    const end   = start + WEEK
    return alerts.filter(a => {
      const t = new Date(a.created_at).getTime()
      return t >= start && t < end
    }).length
  })
}

/* ── TTA / TTR timings ───────────────────── */
function computeTimings(teamAlerts) {
  const ttaDeltas = teamAlerts
    .filter(a => a.acknowledged_at)
    .map(a => new Date(a.acknowledged_at) - new Date(a.created_at))
    .filter(d => d > 0)
  const ttrDeltas = teamAlerts
    .filter(a => a.resolved_at)
    .map(a => new Date(a.resolved_at) - new Date(a.created_at))
    .filter(d => d > 0)
  const avg = arr => arr.length ? arr.reduce((s, d) => s + d, 0) / arr.length : null
  return { ttaDeltas, ttrDeltas, tta: fmtMs(avg(ttaDeltas)), ttr: fmtMs(avg(ttrDeltas)) }
}

/* ── Per-team aggregation ────────────────── */
function buildTeamData(team, models, alerts) {
  const teamModels = models.filter(m => m.team === team.name)
  const teamAlerts = alerts.filter(a => {
    const m = models.find(x => x.id === a.model_id)
    return m?.team === team.name
  })
  const openAlerts = teamAlerts.filter(a => a.status === 'open')

  const metricCount = {}
  openAlerts.forEach(a => { metricCount[a.metric_name] = (metricCount[a.metric_name] || 0) + 1 })
  const recurringIssues = Object.entries(metricCount)
    .filter(([, c]) => c > 1)
    .map(([metric, count]) => ({ metric, count, type: classifyMetric(metric) }))
    .sort((a, b) => b.count - a.count)

  return {
    ...team,
    teamModels,
    teamAlerts,
    openAlerts,
    recurringIssues,
    alertWeekly: weeklyBuckets(teamAlerts),
    maturity:    computeMaturity(teamModels, teamAlerts),
    ...computeTimings(teamAlerts),
  }
}

/* ── Cross-team systemic risks ───────────── */
function buildCrossTeamIssues(models, alerts) {
  const openAlerts = alerts.filter(a => a.status === 'open')
  const metricTeams = {}
  openAlerts.forEach(a => {
    const model = models.find(m => m.id === a.model_id)
    if (!model) return
    if (!metricTeams[a.metric_name]) {
      metricTeams[a.metric_name] = { teams: new Set(), alerts: [], type: classifyMetric(a.metric_name) }
    }
    metricTeams[a.metric_name].teams.add(model.team)
    metricTeams[a.metric_name].alerts.push({ ...a, teamName: model.team, modelName: model.name })
  })
  return Object.entries(metricTeams)
    .filter(([, v]) => v.teams.size >= 2)
    .map(([metric, v]) => ({ metric, teams: [...v.teams], alerts: v.alerts, type: v.type }))
    .sort((a, b) => b.teams.length - a.teams.length)
}

/* ── Level / trend config ────────────────── */
const LEVEL_CONFIG = {
  emerging:    { color: '#ef4444', label: 'Emerging',    desc: 'High alert backlog, low resolution'    },
  developing:  { color: '#f59e0b', label: 'Developing',  desc: 'Some issues, actively improving'      },
  established: { color: '#3b82f6', label: 'Established', desc: 'Stable operations, low drift'         },
  mature:      { color: '#10b981', label: 'Mature',      desc: 'Proactive, consistent, and resilient' },
}

const TREND_CONFIG = {
  improving: { color: '#10b981', icon: 'trending-up',   label: 'Improving' },
  stable:    { color: '#64748b', icon: 'minus',         label: 'Stable'    },
  declining: { color: '#ef4444', icon: 'trending-down', label: 'Declining' },
}

/* ── ScoreDial ───────────────────────────── */
function ScoreDial({ score, level }) {
  const cfg = LEVEL_CONFIG[level]
  const circumference = 2 * Math.PI * 28
  return (
    <div style={{ position: 'relative', width: 72, height: 72, flexShrink: 0 }}>
      <svg width={72} height={72} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={36} cy={36} r={28} fill="none" stroke={theme.border} strokeWidth={6} />
        <circle
          cx={36} cy={36} r={28} fill="none"
          stroke={cfg.color}
          strokeWidth={6}
          strokeDasharray={`${(score / 100) * circumference} ${circumference}`}
          strokeLinecap="round"
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        lineHeight: 1,
      }}>
        <span style={{ fontSize: 18, fontWeight: 800, color: cfg.color }}>{score}</span>
        <span style={{ fontSize: 9, color: theme.textDim, marginTop: 1 }}>/ 100</span>
      </div>
    </div>
  )
}

/* ── DimensionBar ────────────────────────── */
function DimBar({ label, value, color }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: theme.textMuted, marginBottom: 2 }}>
        <span>{label}</span>
        <span style={{ fontWeight: 600, color }}>{value}%</span>
      </div>
      <div style={{ height: 4, background: theme.bgInput, borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${value}%`, background: color, borderRadius: 2 }} />
      </div>
    </div>
  )
}

/* ── MiniBarChart (6-week alert trend) ───── */
function MiniBarChart({ data, color }) {
  const max = Math.max(...data, 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 28 }}>
      {data.map((v, i) => (
        <div
          key={i}
          title={`Week ${i + 1}: ${v} alerts`}
          style={{
            flex: 1, borderRadius: 2,
            height: `${Math.max(3, (v / max) * 28)}px`,
            background: v === 0 ? theme.border : color,
            opacity: 0.4 + (i / data.length) * 0.6,
          }}
        />
      ))}
    </div>
  )
}

/* ── Expanded team detail ────────────────── */
function TeamDetail({ td, onSelectModel }) {
  return (
    <div style={{
      marginTop: 18, paddingTop: 18,
      borderTop: `1px solid ${theme.border}40`,
      display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24,
    }}>
      {/* Models list */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: theme.textDim, textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 8 }}>
          Models ({td.teamModels.length})
        </div>
        {td.teamModels.length === 0
          ? <div style={{ fontSize: 12, color: theme.textDim }}>No models registered</div>
          : td.teamModels.map(m => (
              <div
                key={m.id}
                onClick={() => onSelectModel?.(m)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '6px 0', cursor: 'pointer',
                  borderBottom: `1px solid ${theme.border}20`,
                }}
                onMouseEnter={e => e.currentTarget.style.opacity = '0.7'}
                onMouseLeave={e => e.currentTarget.style.opacity = '1'}
              >
                <StatusDot status={m.status} />
                <span style={{ flex: 1, fontSize: 12, color: theme.text }}>{m.name}</span>
                <span style={{ fontSize: 11, color: theme.textDim, fontFamily: 'var(--font-mono)' }}>
                  PSI {m.globalPsi?.toFixed(3) ?? '—'}
                </span>
              </div>
            ))
        }
      </div>

      {/* Open issues */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 600, color: theme.textDim, textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 8 }}>
          Open Issues ({td.openAlerts.length})
        </div>
        {td.openAlerts.length === 0
          ? <div style={{ fontSize: 12, color: theme.green }}>No open alerts ✓</div>
          : td.openAlerts.slice(0, 7).map((a, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '5px 0', borderBottom: `1px solid ${theme.border}20`, fontSize: 12,
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                  background: severityColor(a.severity),
                }} />
                <span style={{ color: theme.textMuted, flex: 1 }}>{a.metric_name}</span>
                <span style={{ fontSize: 10, color: TYPE_COLOR[classifyMetric(a.metric_name)], fontWeight: 600 }}>
                  {classifyMetric(a.metric_name)}
                </span>
              </div>
            ))
        }
        {td.openAlerts.length > 7 && (
          <div style={{ fontSize: 11, color: theme.textDim, marginTop: 4 }}>+{td.openAlerts.length - 7} more</div>
        )}

        {/* Recurring issues callout */}
        {td.recurringIssues.length > 0 && (
          <div style={{
            marginTop: 12, padding: '8px 12px', borderRadius: 8,
            background: theme.yellow + '10', border: `1px solid ${theme.yellow}30`,
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: theme.yellow, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Recurring Issues
            </div>
            {td.recurringIssues.map((r, i) => (
              <div key={i} style={{ fontSize: 11, color: theme.textMuted, display: 'flex', gap: 6 }}>
                <span style={{ color: TYPE_COLOR[r.type] }}>{r.metric}</span>
                <span style={{ color: theme.textDim }}>×{r.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── TeamMaturityCard ─────────────────────── */
function TeamMaturityCard({ td, expanded, onToggle, onSelectModel }) {
  const { maturity } = td
  const levelCfg = LEVEL_CONFIG[maturity.level]
  const trendCfg = TREND_CONFIG[maturity.trend]

  return (
    <div
      style={{
        background: theme.bgCard,
        border: `1px solid ${expanded ? levelCfg.color + '50' : theme.border}`,
        borderRadius: 14,
        padding: '18px 20px',
        cursor: 'pointer',
        transition: 'border-color 0.2s',
      }}
      onClick={onToggle}
      onMouseEnter={e => { if (!expanded) e.currentTarget.style.borderColor = theme.borderLight }}
      onMouseLeave={e => { if (!expanded) e.currentTarget.style.borderColor = theme.border }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <ScoreDial score={maturity.score} level={maturity.level} />

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: theme.text }}>{td.name}</span>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 9px', borderRadius: 20,
              background: levelCfg.color + '20', color: levelCfg.color,
              textTransform: 'uppercase', letterSpacing: 0.5,
            }}>
              {levelCfg.label}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: trendCfg.color }}>
              <Icon name={trendCfg.icon} size={11} />
              {trendCfg.label}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 14, fontSize: 12, color: theme.textMuted, flexWrap: 'wrap' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Icon name="box" size={11} />{td.teamModels.length} models
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Icon name="users" size={11} />{td.member_count ?? 0} members
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: td.openAlerts.length > 0 ? theme.yellow : theme.green }}>
              <Icon name="bell" size={11} />{td.openAlerts.length} open alerts
            </span>
            {td.recurringIssues.length > 0 && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: theme.red }}>
                <Icon name="rotate-cw" size={11} />{td.recurringIssues.length} recurring
              </span>
            )}
            {td.tta && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: theme.yellow }}>
                <Icon name="clock" size={11} />TTA {td.tta}
              </span>
            )}
            {td.ttr && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: theme.green }}>
                <Icon name="check-circle" size={11} />TTR {td.ttr}
              </span>
            )}
          </div>
        </div>

        {/* Maturity dimension bars */}
        <div style={{ width: 170, flexShrink: 0 }}>
          <DimBar label="Resolution"      value={maturity.dimensions.resolution} color={theme.green}  />
          <DimBar label="Model Health"    value={maturity.dimensions.health}     color={theme.accent} />
          <DimBar label="Alert Trend"     value={maturity.dimensions.velocity}   color={theme.purple} />
          <DimBar label="Drift Stability" value={maturity.dimensions.drift}      color={theme.yellow} />
        </div>

        {/* 6-week alert activity */}
        <div style={{ width: 80, flexShrink: 0 }}>
          <div style={{ fontSize: 9, color: theme.textDim, marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            6-week activity
          </div>
          <MiniBarChart data={td.alertWeekly} color={levelCfg.color} />
        </div>

        <Icon
          name="chevron-down"
          size={14}
          style={{
            color: theme.textDim,
            transform: expanded ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.2s',
            flexShrink: 0,
          }}
        />
      </div>

      {expanded && (
        <div onClick={e => e.stopPropagation()}>
          <TeamDetail td={td} onSelectModel={onSelectModel} />
        </div>
      )}
    </div>
  )
}

/* ── Systemic Risks Panel ─────────────────── */
function SystemicRisksPanel({ crossTeam }) {
  if (crossTeam.length === 0) return null
  return (
    <div style={{
      background: theme.bgCard, border: `1px solid ${theme.red}30`,
      borderRadius: 14, padding: '16px 20px', marginBottom: 20,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Icon name="alert-triangle" size={14} style={{ color: theme.red }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: theme.text }}>Systemic Risks</span>
        <span style={{ fontSize: 11, color: theme.textDim }}>— same metric affecting multiple teams</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
        {crossTeam.map(item => (
          <div key={item.metric} style={{
            background: theme.bg, border: `1px solid ${theme.border}`,
            borderRadius: 10, padding: '10px 14px',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: TYPE_COLOR[item.type] }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: theme.text }}>{item.metric}</div>
              <div style={{ fontSize: 11, color: theme.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.teams.join(' · ')}
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: TYPE_COLOR[item.type] }}>{item.teams.length} teams</div>
              <div style={{ fontSize: 10, color: theme.textDim }}>{item.alerts.length} alerts</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Maturity legend ─────────────────────── */
function MaturityLegend() {
  return (
    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 20 }}>
      {Object.entries(LEVEL_CONFIG).map(([key, cfg]) => (
        <div key={key} style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: cfg.color, marginTop: 3, flexShrink: 0 }} />
          <div>
            <span style={{ fontSize: 12, fontWeight: 600, color: cfg.color }}>{cfg.label}</span>
            <span style={{ fontSize: 11, color: theme.textDim, marginLeft: 6 }}>{cfg.desc}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

/* ── Main component ──────────────────────── */
export default function TeamHealthView({ models = [], alerts = [], teams = [], loading, onSelectModel }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const scope = searchParams.get('scope') ?? 'all'
  const [expandedId, setExpandedId] = useState(null)

  // Include teams inferred from model data (orphans not yet in the teams API)
  const allTeams = useMemo(() => {
    const registered = new Set(teams.map(t => t.name))
    const orphans = [...new Set(models.map(m => m.team).filter(t => t && !registered.has(t)))]
      .map(name => ({ id: `orphan:${name}`, name, slug: name.toLowerCase().replace(/\s+/g, '-'), member_count: 0 }))
    return [...teams, ...orphans]
  }, [teams, models])

  const teamData = useMemo(
    () => allTeams.map(t => buildTeamData(t, models, alerts)),
    [allTeams, models, alerts],
  )

  const crossTeamIssues = useMemo(() => buildCrossTeamIssues(models, alerts), [models, alerts])

  const scopedData = useMemo(
    () => scope === 'all' ? teamData : teamData.filter(td => td.slug === scope),
    [teamData, scope],
  )

  const orgStats = useMemo(() => {
    if (!teamData.length) return null
    const avg = Math.round(teamData.reduce((s, t) => s + t.maturity.score, 0) / teamData.length)
    const allTta = teamData.flatMap(t => t.ttaDeltas ?? [])
    const allTtr = teamData.flatMap(t => t.ttrDeltas ?? [])
    const mean = arr => arr.length ? arr.reduce((s, d) => s + d, 0) / arr.length : null
    return {
      avg,
      improving: teamData.filter(t => t.maturity.trend === 'improving').length,
      atRisk:    teamData.filter(t => t.maturity.level === 'emerging').length,
      orgTta:    fmtMs(mean(allTta)),
      orgTtr:    fmtMs(mean(allTtr)),
    }
  }, [teamData])

  if (!loading && allTeams.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: 80, color: theme.textDim }}>
        <Icon name="users" size={32} style={{ opacity: 0.3, marginBottom: 16 }} />
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8, color: theme.text }}>No teams configured</div>
        <div style={{ fontSize: 13 }}>
          Create teams in{' '}
          <a href="/settings/users-teams" style={{ color: theme.accent }}>Settings → Users &amp; Teams</a>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: theme.text }}>Team Maturity</h1>
        <p style={{ fontSize: 13, color: theme.textMuted, margin: '4px 0 0' }}>
          Track how each team evolves in managing their ML models — resolution rates, drift stability, and alert velocity over time.
        </p>
      </div>

      {/* ── Org summary ── */}
      {orgStats && scope === 'all' && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
          <MetricCard label="Teams"      value={teamData.length}        icon="users"          color={theme.accent}  />
          <MetricCard label="Avg Score"  value={`${orgStats.avg}/100`}  icon="trending-up"    color={theme.purple}  />
          <MetricCard label="Improving"  value={orgStats.improving}     icon="trending-up"    color={theme.green}   />
          <MetricCard label="At Risk"    value={orgStats.atRisk}        icon="alert-triangle" color={theme.red}     />
          {orgStats.orgTta && <MetricCard label="Avg TTA" value={orgStats.orgTta} icon="clock"         color={theme.yellow} />}
          {orgStats.orgTtr && <MetricCard label="Avg TTR" value={orgStats.orgTtr} icon="check-circle"  color={theme.green}  />}
        </div>
      )}

      {/* ── Maturity legend ── */}
      {scope === 'all' && <MaturityLegend />}

      {/* ── Scope selector ── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
        {[{ slug: 'all', name: 'All Teams' }, ...allTeams].map(t => {
          const active = scope === t.slug
          return (
            <button
              key={t.slug}
              onClick={() => setSearchParams(t.slug === 'all' ? {} : { scope: t.slug })}
              style={{
                padding: '5px 14px', borderRadius: 20, cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 12, fontWeight: 500,
                background: active ? theme.accent + '20' : theme.bgCard,
                color:      active ? theme.accent : theme.textMuted,
                border:     active ? `1px solid ${theme.accent}40` : `1px solid ${theme.border}`,
                transition: 'all 0.15s',
              }}
            >
              {t.name}
            </button>
          )
        })}
      </div>

      {/* ── Systemic risks ── */}
      {scope === 'all' && <SystemicRisksPanel crossTeam={crossTeamIssues} />}

      {/* ── Team leaderboard (sorted best → worst) ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {scopedData
          .sort((a, b) => b.maturity.score - a.maturity.score)
          .map(td => (
            <TeamMaturityCard
              key={td.id}
              td={td}
              expanded={expandedId === td.id}
              onToggle={() => setExpandedId(expandedId === td.id ? null : td.id)}
              onSelectModel={onSelectModel}
            />
          ))
        }
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: 40, color: theme.textDim, fontSize: 13 }}>
          Loading team data…
        </div>
      )}
    </div>
  )
}
