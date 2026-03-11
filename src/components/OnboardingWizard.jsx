/* ═══════════════════════════════════════════
   Model Onboarding Wizard — 7 steps
   ═══════════════════════════════════════════ */

import { useState } from 'react'
import Icon from './Icon.jsx'
import { Button, Badge, Select } from './ui.jsx'
import { theme } from '../utils/theme.js'
import { MODEL_TYPES, TEAMS, ENGINES } from '../utils/constants.js'

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

/* ── wizard ── */

export default function OnboardingWizard({ onClose }) {
  const [step, setStep] = useState(1)
  const [form, setForm] = useState({
    name: '', version: '1.0.0', type: 'classification', owner: '', team: '',
    description: '', refSource: 's3', refPath: '', prodSource: 's3', prodPath: '',
    timestampCol: 'event_timestamp', predictionCol: 'prediction', targetCol: 'target',
    features: '', segments: '', schedule: 'daily', cron: '0 6 * * *',
    lookback: '7d', engine: 'local', psiWarn: '0.10', psiCrit: '0.25', channels: 'slack',
  })
  const u = (k, v) => setForm((p) => ({ ...p, [k]: v }))

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
            <>
              <Field label="Data Source">
                <Select value={form.refSource} onChange={(v) => u('refSource', v)} style={{ width: '100%' }}
                  options={[
                    { value: 's3', label: 'AWS S3' }, { value: 'gcs', label: 'Google Cloud Storage' },
                    { value: 'sql', label: 'SQL Database' }, { value: 'delta', label: 'Delta Table' },
                    { value: 'upload', label: 'Direct Upload' },
                  ]} />
              </Field>
              <Field label={form.refSource === 'sql' ? 'SQL Query' : 'Path / URI'}>
                <Input value={form.refPath} onChange={(v) => u('refPath', v)}
                  placeholder={form.refSource === 'sql' ? 'SELECT * FROM training_data' : 's3://bucket/path/baseline.parquet'}
                  mono />
              </Field>
            </>
          )}

          {/* Step 3 — Production Data */}
          {step === 3 && (
            <>
              <Field label="Data Source">
                <Select value={form.prodSource} onChange={(v) => u('prodSource', v)} style={{ width: '100%' }}
                  options={[
                    { value: 's3', label: 'AWS S3' }, { value: 'gcs', label: 'Google Cloud Storage' },
                    { value: 'sql', label: 'SQL Database' }, { value: 'kafka', label: 'Kafka Topic' },
                    { value: 'delta', label: 'Delta Table' },
                  ]} />
              </Field>
              <Field label={form.prodSource === 'sql' ? 'SQL Query' : form.prodSource === 'kafka' ? 'Topic' : 'Path / URI'}>
                <Input value={form.prodPath} onChange={(v) => u('prodPath', v)} placeholder="s3://bucket/path/production/" mono />
              </Field>
              <Field label="Timestamp Column">
                <Input value={form.timestampCol} onChange={(v) => u('timestampCol', v)} placeholder="event_timestamp" mono />
              </Field>
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
                ['Reference', `${form.refSource}: ${form.refPath || '—'}`],
                ['Production', `${form.prodSource}: ${form.prodPath || '—'}`],
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
        <div style={{ padding: '12px 24px 20px', display: 'flex', justifyContent: 'space-between' }}>
          <Button onClick={() => (step > 1 ? setStep(step - 1) : onClose)} variant="ghost">
            {step > 1 ? 'Back' : 'Cancel'}
          </Button>
          <Button
            variant="primary"
            onClick={() => (step < 7 ? setStep(step + 1) : onClose)}
            icon={step === 7 ? 'check' : 'chevron-right'}
          >
            {step === 7 ? 'Create Model' : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  )
}
