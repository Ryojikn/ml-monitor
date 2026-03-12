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

function DataSourceStep({ sourceKey, pathKey, form, u, file, setFile, connections, label }) {
  const [showBrowser, setShowBrowser] = useState(false)
  const [connId, setConnId] = useState('')
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

/* ── wizard ── */

export default function OnboardingWizard({ onClose }) {
  const [step, setStep] = useState(1)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [baselineFile, setBaselineFile] = useState(null)
  const [prodFile, setProdFile] = useState(null)
  const [connections, setConnections] = useState([])
  const [form, setForm] = useState({
    name: '', version: '1.0.0', type: 'classification', owner: '', team: '',
    description: '', refSource: 'upload', refPath: '', prodSource: 'upload', prodPath: '',
    timestampCol: 'event_timestamp', predictionCol: 'prediction', targetCol: 'target',
    features: '', segments: '', schedule: 'daily', cron: '0 6 * * *',
    lookback: '7d', engine: 'local', psiWarn: '0.10', psiCrit: '0.25', channels: 'slack',
  })
  const u = (k, v) => setForm((p) => ({ ...p, [k]: v }))

  useEffect(() => {
    api.listConnections().then(setConnections).catch(() => [])
  }, [])

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
          features: form.features.split(',').map((s) => s.trim()).filter(Boolean),
          prediction_col: form.predictionCol,
          target_col: form.targetCol,
          timestamp_col: form.timestampCol,
          segment_cols: form.segments.split(',').map((s) => s.trim()).filter(Boolean),
        },
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
                <Field label="Owner"><Input value={form.owner} onChange={(v) => u('owner', v)} placeholder="alice.chen" /></Field>
                <Field label="Team">
                  <Select value={form.team} onChange={(v) => u('team', v)} style={{ width: '100%' }}
                    options={[{ value: '', label: 'Select team' }, ...TEAMS.map((t) => ({ value: t, label: t }))]} />
                </Field>
              </div>
              <Field label="Description"><Input value={form.description} onChange={(v) => u('description', v)} placeholder="Production model for..." /></Field>
            </>
          )}

          {/* Step 2 — Reference Data */}
          {step === 2 && (
            <DataSourceStep
              sourceKey="refSource" pathKey="refPath"
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
                sourceKey="prodSource" pathKey="prodPath"
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
            <>
              <Field label="Feature Columns (comma-separated)">
                <Input value={form.features} onChange={(v) => u('features', v)} placeholder="age, income, credit_score, tenure_months, ..." mono />
              </Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="Prediction Column"><Input value={form.predictionCol} onChange={(v) => u('predictionCol', v)} mono /></Field>
                <Field label="Target Column (optional)"><Input value={form.targetCol} onChange={(v) => u('targetCol', v)} mono /></Field>
              </div>
              <Field label="Segment Columns (optional, comma-separated)">
                <Input value={form.segments} onChange={(v) => u('segments', v)} placeholder="region, channel" mono />
              </Field>
            </>
          )}

          {/* Step 5 — Schedule */}
          {step === 5 && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="Schedule">
                  <Select value={form.schedule} onChange={(v) => u('schedule', v)} style={{ width: '100%' }}
                    options={[{ value: 'hourly', label: 'Hourly' }, { value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'custom', label: 'Custom Cron' }]} />
                </Field>
                <Field label="Cron Expression"><Input value={form.cron} onChange={(v) => u('cron', v)} mono /></Field>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
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
                ['Schedule', `${form.schedule} (${form.cron})`],
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
        <div style={{ padding: '12px 24px 20px', display: 'flex', justifyContent: 'space-between' }}>
          <Button onClick={() => (step > 1 ? setStep(step - 1) : onClose())} variant="ghost" disabled={submitting}>
            {step > 1 ? 'Back' : 'Cancel'}
          </Button>
          <Button
            variant="primary"
            onClick={() => (step < 7 ? setStep(step + 1) : handleCreate())}
            icon={step === 7 ? 'check' : 'chevron-right'}
            disabled={submitting}
          >
            {step === 7 ? (submitting ? 'Creating…' : 'Create Model') : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  )
}
