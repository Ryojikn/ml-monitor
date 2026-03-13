/* ═══════════════════════════════════════════
   API client — wraps all backend calls
   ═══════════════════════════════════════════ */

const BASE = import.meta.env.VITE_API_URL ?? ''

async function request(path, options = {}) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API ${res.status}: ${text}`)
  }
  if (res.status === 204) return null
  return res.json()
}

/**
 * Normalize API model response to the camelCase shape the frontend expects.
 * Matches the structure produced by generators.js so components need no changes.
 */
function normalizeModel(m) {
  if (!m) return m
  const predDrift = m.prediction_drift ?? m.predictionDrift ?? []
  return {
    ...m,
    globalPsi:          m.global_psi      ?? m.globalPsi      ?? 0,
    globalPerf:         m.global_perf     ?? m.globalPerf     ?? 0,
    dqScore:            m.dq_score        ?? m.dqScore        ?? 1,
    psiTimeline:        m.psi_timeline    ?? m.psiTimeline    ?? [],
    featureDrift:       m.feature_drift   ?? m.featureDrift   ?? [],
    performanceTimeline:m.performance_timeline ?? m.performanceTimeline ?? [],
    predictionDrift:    predDrift,
    // dqMissing/dqOutlier: API returns { feature, value }, frontend uses { feature, rate }
    dqMissing: (m.dq_missing ?? m.dqMissing ?? []).map((d) => ({
      feature: d.feature,
      rate: d.rate ?? d.value ?? 0,
    })),
    dqOutlier: (m.dq_outlier ?? m.dqOutlier ?? []).map((d) => ({
      feature: d.feature,
      rate: d.rate ?? d.value ?? 0,
    })),
    runs:     m.runs     ?? [],
    alerts:   m.alerts   ?? [],
    datasets: m.datasets ?? [],
    features: m.column_mapping?.features ?? m.features ?? [],
  }
}

export const api = {
  // ── Models ──────────────────────────────
  listModels: (params = {}) =>
    request(`/models?${new URLSearchParams(params)}`).then((r) => ({
      ...r,
      items: (r.items ?? []).map(normalizeModel),
    })),

  getModel: (id) => request(`/models/${id}`).then(normalizeModel),

  createModel: (body) =>
    request('/models', { method: 'POST', body: JSON.stringify(body) }).then(normalizeModel),

  updateModel: (id, body) =>
    request(`/models/${id}`, { method: 'PATCH', body: JSON.stringify(body) }).then(normalizeModel),

  deleteModel: (id) =>
    request(`/models/${id}`, { method: 'DELETE' }),

  // ── Datasets ─────────────────────────────
  uploadDataset: (modelId, file, role) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('role', role)
    return fetch(`${BASE}/api/v1/models/${modelId}/datasets`, {
      method: 'POST',
      body: fd,
    }).then((r) => {
      if (!r.ok) return r.text().then((t) => { throw new Error(t) })
      return r.json()
    })
  },

  listDatasets: (modelId) => request(`/models/${modelId}/datasets`),

  // ── Runs ─────────────────────────────────
  triggerRun: (modelId) =>
    request(`/models/${modelId}/runs`, { method: 'POST' }),

  listRuns: (modelId) => request(`/models/${modelId}/runs`),

  getRun: (modelId, runId) => request(`/models/${modelId}/runs/${runId}`),

  // ── Drift ─────────────────────────────────
  getDrift: (modelId, days = 30) =>
    request(`/models/${modelId}/drift?days=${days}`),

  getHistogram: (modelId, featureName) =>
    request(`/models/${modelId}/drift/features/${encodeURIComponent(featureName)}/histogram`),

  // ── Alerts ────────────────────────────────
  listAlerts: (params = {}) =>
    request(`/alerts?${new URLSearchParams(params)}`),

  updateAlert: (alertId, body) =>
    request(`/alerts/${alertId}`, { method: 'PATCH', body: JSON.stringify(body) }),

  // ── Storage Connections ───────────────────
  listConnections: () => request('/connections'),

  createConnection: (body) =>
    request('/connections', { method: 'POST', body: JSON.stringify(body) }),

  getConnection: (id) => request(`/connections/${id}`),

  updateConnection: (id, body) =>
    request(`/connections/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  deleteConnection: (id) =>
    request(`/connections/${id}`, { method: 'DELETE' }),

  testConnection: (id) =>
    request(`/connections/${id}/test`, { method: 'POST' }),

  browseConnection: (id, path = '') =>
    request(`/connections/${id}/browse?path=${encodeURIComponent(path)}`),

  getConnectionColumns: (id, path = '') =>
    request(`/connections/${id}/columns?path=${encodeURIComponent(path)}`),

  // ── Health ────────────────────────────────
  health: () => request('/health'),
}
