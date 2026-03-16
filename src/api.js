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

  // ── API Keys ─────────────────────────────
  listApiKeys: () => request('/api-keys'),

  createApiKey: (body) =>
    request('/api-keys', { method: 'POST', body: JSON.stringify(body) }),

  revokeApiKey: (id) =>
    request(`/api-keys/${id}`, { method: 'DELETE' }),

  // ── Notifications ─────────────────────────
  listNotifications: () => request('/notifications'),

  createNotification: (body) =>
    request('/notifications', { method: 'POST', body: JSON.stringify(body) }),

  updateNotification: (id, body) =>
    request(`/notifications/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  deleteNotification: (id) =>
    request(`/notifications/${id}`, { method: 'DELETE' }),

  testNotification: (id) =>
    request(`/notifications/${id}/test`, { method: 'POST' }),

  // ── Teams ─────────────────────────────────
  listTeams: () => request('/teams'),

  createTeam: (body) =>
    request('/teams', { method: 'POST', body: JSON.stringify(body) }),

  updateTeam: (id, body) =>
    request(`/teams/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  deleteTeam: (id) =>
    request(`/teams/${id}`, { method: 'DELETE' }),

  getTeamWithMembers: (id) => request(`/teams/${id}`),

  listTeamMembers: (id) => request(`/teams/${id}/members`),

  addTeamMember: (id, body) =>
    request(`/teams/${id}/members`, { method: 'POST', body: JSON.stringify(body) }),

  updateTeamMember: (id, userId, body) =>
    request(`/teams/${id}/members/${userId}`, { method: 'PATCH', body: JSON.stringify(body) }),

  removeTeamMember: (id, userId) =>
    request(`/teams/${id}/members/${userId}`, { method: 'DELETE' }),

  syncTeam: (id, body) =>
    request(`/teams/${id}/sync`, { method: 'POST', body: JSON.stringify(body) }),

  // ── Users ─────────────────────────────────
  listUsers: () => request('/users'),

  createUser: (body) =>
    request('/users', { method: 'POST', body: JSON.stringify(body) }),

  updateUser: (id, body) =>
    request(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  deactivateUser: (id) =>
    request(`/users/${id}`, { method: 'DELETE' }),

  // ── Health ────────────────────────────────
  health: () => request('/health'),
}
