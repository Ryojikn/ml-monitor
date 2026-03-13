/* ═══════════════════════════════════════════
   SettingsView — Storage Connections manager
   ═══════════════════════════════════════════ */

import { useState, useEffect, useCallback } from 'react'
import Icon from './Icon.jsx'
import { Button, Badge } from './ui.jsx'
import { theme } from '../utils/theme.js'
import { api } from '../api.js'

/* ── Connection type metadata ── */

const CONN_TYPES = [
  { value: 's3',            label: 'AWS S3',              icon: 'layers',   color: '#FF9900' },
  { value: 'gcs',           label: 'Google Cloud Storage',icon: 'database', color: '#4285F4' },
  { value: 'sql',           label: 'SQL Database',        icon: 'hash',     color: '#00ADEF' },
  { value: 'unity_catalog', label: 'Unity Catalog',       icon: 'box',      color: '#FF3621' },
]

const TYPE_META = Object.fromEntries(CONN_TYPES.map((t) => [t.value, t]))

/* ── Config field definitions per type ── */

const CONFIG_FIELDS = {
  s3: [
    { key: 'bucket',            label: 'Default Bucket',    placeholder: 'my-bucket',              required: false },
    { key: 'prefix',            label: 'Default Prefix',    placeholder: 'data/',                  required: false },
    { key: 'region',            label: 'Region',            placeholder: 'us-east-1',              required: false },
    { key: 'access_key_id',     label: 'Access Key ID',     placeholder: 'AKIA...',                required: false },
    { key: 'secret_access_key', label: 'Secret Access Key', placeholder: '••••••••',               required: false, secret: true },
    { key: 'endpoint_url',      label: 'Endpoint URL (MinIO / custom)', placeholder: 'http://localhost:9000', required: false },
  ],
  gcs: [
    { key: 'bucket',          label: 'Default Bucket',  placeholder: 'my-bucket',       required: false },
    { key: 'prefix',          label: 'Default Prefix',  placeholder: 'data/',           required: false },
    { key: 'project',         label: 'Project ID',      placeholder: 'my-gcp-project',  required: false },
    { key: 'credentials_json',label: 'Service Account JSON', placeholder: '{"type":"service_account",...}', required: false, multiline: true, secret: true },
  ],
  sql: [
    { key: 'connection_string', label: 'Connection String', placeholder: 'postgresql://user:pass@host:5432/dbname', required: true },
    { key: 'schema',            label: 'Default Schema',    placeholder: 'public', required: false },
  ],
  unity_catalog: [
    { key: 'workspace_url', label: 'Workspace URL', placeholder: 'https://adb-xxx.azuredatabricks.net', required: true },
    { key: 'token',         label: 'Personal Access Token', placeholder: 'dapi...', required: true, secret: true },
    { key: 'catalog',       label: 'Default Catalog', placeholder: 'main', required: false },
    { key: 'schema',        label: 'Default Schema',  placeholder: 'default', required: false },
  ],
}

/* ── Small form helpers ── */

function Field({ label, children, hint }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 12, color: theme.textMuted, marginBottom: 5, fontWeight: 600 }}>
        {label}
      </label>
      {children}
      {hint && <div style={{ fontSize: 11, color: theme.textDim, marginTop: 4 }}>{hint}</div>}
    </div>
  )
}

function TextInput({ value, onChange, placeholder, mono, secret, multiline }) {
  const base = {
    width: '100%', padding: '8px 12px',
    background: theme.bgInput, border: `1px solid ${theme.border}`, borderRadius: 8,
    color: theme.text, fontSize: 13, outline: 'none',
    fontFamily: mono ? 'var(--font-mono)' : 'inherit',
    boxSizing: 'border-box',
  }
  if (multiline) {
    return (
      <textarea
        value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} rows={4}
        style={{ ...base, resize: 'vertical' }}
      />
    )
  }
  return (
    <input
      type={secret ? 'password' : 'text'}
      value={value} onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={base}
    />
  )
}

/* ── Connection Form Modal ── */

function ConnectionModal({ connection, onSave, onClose }) {
  const isEdit = !!connection?.id
  const [name, setName] = useState(connection?.name ?? '')
  const [type, setType] = useState(connection?.type ?? 's3')
  const [description, setDescription] = useState(connection?.description ?? '')
  const [config, setConfig] = useState(connection?.config ?? {})
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [error, setError] = useState(null)

  const setConf = (k, v) => setConfig((c) => ({ ...c, [k]: v }))

  const handleTest = async () => {
    if (!connection?.id) return
    setTesting(true)
    setTestResult(null)
    try {
      const r = await api.testConnection(connection.id)
      setTestResult(r)
    } finally {
      setTesting(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await onSave({ name: name || 'Unnamed Connection', type, description: description || null, config })
    } catch (e) {
      setError(e.message)
      setSaving(false)
    }
  }

  const fields = CONFIG_FIELDS[type] ?? []

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1100,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: theme.bgCard, border: `1px solid ${theme.border}`,
          borderRadius: 16, width: '90%', maxWidth: 560,
          maxHeight: '90vh', overflow: 'auto',
        }}
      >
        {/* Header */}
        <div style={{ padding: '16px 24px', borderBottom: `1px solid ${theme.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>{isEdit ? 'Edit Connection' : 'Add Connection'}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: theme.textMuted, cursor: 'pointer' }}>
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 24 }}>
          <Field label="Connection Name">
            <TextInput value={name} onChange={setName} placeholder="Production S3 Bucket" />
          </Field>

          <Field label="Connection Type">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {CONN_TYPES.map((ct) => (
                <button
                  key={ct.value}
                  onClick={() => { setType(ct.value); setConfig({}) }}
                  style={{
                    padding: '6px 12px', borderRadius: 8, cursor: 'pointer',
                    border: `2px solid ${type === ct.value ? ct.color : theme.border}`,
                    background: type === ct.value ? ct.color + '18' : theme.bgInput,
                    color: type === ct.value ? ct.color : theme.textMuted,
                    fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                    transition: 'all 0.15s',
                  }}
                >
                  <Icon name={ct.icon} size={12} style={{ marginRight: 4, verticalAlign: -1 }} />
                  {ct.label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Description (optional)">
            <TextInput value={description} onChange={setDescription} placeholder="Brief description..." />
          </Field>

          {/* Dynamic config fields */}
          {fields.length > 0 && (
            <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: 16, marginTop: 4 }}>
              <div style={{ fontSize: 11, color: theme.textDim, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {TYPE_META[type]?.label} Configuration
              </div>
              {fields.map((f) => (
                <Field key={f.key} label={f.label + (f.required ? ' *' : '')}>
                  <TextInput
                    value={config[f.key] ?? ''}
                    onChange={(v) => setConf(f.key, v)}
                    placeholder={f.placeholder}
                    secret={f.secret}
                    multiline={f.multiline}
                    mono
                  />
                </Field>
              ))}
            </div>
          )}

          {/* Test result */}
          {testResult && (
            <div
              style={{
                padding: '10px 14px', borderRadius: 8, marginBottom: 12,
                background: (testResult.ok ? theme.green : theme.red) + '18',
                border: `1px solid ${(testResult.ok ? theme.green : theme.red)}40`,
                color: testResult.ok ? theme.green : theme.red,
                fontSize: 12,
              }}
            >
              <Icon name={testResult.ok ? 'check' : 'x'} size={12} style={{ marginRight: 6 }} />
              {testResult.message}
            </div>
          )}

          {error && (
            <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 12, background: theme.red + '18', border: `1px solid ${theme.red}40`, color: theme.red, fontSize: 12 }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 24px 20px', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          {isEdit ? (
            <Button variant="ghost" onClick={handleTest} disabled={testing}>
              {testing ? 'Testing…' : 'Test Connection'}
            </Button>
          ) : <div />}
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button variant="primary" onClick={handleSave} disabled={saving} icon="check">
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Connection'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Connection card ── */

function ConnectionCard({ conn, onEdit, onDelete, onTest }) {
  const meta = TYPE_META[conn.type] ?? { label: conn.type, icon: 'database', color: theme.accent }
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    const r = await onTest(conn.id)
    setTestResult(r)
    setTesting(false)
  }

  return (
    <div
      style={{
        background: theme.bgCard, border: `1px solid ${theme.border}`,
        borderRadius: 12, padding: 16,
        display: 'flex', alignItems: 'flex-start', gap: 14,
      }}
    >
      {/* Type icon */}
      <div
        style={{
          width: 40, height: 40, borderRadius: 10, flexShrink: 0,
          background: meta.color + '18', border: `1px solid ${meta.color}30`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: meta.color,
        }}
      >
        <Icon name={meta.icon} size={18} />
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{conn.name}</span>
          <Badge style={{ background: meta.color + '18', color: meta.color, border: `1px solid ${meta.color}30` }}>
            {meta.label}
          </Badge>
          {conn.last_tested_at && (
            <Badge style={{
              background: (conn.last_test_ok ? theme.green : theme.red) + '18',
              color: conn.last_test_ok ? theme.green : theme.red,
            }}>
              {conn.last_test_ok ? 'OK' : 'Failed'}
            </Badge>
          )}
        </div>
        {conn.description && (
          <div style={{ fontSize: 12, color: theme.textDim, marginTop: 4 }}>{conn.description}</div>
        )}
        {testResult && (
          <div style={{ fontSize: 11, color: testResult.ok ? theme.green : theme.red, marginTop: 6 }}>
            <Icon name={testResult.ok ? 'check' : 'x'} size={11} style={{ marginRight: 4 }} />
            {testResult.message}
          </div>
        )}
        <div style={{ fontSize: 10, color: theme.textDim, marginTop: 6 }}>
          Added {new Date(conn.created_at).toLocaleDateString()}
          {conn.last_tested_at && ` · Tested ${new Date(conn.last_tested_at).toLocaleString()}`}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <Button variant="ghost" onClick={handleTest} disabled={testing} style={{ padding: '4px 10px', fontSize: 12 }}>
          {testing ? '…' : 'Test'}
        </Button>
        <Button variant="ghost" onClick={() => onEdit(conn)} style={{ padding: '4px 10px', fontSize: 12 }}>
          <Icon name="edit" size={13} />
        </Button>
        <Button variant="ghost" onClick={() => onDelete(conn)} style={{ padding: '4px 10px', fontSize: 12, color: theme.red }}>
          <Icon name="trash" size={13} />
        </Button>
      </div>
    </div>
  )
}

/* ── Main SettingsView ── */

export default function SettingsView() {
  const [connections, setConnections] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)   // null | { mode: 'add' } | { mode: 'edit', conn }
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const loadConnections = useCallback(() => {
    setLoading(true)
    api.listConnections()
      .then(setConnections)
      .catch(() => setConnections([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadConnections() }, [loadConnections])

  const handleSave = async (body) => {
    if (modal?.mode === 'edit') {
      await api.updateConnection(modal.conn.id, body)
    } else {
      await api.createConnection(body)
    }
    setModal(null)
    loadConnections()
  }

  const handleDelete = async (conn) => {
    setDeleting(true)
    await api.deleteConnection(conn.id).catch(() => null)
    setDeleteTarget(null)
    setDeleting(false)
    loadConnections()
  }

  const handleTest = async (connId) => {
    const r = await api.testConnection(connId)
    loadConnections()
    return r
  }

  return (
    <div>
      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Settings</h2>
          <div style={{ fontSize: 13, color: theme.textDim, marginTop: 4 }}>
            Manage storage connections for data sources
          </div>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setModal({ mode: 'add' })}>
          Add Connection
        </Button>
      </div>

      {/* Connections section */}
      <div style={{ marginBottom: 8, fontSize: 11, color: theme.textDim, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600 }}>
        Storage Connections ({connections.length})
      </div>

      {loading ? (
        <div style={{ color: theme.textDim, fontSize: 13, padding: '40px 0', textAlign: 'center' }}>
          Loading connections…
        </div>
      ) : connections.length === 0 ? (
        <div
          style={{
            background: theme.bgCard, border: `1px dashed ${theme.border}`,
            borderRadius: 12, padding: '48px 24px', textAlign: 'center',
          }}
        >
          <Icon name="database" size={32} style={{ color: theme.textDim, marginBottom: 12 }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: theme.textMuted, marginBottom: 6 }}>
            No connections configured
          </div>
          <div style={{ fontSize: 12, color: theme.textDim, marginBottom: 20 }}>
            Add a storage connection to browse and auto-discover datasets in S3, GCS, SQL databases, Unity Catalog, or Kafka.
          </div>
          <Button variant="primary" icon="plus" onClick={() => setModal({ mode: 'add' })}>
            Add First Connection
          </Button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {connections.map((c) => (
            <ConnectionCard
              key={c.id}
              conn={c}
              onEdit={(conn) => setModal({ mode: 'edit', conn })}
              onDelete={setDeleteTarget}
              onTest={handleTest}
            />
          ))}
        </div>
      )}

      {/* Type reference */}
      <div style={{ marginTop: 32, padding: 20, background: theme.bgSurface, borderRadius: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: theme.textMuted, marginBottom: 12 }}>Supported Connection Types</div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {CONN_TYPES.map((ct) => (
            <div key={ct.value} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: ct.color }} />
              <span style={{ fontSize: 12, color: theme.textDim }}>{ct.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Add/Edit modal */}
      {modal && (
        <ConnectionModal
          connection={modal.conn}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <div
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1200,
          }}
        >
          <div style={{ background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12, padding: 28, maxWidth: 400, width: '90%' }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 10 }}>Delete Connection?</div>
            <div style={{ fontSize: 13, color: theme.textDim, marginBottom: 20 }}>
              <strong style={{ color: theme.text }}>{deleteTarget.name}</strong> will be permanently removed. Models using this connection path must be updated manually.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
              <Button
                variant="primary"
                onClick={() => handleDelete(deleteTarget)}
                disabled={deleting}
                style={{ background: theme.red, borderColor: theme.red }}
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
