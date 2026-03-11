/* ═══════════════════════════════════════════
   Synthetic Data Generation
   ═══════════════════════════════════════════
   Generates a realistic portfolio of ML models
   with drift timelines, feature-level drift,
   run history, and alerts.
*/

import { uuid, rng, pick, clamp, DAY_MS } from '../utils/helpers.js'
import {
  TEAMS, MODEL_TYPES, ENGINES, FEATURES_POOL,
  MODEL_NAMES, OWNERS,
} from '../utils/constants.js'

/* ── time-series helper ── */

function timeSeries(days, baseFn, noiseFn) {
  const now = Date.now()
  return Array.from({ length: days }, (_, i) => {
    const t = now - (days - 1 - i) * DAY_MS
    return {
      date: new Date(t).toISOString().slice(0, 10),
      ts: t,
      value: baseFn(i, days) + noiseFn(),
    }
  })
}

/* ── histogram bins for distribution comparison ── */

export function generateHistogramData(feature) {
  const bins = 15
  return Array.from({ length: bins }, (_, i) => {
    const base = Math.exp(-0.5 * ((i - bins / 2) / (bins / 4)) ** 2)
    const shift = feature.psi > 0.1 ? rng(0.5, 2) : 0
    return {
      bin: i,
      baseline: base * rng(80, 120),
      current:  base * rng(80, 120) * (1 + shift * (i > bins / 2 ? 0.3 : -0.1)),
    }
  })
}

/* ── single model generator ── */

function generateModel(idx) {
  const id      = uuid()
  const name    = MODEL_NAMES[idx % MODEL_NAMES.length]
  const version = `${Math.floor(rng(1, 5))}.${Math.floor(rng(0, 10))}.${Math.floor(rng(0, 20))}`
  const type    = pick(MODEL_TYPES)
  const team    = pick(TEAMS)
  const engine  = pick(ENGINES)
  const status  =
    Math.random() < 0.15 ? 'critical'
    : Math.random() < 0.30 ? 'warning'
    : Math.random() < 0.05 ? 'inactive'
    : 'healthy'

  const features   = FEATURES_POOL.slice(0, Math.floor(rng(6, 16))).sort(() => Math.random() - 0.5)
  const driftTrend = status === 'critical' ? 0.008 : status === 'warning' ? 0.003 : 0.0005

  /* ── timelines ── */

  const psiTimeline = timeSeries(
    30,
    (i) => 0.04 + driftTrend * i,
    () => rng(-0.02, 0.02),
  ).map((d) => ({ ...d, value: clamp(d.value, 0, 0.6) }))

  const performanceTimeline = timeSeries(
    30,
    (i) => (type === 'regression' ? 0.85 : 0.92) - driftTrend * 0.5 * i,
    () => rng(-0.015, 0.015),
  ).map((d) => ({ ...d, value: clamp(d.value, 0.5, 1) }))

  const predictionDrift = timeSeries(
    30,
    (i) => 0.03 + driftTrend * 0.7 * i,
    () => rng(-0.015, 0.015),
  ).map((d) => ({ ...d, value: clamp(d.value, 0, 0.5) }))

  /* ── feature-level drift ── */

  const featureDrift = features.map((f) => {
    const basePsi = status === 'critical' ? rng(0.15, 0.45) : status === 'warning' ? rng(0.08, 0.25) : rng(0.01, 0.12)
    return {
      feature: f,
      psi: basePsi,
      ks_stat: clamp(basePsi * rng(0.8, 2.5), 0, 1),
      jsd: clamp(basePsi * rng(0.3, 1.2), 0, 0.7),
      wasserstein: rng(0.01, 0.5),
      is_drifted: basePsi > 0.1,
      severity: basePsi > 0.25 ? 'critical' : basePsi > 0.1 ? 'warning' : 'stable',
      timeline: timeSeries(
        30,
        (i) => basePsi * 0.5 + (basePsi * 0.5 * i) / 30,
        () => rng(-0.02, 0.02),
      ).map((d) => ({ ...d, value: clamp(d.value, 0, 0.6) })),
    }
  })

  /* ── data quality ── */

  const dqMissing = features.map((f) => ({ feature: f, rate: rng(0, status === 'critical' ? 0.08 : 0.02) }))
  const dqOutlier = features.map((f) => ({ feature: f, rate: rng(0, 0.05) }))

  /* ── run history ── */

  const runs = Array.from({ length: 15 }, (_, i) => {
    const triggeredAt = new Date(Date.now() - (14 - i) * DAY_MS * 2)
    const dur = rng(30, 600)
    return {
      id: uuid(),
      model_id: id,
      triggered_at: triggeredAt.toISOString(),
      completed_at: new Date(triggeredAt.getTime() + dur * 1000).toISOString(),
      status: Math.random() < 0.9 ? 'success' : 'failed',
      engine,
      duration_seconds: Math.round(dur),
      window_start: new Date(triggeredAt.getTime() - 7 * DAY_MS).toISOString().slice(0, 10),
      window_end: triggeredAt.toISOString().slice(0, 10),
      error_message: Math.random() < 0.1 ? 'Timeout exceeded: connection to data source failed' : null,
    }
  })

  /* ── alerts ── */

  const alerts = []
  if (status === 'critical' || status === 'warning') {
    const n = status === 'critical' ? Math.floor(rng(3, 8)) : Math.floor(rng(1, 4))
    for (let i = 0; i < n; i++) {
      alerts.push({
        id: uuid(),
        model_id: id,
        run_id: runs[runs.length - 1 - i]?.id,
        severity: status === 'critical' ? pick(['CRITICAL', 'WARNING']) : 'WARNING',
        metric_name: pick(['PSI', 'KS', 'missing_rate', 'accuracy', 'f1_score']),
        metric_value: rng(0.1, 0.5),
        threshold: rng(0.08, 0.25),
        message: `Drift detected on ${pick(features)}`,
        status: i === 0 ? 'open' : pick(['open', 'acknowledged', 'resolved']),
        created_at: new Date(Date.now() - i * DAY_MS * rng(1, 3)).toISOString(),
        notified_channels: ['slack', 'email'],
      })
    }
  }

  /* ── assembled model ── */

  return {
    id, name: `${name} v${version}`, model_name: name, version, type, team, engine, status,
    owner: pick(OWNERS),
    tags: [type, team.toLowerCase().replace(/ /g, '-')],
    description: `Production ${type} model for ${name.toLowerCase()} pipeline`,
    created_at: new Date(Date.now() - rng(30, 365) * DAY_MS).toISOString(),
    updated_at: new Date(Date.now() - rng(0, 7) * DAY_MS).toISOString(),
    schedule: pick(['0 6 * * *', '0 */6 * * *', '0 0 * * 1']),
    lookback_window: pick(['7d', '14d', '30d']),
    comparison_strategy: pick(['baseline_vs_current', 'previous_vs_current', 'sliding_window']),
    features, featureDrift, psiTimeline, performanceTimeline, predictionDrift,
    dqMissing, dqOutlier, runs, alerts,
    globalPsi:  psiTimeline[psiTimeline.length - 1]?.value || 0,
    globalPerf: performanceTimeline[performanceTimeline.length - 1]?.value || 0,
    dqScore:    1 - dqMissing.reduce((s, d) => s + d.rate, 0) / dqMissing.length,
  }
}

/* ── public dataset ── */

export const MODELS     = Array.from({ length: 12 }, (_, i) => generateModel(i))
export const ALL_ALERTS = MODELS.flatMap((m) => m.alerts).sort(
  (a, b) => new Date(b.created_at) - new Date(a.created_at),
)
