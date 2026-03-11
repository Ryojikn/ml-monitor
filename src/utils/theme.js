/* ═══════════════════════════════════════════
   Design Tokens
   ═══════════════════════════════════════════ */

export const theme = {
  bg:          '#0a0e17',
  bgCard:      '#111827',
  bgCardHover: '#1a2236',
  bgSurface:   '#0f1525',
  bgInput:     '#1a2236',
  border:      '#1e293b',
  borderLight: '#293548',
  text:        '#e2e8f0',
  textMuted:   '#94a3b8',
  textDim:     '#64748b',
  accent:      '#06b6d4',
  accentDim:   '#0891b2',
  green:       '#10b981',
  greenDim:    '#059669',
  yellow:      '#f59e0b',
  yellowDim:   '#d97706',
  red:         '#ef4444',
  redDim:      '#dc2626',
  purple:      '#a78bfa',
  blue:        '#3b82f6',
  pink:        '#ec4899',
}

/* ── Semantic lookups ── */

export const statusColor = (s) =>
  ({ healthy: theme.green, warning: theme.yellow, critical: theme.red, inactive: theme.textDim }[s] || theme.textDim)

export const severityColor = (s) =>
  ({ INFO: theme.accent, WARNING: theme.yellow, CRITICAL: theme.red }[s] || theme.textDim)

export const driftColor = (v) =>
  v > 0.25 ? theme.red : v > 0.1 ? theme.yellow : theme.green
