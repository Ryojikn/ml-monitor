/* ═══════════════════════════════════════════
   Model Onboarding Wizard — 7 steps
   ═══════════════════════════════════════════ */

import { useState, useEffect } from 'react'
import Icon from './Icon.jsx'
import { Button, Badge, Select } from './ui.jsx'
import { theme } from '../utils/theme.js'
import { MODEL_TYPES, TEAMS, ENGINES, SOURCE_TYPES } from '../utils/constants.js'
import { api } from '../api.js'

const STEPS = [
  { n: 1, title: 'Basic Info',       icon: 'box' },
  { n: 2, title: 'Reference Data',   icon: 'database' },
  { n: 3, title: 'Production Data',  icon: 'layers' },
  { n: 4, title: 'Column Mapping',   icon: 'hash' },
  { n: 5, title: 'Schedule',         icon: 'clock' },
  { n: 6, title: 'Alerts',           icon: 'bell' },
  { n: 7, title: 'Review',           icon: 'check' },
]

const STEP_DESCRIPTIONS = [
  'Provide basic model identification information.',
  'Configure the reference (baseline/training) dataset connection.',
  'Configure the production (serving) dataset connection.',
  'Map feature, prediction, target, and segment columns.',
  'Set up execution schedule and compute engine.',
  'Define alert thresholds and notification channels.',
  'Review your configuration before saving.',
]

/* ── tiny form helpers ── */

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 12, color: theme.textMuted, marginBottom: 5, fontWeight: 600 }}>{label}</label>
      {children}
    </div>
  )
}

function Input({ value, onChange, placeholder, mono }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        width: '100%', padding: '8px 12px',
        background: theme.bgInput,
        border: `1px solid ${theme.border}`, borderRadius: 8,
        color: theme.text, fontSize: 13,
        outline: 'none',
        fontFamily: mono ? 'var(--font-mono)' : 'inherit',
        boxSizing: 'border-box',
      }}
    />
  )
}

/* ── Storage Browser ── */

function StorageBrowser({ connId, onSelect, onClose }) {
  const [path, setPath] = useState('')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const browse = (p) => {
    setLoading(true)
    setError(null)
    api.browseConnection(connId, p)
      .then((d) => { setData(d); setPath(p) })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { browse('') }, [connId])

  const breadcrumb = data?.breadcrumb ?? []

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1200,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: theme.bgCard, border: `1px solid ${theme.border}`,
          borderRadius: 14, width: '90%', maxWidth: 520, maxHeight: '80vh',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{ padding: '14px 20px', borderBottom: `1px solid ${theme.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="database" size={14} style={{ color: theme.accent }} />
          <span style={{ fontWeight: 600, fontSize: 14, flex: 1 }}>Browse Storage</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: theme.textMuted, cursor: 'pointer' }}>
            <Icon name="x" size={16} />
          </button>
        </div>

        {/* Breadcrumb */}
        <div style={{ padding: '8px 20px', borderBottom: `1px solid ${theme.border}`, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          <button
            onClick={() => browse('')}
            style={{ background: 'none', border: 'none', color: theme.accent, cursor: 'pointer', fontSize: 12, padding: 0 }}
          >
            root
          </button>
          {breadcrumb.map((crumb, i) => {
            const crumbPath = breadcrumb.slice(0, i + 1).join('.')
            return (
              <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Icon name="chevron-right" size={10} style={{ color: theme.textDim }} />
                <button
                  onClick={() => browse(crumbPath)}
                  style={{ background: 'none', border: 'none', color: i === breadcrumb.length - 1 ? theme.text : theme.accent, cursor: 'pointer', fontSize: 12, padding: 0 }}
                >
                  {crumb}
                </button>
              </span>
            )
          })}
        </div>

        {/* Items */}
        <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
          {loading && (
            <div style={{ padding: '24px', textAlign: 'center', color: theme.textDim, fontSize: 13 }}>
              Loading…
            </div>
          )}
          {error && (
            <div style={{ padding: '12px 20px', color: theme.red, fontSize: 12 }}>
              <Icon name="x" size={12} style={{ marginRight: 6 }} />{error}
            </div>
          )}
          {!loading && !error && data && (
            <>
              {data.items.length === 0 && (
                <div style={{ padding: '24px', textAlign: 'center', color: theme.textDim, fontSize: 13 }}>
                  No items found
                </div>
              )}
              {data.items.map((item) => {
                const iconMap = { catalog: 'box', schema: 'layers', table: 'grid', view: 'grid', bucket: 'database', folder: 'folder', file: 'file', topic: 'activity', column: 'hash' }
                const isSelectable = item.selectable || ['table', 'view', 'file', 'topic'].includes(item.type)
                const isNavigable = ['catalog', 'schema', 'bucket', 'folder'].includes(item.type)
                return (
                  <div
                    key={item.path}
                    style={{
                      padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 10,
                      cursor: isNavigable || isSelectable ? 'pointer' : 'default',
                      borderRadius: 6, margin: '0 8px',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = theme.bgInput}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    onClick={() => {
                      if (isNavigable) browse(item.path)
                    }}
                  >
                    <Icon name={iconMap[item.type] ?? 'file'} size={14} style={{ color: theme.textDim, flexShrink: 0 }} />
                    <span style={{ fontSize: 13, flex: 1, fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.name}
                    </span>
                    {item.col_type && <span style={{ fontSize: 11, color: theme.textDim }}>{item.col_type}</span>}
                    {isSelectable && (
                      <Button
                        variant="ghost"
                        style={{ padding: '2px 10px', fontSize: 11, flexShrink: 0 }}
                        onClick={(e) => { e.stopPropagation(); onSelect(item.full_path ?? item.path) }}
                      >
                        Select
                      </Button>
                    )}
                    {isNavigable && <Icon name="chevron-right" size={12} style={{ color: theme.textDim }} />}
                  </div>
                )
              })}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* ── DataSourceStep — shared for step 2 & 3 ── */

function DataSourceStep({ sourceKey, pathKey, connIdKey, form, u, file, setFile, connections, label }) {
  const [showBrowser, setShowBrowser] = useState(false)
  const connId = form[connIdKey] || ''
  const setConnId = (v) => u(connIdKey, v)
  const source = form[sourceKey]

  // Build connection options that match the selected source type
  const matchingConns = connections.filter((c) => c.type === source)
  const connOptions = [
    { value: '', label: matchingConns.length ? 'Select a connection…' : 'No connections configured — add in Settings' },
    ...matchingConns.map((c) => ({ value: c.id, label: c.name })),
  ]

  const pathLabel = source === 'sql' ? 'SQL Query / Table' : source === 'kafka' ? 'Topic' : 'Path / URI'
  const pathPlaceholder = source === 'sql'
    ? 'SELECT * FROM schema.table  OR  schema.table'
    : source === 'unity_catalog'
    ? 'catalog.schema.table'
    : source === 'kafka'
    ? 'my-topic'
    : source === 's3'
    ? 's3://bucket/path/data.csv'
    : source === 'gcs'
    ? 'gs://bucket/path/data.csv'
    : ''

  return (
    <>
      <Field label="Data Source">
        <Select
          value={source}
          onChange={(v) => { u(sourceKey, v); setConnId('') }}
          style={{ width: '100%' }}
          options={SOURCE_TYPES}
        />
      </Field>

      {source === 'upload' ? (
        <Field label={`Upload ${label} CSV`}>
          <input
            type="file" accept=".csv"
            onChange={(e) => setFile(e.target.files[0] || null)}
            style={{ color: theme.text, fontSize: 13, width: '100%' }}
          />
          {file && (
            <div style={{ fontSize: 11, color: theme.accent, marginTop: 4 }}>
              Selected: {file.name}
            </div>
          )}
        </Field>
      ) : (
        <>
          {/* Connection selector */}
          <Field label="Connection">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <Select
                  value={connId}
                  onChange={setConnId}
                  style={{ width: '100%' }}
                  options={connOptions}
                />
              </div>
              {connId && (
                <Button
                  variant="ghost"
                  icon="search"
                  style={{ padding: '6px 12px', fontSize: 12, whiteSpace: 'nowrap' }}
                  onClick={() => setShowBrowser(true)}
                >
                  Browse
                </Button>
              )}
            </div>
            {matchingConns.length === 0 && (
              <div style={{ fontSize: 11, color: theme.textDim, marginTop: 4 }}>
                Go to <strong>Settings → Add Connection</strong> to configure a {source.replace('_', ' ')} connection.
              </div>
            )}
          </Field>

          {/* Path */}
          <Field label={pathLabel}>
            <Input
              value={form[pathKey]}
              onChange={(v) => u(pathKey, v)}
              placeholder={pathPlaceholder}
              mono
            />
          </Field>
        </>
      )}

      {showBrowser && connId && (
        <StorageBrowser
          connId={connId}
          onSelect={(path) => { u(pathKey, path); setShowBrowser(false) }}
          onClose={() => setShowBrowser(false)}
        />
      )}
    </>
  )
}

/* ── CSV header parser ── */

function parseCSVHeader(file) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const firstLine = (e.target.result || '').split('\n')[0]
      resolve(firstLine.split(',').map((s) => s.trim().replace(/^"|"$/g, '')).filter(Boolean))
    }
    reader.readAsText(file.slice(0, 4096))
  })
}

/* ── cron builder helpers ── */

function buildCron(freq, everyN, time, day) {
  const [hh, mm] = (time || '06:00').split(':').map(Number)
  if (freq === 'every_hour') return '0 * * * *'
  if (freq === 'every_n_hours') return `0 */${everyN || 2} * * *`
  if (freq === 'daily') return `${mm} ${hh} * * *`
  if (freq === 'weekly') return `${mm} ${hh} * * ${day ?? 1}`
  return null  // custom — caller uses raw cron
}

function cronLabel(freq, everyN, time, day) {
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  if (freq === 'every_hour') return 'every hour'
  if (freq === 'every_n_hours') return `every ${everyN || 2} hours`
  if (freq === 'daily') return `daily at ${time || '06:00'} UTC`
  if (freq === 'weekly') return `every ${DAYS[day ?? 1]} at ${time || '06:00'} UTC`
  if (freq === 'custom') return 'custom schedule'
  return ''
}

/* ── ScheduleBuilder ── */

function ScheduleBuilder({ form, u }) {
  const freq = form.scheduleFreq
  const time = form.scheduleTime
  const everyN = form.scheduleEveryN
  const day = form.scheduleDay

  // Keep form.cron in sync whenever builder fields change
  const set = (key, val) => {
    const next = { ...form, [key]: val }
    const newCron = buildCron(next.scheduleFreq, next.scheduleEveryN, next.scheduleTime, next.scheduleDay)
    u(key, val)
    if (newCron !== null) u('cron', newCron)
  }

  const TIMES = Array.from({ length: 48 }, (_, i) => {
    const h = String(Math.floor(i / 2)).padStart(2, '0')
    const m = i % 2 === 0 ? '00' : '30'
    return { value: `${h}:${m}`, label: `${h}:${m}` }
  })

  const DAYS_OF_WEEK = [
    { value: '0', label: 'Sunday' }, { value: '1', label: 'Monday' },
    { value: '2', label: 'Tuesday' }, { value: '3', label: 'Wednesday' },
    { value: '4', label: 'Thursday' }, { value: '5', label: 'Friday' },
    { value: '6', label: 'Saturday' },
  ]

  const N_OPTIONS = ['2','3','4','6','8','12'].map((v) => ({ value: v, label: v }))

  const cron = freq === 'custom' ? form.cron : (buildCron(freq, everyN, time, day) ?? form.cron)
  const label = cronLabel(freq, everyN, time, day)

  return (
    <div>
      <Field label="Frequency">
        <Select
          value={freq}
          onChange={(v) => set('scheduleFreq', v)}
          style={{ width: '100%' }}
          options={[
            { value: 'every_hour',    label: 'Every Hour' },
            { value: 'every_n_hours', label: 'Every N Hours' },
            { value: 'daily',         label: 'Daily' },
            { value: 'weekly',        label: 'Weekly' },
            { value: 'custom',        label: 'Custom Cron' },
          ]}
        />
      </Field>

      {freq === 'every_n_hours' && (
        <Field label="Every how many hours?">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 13, color: theme.textDim }}>Every</span>
            <div style={{ width: 100 }}>
              <Select value={String(everyN)} onChange={(v) => set('scheduleEveryN', v)} style={{ width: '100%' }} options={N_OPTIONS} />
            </div>
            <span style={{ fontSize: 13, color: theme.textDim }}>hours</span>
          </div>
        </Field>
      )}

      {(freq === 'daily' || freq === 'weekly') && (
        <div style={{ display: 'flex', gap: 12 }}>
          {freq === 'weekly' && (
            <Field label="Day of week">
              <Select value={String(day)} onChange={(v) => set('scheduleDay', v)} style={{ width: '100%' }} options={DAYS_OF_WEEK} />
            </Field>
          )}
          <Field label="At (UTC)">
            <Select value={time} onChange={(v) => set('scheduleTime', v)} style={{ width: 120 }} options={TIMES} />
          </Field>
        </div>
      )}

      {freq === 'custom' && (
        <Field label="Cron Expression">
          <Input value={form.cron} onChange={(v) => u('cron', v)} placeholder="0 6 * * *" mono />
        </Field>
      )}

      {/* Preview */}
      <div style={{ marginTop: 8, padding: '8px 12px', background: theme.bgSurface, borderRadius: 8, fontSize: 12, color: theme.textDim, fontFamily: 'var(--font-mono)' }}>
        ↳ <span style={{ color: theme.accent }}>{cron}</span>
        {label && <span style={{ marginLeft: 8, fontFamily: 'inherit', color: theme.textDim }}>— {label}</span>}
      </div>
    </div>
  )
}

/* ── ColumnMappingStep ── */

function ColumnMappingStep({ form, u, discoveredColumns, onLoadColumns, loadingColumns }) {
  const cols = discoveredColumns
  const hasCols = cols.length > 0

  const noneOption = { value: '', label: 'None' }
  const colOptions = [noneOption, ...cols.map((c) => ({ value: c, label: c }))]

  const selectedFeatures = form.selectedFeatures ?? []
  const toggleFeature = (col) => {
    const next = selectedFeatures.includes(col)
      ? selectedFeatures.filter((c) => c !== col)
      : [...selectedFeatures, col]
    u('selectedFeatures', next)
  }
  const allSelected = cols.length > 0 && selectedFeatures.length === cols.length
  const toggleAll = () => u('selectedFeatures', allSelected ? [] : [...cols])

  const canLoad = !!(form.refConnId && form.refPath)

  if (!hasCols) {
    return (
      <>
        {/* Load columns button for connection-based sources */}
        {(form.refSource !== 'upload' || form.prodSource !== 'upload') && (
          <div style={{ marginBottom: 16, padding: '12px 16px', background: theme.bgSurface, borderRadius: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
            <Icon name="hash" size={14} style={{ color: theme.accent }} />
            <span style={{ fontSize: 13, color: theme.textDim, flex: 1 }}>
              Load column schema from your configured data source to enable column selection.
            </span>
            <button
              onClick={onLoadColumns}
              disabled={!canLoad || loadingColumns}
              style={{
                padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                background: canLoad ? theme.accent : theme.bgInput,
                color: canLoad ? '#000' : theme.textDim,
                border: 'none', cursor: canLoad ? 'pointer' : 'default',
                opacity: loadingColumns ? 0.6 : 1,
              }}
            >
              {loadingColumns ? 'Loading…' : 'Load Columns'}
            </button>
          </div>
        )}

        {/* Fallback: text inputs */}
        <Field label="Feature Columns (comma-separated)">
          <Input value={form.features} onChange={(v) => u('features', v)} placeholder="age, income, credit_score, ..." mono />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Prediction Column"><Input value={form.predictionCol} onChange={(v) => u('predictionCol', v)} mono /></Field>
          <Field label="Target Column (optional)"><Input value={form.targetCol} onChange={(v) => u('targetCol', v)} mono /></Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="Score Column (optional)"><Input value={form.scoreCol ?? ''} onChange={(v) => u('scoreCol', v)} mono /></Field>
          <Field label="Timestamp Column (optional)"><Input value={form.timestampCol} onChange={(v) => u('timestampCol', v)} mono /></Field>
        </div>
        <Field label="Segment Columns (optional, comma-separated)">
          <Input value={form.segments} onChange={(v) => u('segments', v)} placeholder="region, channel" mono />
        </Field>
      </>
    )
  }

  return (
    <>
      {/* Feature checkboxes */}
      <Field label={`Feature Columns — ${selectedFeatures.length} / ${cols.length} selected`}>
        <div style={{ marginBottom: 8 }}>
          <button
            onClick={toggleAll}
            style={{ background: 'none', border: 'none', color: theme.accent, cursor: 'pointer', fontSize: 12, padding: 0 }}
          >
            {allSelected ? 'Deselect All' : 'Select All'}
          </button>
        </div>
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
          gap: 6, maxHeight: 180, overflowY: 'auto',
          background: theme.bgSurface, borderRadius: 8, padding: 10,
        }}>
          {cols.map((col) => (
            <label
              key={col}
              style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-mono)' }}
            >
              <input
                type="checkbox"
                checked={selectedFeatures.includes(col)}
                onChange={() => toggleFeature(col)}
                style={{ accentColor: theme.accent }}
              />
              <span style={{ color: selectedFeatures.includes(col) ? theme.text : theme.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {col}
              </span>
            </label>
          ))}
        </div>
      </Field>

      {/* Column dropdowns */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Prediction Column">
          <Select value={form.predictionCol} onChange={(v) => u('predictionCol', v)} style={{ width: '100%' }} options={colOptions} />
        </Field>
        <Field label="Target Column (optional)">
          <Select value={form.targetCol} onChange={(v) => u('targetCol', v)} style={{ width: '100%' }} options={colOptions} />
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Score Column (optional)">
          <Select value={form.scoreCol ?? ''} onChange={(v) => u('scoreCol', v)} style={{ width: '100%' }} options={colOptions} />
        </Field>
        <Field label="Timestamp Column (optional)">
          <Select value={form.timestampCol} onChange={(v) => u('timestampCol', v)} style={{ width: '100%' }} options={colOptions} />
        </Field>
      </div>
      <Field label="Segment Column (optional)">
        <Select value={form.segments} onChange={(v) => u('segments', v)} style={{ width: '100%' }} options={colOptions} />
      </Field>
    </>
  )
}

/* ── wizard ── */

export default function OnboardingWizard({ onClose, teams: teamsProp = [] }) {
  // Use live API teams when available, fall back to the hardcoded list for dev/offline
  const teamOptions = (teamsProp.length ? teamsProp.map((t) => ({ value: t.name, label: t.name })) : TEAMS.map((t) => ({ value: t, label: t })))
  const [step, setStep] = useState(1)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [baselineFile, setBaselineFile] = useState(null)
  const [prodFile, setProdFile] = useState(null)
  const [connections, setConnections] = useState([])
  const [loadingColumns, setLoadingColumns] = useState(false)
  const [teamMembers, setTeamMembers] = useState([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [form, setForm] = useState({
    name: '', version: '1.0.0', type: 'classification', owner: '', team: '',
    description: '', refSource: 'upload', refPath: '', refConnId: '', prodSource: 'upload', prodPath: '', prodConnId: '',
    timestampCol: '', predictionCol: '', targetCol: '', scoreCol: '',
    features: '', selectedFeatures: [], segments: '',
    scheduleFreq: 'daily', scheduleEveryN: '2', scheduleTime: '06:00', scheduleDay: '1',
    cron: '0 6 * * *',
    lookback: '7d', engine: 'local', psiWarn: '0.10', psiCrit: '0.25', channels: 'slack',
    discoveredColumns: [],
  })
  const u = (k, v) => setForm((p) => ({ ...p, [k]: v }))

  useEffect(() => {
    api.listConnections().then(setConnections).catch(() => [])
  }, [])

  // When team changes, fetch its members and reset owner
  useEffect(() => {
    const selectedTeam = teamsProp.find((t) => t.name === form.team)
    if (!selectedTeam) { setTeamMembers([]); return }
    setLoadingMembers(true)
    api.getTeamWithMembers(selectedTeam.id)
      .then((t) => setTeamMembers(t.members ?? []))
      .catch(() => setTeamMembers([]))
      .finally(() => setLoadingMembers(false))
  }, [form.team])

  const applyDiscoveredColumns = (cols) => {
    if (!cols.length) return
    const find = (...names) => cols.find((c) => names.includes(c.toLowerCase())) || ''
    const special = new Set(['dat_ref', 'timestamp', 'event_timestamp', 'date', 'ts',
      'prediction', 'pred', 'y_pred', 'target', 'label', 'y_true', 'y',
      'prediction_score', 'score', 'proba', 'probability'])
    setForm((p) => ({
      ...p,
      discoveredColumns: cols,
      predictionCol: p.predictionCol || find('prediction', 'pred', 'y_pred'),
      targetCol: p.targetCol || find('target', 'label', 'y_true', 'y'),
      timestampCol: p.timestampCol || find('dat_ref', 'timestamp', 'event_timestamp', 'date', 'ts'),
      scoreCol: p.scoreCol || find('prediction_score', 'score', 'proba', 'probability'),
      selectedFeatures: p.selectedFeatures.length > 0
        ? p.selectedFeatures
        : cols.filter((c) => !special.has(c.toLowerCase())),
    }))
  }

  // Parse CSV header whenever a baseline file is selected
  useEffect(() => {
    if (baselineFile) {
      parseCSVHeader(baselineFile).then((cols) => { if (cols.length > 0) applyDiscoveredColumns(cols) })
    }
  }, [baselineFile])

  const handleLoadColumns = () => {
    setLoadingColumns(true)
    api.getConnectionColumns(form.refConnId, form.refPath)
      .then((res) => { if (res?.columns?.length > 0) applyDiscoveredColumns(res.columns) })
      .catch(() => {})
      .finally(() => setLoadingColumns(false))
  }

  const handleCreate = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const payload = {
        name: form.name || 'Unnamed Model',
        version: form.version || '1.0.0',
        type: form.type,
        owner: form.owner,
        team: form.team,
        description: form.description || null,
        engine: form.engine,
        schedule: form.cron,
        lookback_window: form.lookback,
        psi_warn_threshold: parseFloat(form.psiWarn) || 0.10,
        psi_crit_threshold: parseFloat(form.psiCrit) || 0.25,
        alert_channels: form.channels ? [form.channels] : [],
        column_mapping: {
          features: form.selectedFeatures.length > 0
            ? form.selectedFeatures
            : form.features.split(',').map((s) => s.trim()).filter(Boolean),
          prediction_col: form.predictionCol || '',
          target_col: form.targetCol || '',
          timestamp_col: form.timestampCol || '',
          score_col: form.scoreCol || '',
          segment_cols: form.segments ? [form.segments] : [],
        },
        reference_dataset_config: form.refSource !== 'upload' && form.refPath ? {
          source_type: form.refSource,
          connection_id: form.refConnId || null,
          path: form.refPath,
          format: form.refPath.endsWith('.parquet') ? 'parquet' : 'csv',
        } : null,
        inference_dataset_config: form.prodSource !== 'upload' && form.prodPath ? {
          source_type: form.prodSource,
          connection_id: form.prodConnId || null,
          path: form.prodPath,
          format: form.prodPath.endsWith('.parquet') ? 'parquet' : 'csv',
        } : null,
      }
      const model = await api.createModel(payload)

      // Upload datasets if files were selected
      if (baselineFile) {
        await api.uploadDataset(model.id, baselineFile, 'baseline').catch(() => null)
      }
      if (prodFile) {
        await api.uploadDataset(model.id, prodFile, 'production').catch(() => null)
      }

      onClose({ refresh: true })
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, backdropFilter: 'blur(6px)',
      }}
    >
      <div
        style={{
          background: theme.bgCard,
          border: `1px solid ${theme.border}`,
          borderRadius: 16,
          width: '90%', maxWidth: 680, maxHeight: '90vh',
          overflow: 'auto', position: 'relative',
        }}
      >
        {/* ── Progress bar ── */}
        <div style={{ padding: '16px 24px', borderBottom: `1px solid ${theme.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
          {STEPS.map((s, i) => (
            <div key={s.n} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div
                style={{
                  width: 28, height: 28, borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 700,
                  background: step >= s.n ? theme.accent : theme.bgInput,
                  color: step >= s.n ? '#000' : theme.textDim,
                  border: `2px solid ${step >= s.n ? theme.accent : theme.border}`,
                  transition: 'all 0.2s',
                }}
              >
                {s.n}
              </div>
              {i < STEPS.length - 1 && (
                <div style={{ width: 20, height: 2, background: step > s.n ? theme.accent : theme.border, transition: 'all 0.2s' }} />
              )}
            </div>
          ))}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: theme.textMuted, cursor: 'pointer' }}>
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* ── Content ── */}
        <div style={{ padding: 24 }}>
          <h3 style={{ margin: '0 0 4px', color: theme.text, fontSize: 18 }}>
            <Icon name={STEPS[step - 1].icon} size={16} style={{ marginRight: 8, verticalAlign: -2, color: theme.accent }} />
            Step {step}: {STEPS[step - 1].title}
          </h3>
          <p style={{ color: theme.textDim, fontSize: 12, margin: '0 0 20px' }}>{STEP_DESCRIPTIONS[step - 1]}</p>

          {/* Step 1 — Basic Info */}
          {step === 1 && (
            <>
              <Field label="Model Name"><Input value={form.name} onChange={(v) => u('name', v)} placeholder="e.g. Churn Predictor" /></Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="Version"><Input value={form.version} onChange={(v) => u('version', v)} placeholder="1.0.0" /></Field>
                <Field label="Type">
                  <Select value={form.type} onChange={(v) => u('type', v)} style={{ width: '100%' }}
                    options={MODEL_TYPES.map((t) => ({ value: t, label: t }))} />
                </Field>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="Team">
                  <Select value={form.team} onChange={(v) => { u('team', v); u('owner', '') }} style={{ width: '100%' }}
                    options={[{ value: '', label: 'Select team…' }, ...teamOptions]} />
                </Field>
                <Field label="Owner">
                  {teamsProp.length > 0 ? (
                    <>
                      <select
                        value={form.owner}
                        onChange={(e) => u('owner', e.target.value)}
                        disabled={!form.team || loadingMembers}
                        style={{
                          width: '100%', padding: '7px 28px 7px 10px',
                          background: theme.bgInput,
                          border: `1px solid ${theme.border}`, borderRadius: 8,
                          color: form.owner ? theme.text : theme.textDim,
                          fontSize: 12, outline: 'none', fontFamily: 'inherit',
                          opacity: (!form.team || loadingMembers) ? 0.5 : 1,
                          cursor: (!form.team || loadingMembers) ? 'not-allowed' : 'pointer',
                        }}
                      >
                        <option value="">
                          {loadingMembers ? 'Loading members…' : form.team ? (teamMembers.length ? 'Select owner…' : 'No members in team') : 'Select a team first'}
                        </option>
                        {teamMembers.map((m) => (
                          <option key={m.user_id} value={m.user.display_name}>
                            {m.user.display_name} — {m.user.email}
                          </option>
                        ))}
                      </select>
                      {form.team && !loadingMembers && teamMembers.length === 0 && (
                        <div style={{ fontSize: 11, color: theme.textDim, marginTop: 4 }}>
                          Add members to this team in <strong>Settings → Users & Teams</strong>.
                        </div>
                      )}
                    </>
                  ) : (
                    <Input value={form.owner} onChange={(v) => u('owner', v)} placeholder="alice.chen" />
                  )}
                </Field>
              </div>
              <Field label="Description"><Input value={form.description} onChange={(v) => u('description', v)} placeholder="Production model for..." /></Field>
            </>
          )}

          {/* Step 2 — Reference Data */}
          {step === 2 && (
            <DataSourceStep
              sourceKey="refSource" pathKey="refPath" connIdKey="refConnId"
              form={form} u={u}
              file={baselineFile} setFile={setBaselineFile}
              connections={connections}
              label="Baseline"
            />
          )}

          {/* Step 3 — Production Data */}
          {step === 3 && (
            <>
              <DataSourceStep
                sourceKey="prodSource" pathKey="prodPath" connIdKey="prodConnId"
                form={form} u={u}
                file={prodFile} setFile={setProdFile}
                connections={connections}
                label="Production"
              />
              {form.prodSource !== 'upload' && (
                <Field label="Timestamp Column">
                  <Input value={form.timestampCol} onChange={(v) => u('timestampCol', v)} placeholder="event_timestamp" mono />
                </Field>
              )}
            </>
          )}

          {/* Step 4 — Column Mapping */}
          {step === 4 && (
            <ColumnMappingStep
              form={form} u={u}
              discoveredColumns={form.discoveredColumns}
              onLoadColumns={handleLoadColumns}
              loadingColumns={loadingColumns}
            />
          )}

          {/* Step 5 — Schedule */}
          {step === 5 && (
            <>
              <ScheduleBuilder form={form} u={u} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
                <Field label="Lookback Window">
                  <Select value={form.lookback} onChange={(v) => u('lookback', v)} style={{ width: '100%' }}
                    options={[{ value: '1d', label: '1 Day' }, { value: '7d', label: '7 Days' }, { value: '14d', label: '14 Days' }, { value: '30d', label: '30 Days' }]} />
                </Field>
                <Field label="Execution Engine">
                  <Select value={form.engine} onChange={(v) => u('engine', v)} style={{ width: '100%' }}
                    options={ENGINES.map((e) => ({ value: e, label: e }))} />
                </Field>
              </div>
            </>
          )}

          {/* Step 6 — Alerts */}
          {step === 6 && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="PSI Warning Threshold"><Input value={form.psiWarn} onChange={(v) => u('psiWarn', v)} /></Field>
                <Field label="PSI Critical Threshold"><Input value={form.psiCrit} onChange={(v) => u('psiCrit', v)} /></Field>
              </div>
              <Field label="Notification Channels">
                <Select value={form.channels} onChange={(v) => u('channels', v)} style={{ width: '100%' }}
                  options={[{ value: 'slack', label: 'Slack' }, { value: 'email', label: 'Email' }, { value: 'pagerduty', label: 'PagerDuty' }, { value: 'webhook', label: 'Webhook' }]} />
              </Field>
            </>
          )}

          {/* Step 7 — Review */}
          {step === 7 && (
            <div style={{ background: theme.bgSurface, borderRadius: 10, padding: 16, fontSize: 12 }}>
              {[
                ['Model', `${form.name || '(unnamed)'} v${form.version}`],
                ['Type', form.type],
                ['Owner', form.owner || '—'],
                ['Team', form.team || '—'],
                ['Reference', `${form.refSource}: ${form.refPath || (baselineFile?.name ?? '—')}`],
                ['Production', `${form.prodSource}: ${form.prodPath || (prodFile?.name ?? '—')}`],
                ['Timestamp', form.timestampCol],
                ['Prediction', form.predictionCol],
                ['Schedule', `${cronLabel(form.scheduleFreq, form.scheduleEveryN, form.scheduleTime, form.scheduleDay)} (${form.cron})`],
                ['Lookback', form.lookback],
                ['Engine', form.engine],
                ['Alert Thresholds', `Warning: ${form.psiWarn} | Critical: ${form.psiCrit}`],
                ['Channels', form.channels],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: `1px solid ${theme.border}08` }}>
                  <span style={{ color: theme.textDim }}>{k}</span>
                  <span style={{ color: theme.text, fontWeight: 500 }}>{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Nav ── */}
        {error && (
          <div style={{ margin: '0 24px', padding: '10px 14px', borderRadius: 8, background: theme.red + '18', border: `1px solid ${theme.red}40`, color: theme.red, fontSize: 12 }}>
            {error}
          </div>
        )}
        <div style={{ padding: '12px 24px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Button onClick={() => (step > 1 ? setStep(step - 1) : onClose())} variant="ghost" disabled={submitting}>
            {step > 1 ? 'Back' : 'Cancel'}
          </Button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {step === 1 && (!form.team || !form.owner) && (
              <span style={{ fontSize: 11, color: theme.textDim }}>
                {!form.team ? 'Select a team to continue' : 'Select an owner to continue'}
              </span>
            )}
            <Button
              variant="primary"
              onClick={() => (step < 7 ? setStep(step + 1) : handleCreate())}
              icon={step === 7 ? 'check' : 'chevron-right'}
              disabled={submitting || (step === 1 && (!form.team || !form.owner))}
            >
              {step === 7 ? (submitting ? 'Creating…' : 'Create Model') : 'Next'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
