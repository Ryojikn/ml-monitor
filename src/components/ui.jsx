/* ═══════════════════════════════════════════
   UI Primitives
   ═══════════════════════════════════════════ */

import Icon from './Icon.jsx'
import { theme, statusColor, driftColor } from '../utils/theme.js'

/* ── Card ── */

export function Card({ children, style, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: theme.bgCard,
        border: `1px solid ${theme.border}`,
        borderRadius: 12,
        padding: 20,
        transition: 'all 0.2s',
        cursor: onClick ? 'pointer' : 'default',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

/* ── Badge ── */

export function Badge({ children, color = theme.accent, style }) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '3px 10px', borderRadius: 20,
        fontSize: 11, fontWeight: 600,
        background: color + '18', color,
        letterSpacing: 0.3,
        ...style,
      }}
    >
      {children}
    </span>
  )
}

/* ── Button ── */

export function Button({ children, variant = 'default', size = 'md', icon, onClick, style, disabled }) {
  const isP = variant === 'primary'
  const isG = variant === 'ghost'
  const sz =
    size === 'sm' ? { padding: '5px 12px', fontSize: 12 }
    : size === 'lg' ? { padding: '10px 24px', fontSize: 15 }
    : { padding: '7px 16px', fontSize: 13 }

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        background: isP ? theme.accent : isG ? 'transparent' : theme.bgInput,
        color: isP ? '#000' : theme.text,
        border: isG ? 'none' : `1px solid ${isP ? theme.accent : theme.border}`,
        borderRadius: 8,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'all 0.15s',
        opacity: disabled ? 0.5 : 1,
        fontFamily: 'inherit',
        ...sz,
        ...style,
      }}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 13 : 15} />}
      {children}
    </button>
  )
}

/* ── TabBar ── */

export function TabBar({ tabs, active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 2, background: theme.bgSurface, borderRadius: 10, padding: 3, marginBottom: 20 }}>
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          style={{
            flex: 1, padding: '8px 14px', borderRadius: 8, border: 'none',
            background: active === t.key ? theme.bgCard : 'transparent',
            color: active === t.key ? theme.text : theme.textMuted,
            fontWeight: active === t.key ? 600 : 400,
            fontSize: 13, cursor: 'pointer', transition: 'all 0.15s',
            fontFamily: 'inherit',
            boxShadow: active === t.key ? '0 1px 4px rgba(0,0,0,0.3)' : 'none',
          }}
        >
          {t.icon && <Icon name={t.icon} size={13} style={{ marginRight: 6, verticalAlign: -2 }} />}
          {t.label}
        </button>
      ))}
    </div>
  )
}

/* ── MetricCard ── */

export function MetricCard({ label, value, subtitle, color = theme.accent, icon, trend }) {
  return (
    <div
      style={{
        background: theme.bgCard,
        border: `1px solid ${theme.border}`,
        borderRadius: 12,
        padding: '16px 18px',
        flex: 1, minWidth: 160,
        position: 'relative', overflow: 'hidden',
      }}
    >
      <div style={{ position: 'absolute', top: -8, right: -8, width: 64, height: 64, borderRadius: '50%', background: color + '08' }} />
      <div style={{ fontSize: 11, color: theme.textMuted, fontWeight: 600, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8 }}>
        {icon && <Icon name={icon} size={12} style={{ marginRight: 5, verticalAlign: -1 }} />}
        {label}
      </div>
      <div style={{ fontSize: 26, fontWeight: 700, color, letterSpacing: -0.5, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {subtitle && <div style={{ fontSize: 11, color: theme.textDim, marginTop: 4 }}>{subtitle}</div>}
      {trend !== undefined && (
        <div style={{ fontSize: 11, color: trend > 0 ? theme.red : theme.green, marginTop: 4 }}>
          {trend > 0 ? '▲' : '▼'} {Math.abs(trend).toFixed(2)} vs prev
        </div>
      )}
    </div>
  )
}

/* ── Sparkline ── */

export function Sparkline({ data, color = theme.accent, width = 80, height = 24 }) {
  if (!data || data.length < 2) return null
  const vals = data.map((d) => d.value)
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const range = max - min || 1
  const pts = vals
    .map((v, i) => `${(i / (vals.length - 1)) * width},${height - ((v - min) / range) * height}`)
    .join(' ')
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/* ── SearchInput ── */

export function SearchInput({ value, onChange, placeholder }) {
  return (
    <div style={{ position: 'relative' }}>
      <Icon name="search" size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: theme.textDim }} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%', padding: '8px 12px 8px 32px',
          background: theme.bgInput,
          border: `1px solid ${theme.border}`, borderRadius: 8,
          color: theme.text, fontSize: 13,
          outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
        }}
      />
    </div>
  )
}

/* ── Select ── */

export function Select({ value, onChange, options, style }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        padding: '7px 28px 7px 10px',
        background: theme.bgInput,
        border: `1px solid ${theme.border}`, borderRadius: 8,
        color: theme.text, fontSize: 12,
        outline: 'none', fontFamily: 'inherit',
        appearance: 'none',
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")",
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 8px center',
        ...style,
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

/* ── StatusDot ── */

export function StatusDot({ status, size = 8 }) {
  const c = statusColor(status)
  return (
    <span
      style={{
        display: 'inline-block', width: size, height: size, borderRadius: '50%',
        background: c, boxShadow: `0 0 6px ${c}60`,
        marginRight: 6, verticalAlign: 1,
      }}
    />
  )
}

/* ── Recharts Custom Tooltip ── */

export function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div
      style={{
        background: '#1a2236ee',
        border: `1px solid ${theme.border}`,
        borderRadius: 8,
        padding: '8px 12px',
        fontSize: 12,
        backdropFilter: 'blur(8px)',
      }}
    >
      <div style={{ color: theme.textMuted, marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color, fontWeight: 600 }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toFixed(4) : p.value}
        </div>
      ))}
    </div>
  )
}
