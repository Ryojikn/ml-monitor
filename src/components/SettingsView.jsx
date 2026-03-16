/* ═══════════════════════════════════════════
   SettingsView — two-section left-rail layout
   ═══════════════════════════════════════════ */

import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import Icon from './Icon.jsx'
import { Button, Badge } from './ui.jsx'
import { theme } from '../utils/theme.js'
import { api } from '../api.js'

/* ═══════════════════════════════════════════
   Shared small helpers
   ═══════════════════════════════════════════ */

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 11, color: theme.textDim, textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600, marginBottom: 10 }}>
      {children}
    </div>
  )
}

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

/* ═══════════════════════════════════════════
   CONNECTIONS PANEL  (existing logic, extracted)
   ═══════════════════════════════════════════ */

const CONN_TYPES = [
  { value: 's3',            label: 'AWS S3',               icon: 'layers',   color: '#FF9900' },
  { value: 'gcs',           label: 'Google Cloud Storage', icon: 'database', color: '#4285F4' },
  { value: 'sql',           label: 'SQL Database',         icon: 'hash',     color: '#00ADEF' },
  { value: 'unity_catalog', label: 'Unity Catalog',        icon: 'box',      color: '#FF3621' },
]

const TYPE_META = Object.fromEntries(CONN_TYPES.map((t) => [t.value, t]))

const CONFIG_FIELDS = {
  s3: [
    { key: 'bucket',            label: 'Default Bucket',              placeholder: 'my-bucket' },
    { key: 'prefix',            label: 'Default Prefix',              placeholder: 'data/' },
    { key: 'region',            label: 'Region',                      placeholder: 'us-east-1' },
    { key: 'access_key_id',     label: 'Access Key ID',               placeholder: 'AKIA...' },
    { key: 'secret_access_key', label: 'Secret Access Key',           placeholder: '••••••••', secret: true },
    { key: 'endpoint_url',      label: 'Endpoint URL (MinIO / custom)',placeholder: 'http://localhost:9000' },
  ],
  gcs: [
    { key: 'bucket',          label: 'Default Bucket',      placeholder: 'my-bucket' },
    { key: 'prefix',          label: 'Default Prefix',      placeholder: 'data/' },
    { key: 'project',         label: 'Project ID',          placeholder: 'my-gcp-project' },
    { key: 'credentials_json',label: 'Service Account JSON',placeholder: '{"type":"service_account",...}', multiline: true, secret: true },
  ],
  sql: [
    { key: 'connection_string', label: 'Connection String', placeholder: 'postgresql://user:pass@host:5432/dbname', required: true },
    { key: 'schema',            label: 'Default Schema',    placeholder: 'public' },
  ],
  unity_catalog: [
    { key: 'workspace_url', label: 'Workspace URL',          placeholder: 'https://adb-xxx.azuredatabricks.net', required: true },
    { key: 'token',         label: 'Personal Access Token',  placeholder: 'dapi...', required: true, secret: true },
    { key: 'catalog',       label: 'Default Catalog',        placeholder: 'main' },
    { key: 'schema',        label: 'Default Schema',         placeholder: 'default' },
  ],
}

function ConnectionModal({ connection, onSave, onClose }) {
  const isEdit = !!connection?.id
  const [name, setName]               = useState(connection?.name ?? '')
  const [type, setType]               = useState(connection?.type ?? 's3')
  const [description, setDescription] = useState(connection?.description ?? '')
  const [config, setConfig]           = useState(connection?.config ?? {})
  const [saving, setSaving]           = useState(false)
  const [testing, setTesting]         = useState(false)
  const [testResult, setTestResult]   = useState(null)
  const [error, setError]             = useState(null)

  const setConf = (k, v) => setConfig((c) => ({ ...c, [k]: v }))

  const handleTest = async () => {
    if (!connection?.id) return
    setTesting(true); setTestResult(null)
    try { setTestResult(await api.testConnection(connection.id)) }
    finally { setTesting(false) }
  }

  const handleSave = async () => {
    setSaving(true); setError(null)
    try {
      await onSave({ name: name || 'Unnamed Connection', type, description: description || null, config })
    } catch (e) { setError(e.message); setSaving(false) }
  }

  const fields = CONFIG_FIELDS[type] ?? []

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 16, width: '90%', maxWidth: 560, maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ padding: '16px 24px', borderBottom: `1px solid ${theme.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>{isEdit ? 'Edit Connection' : 'Add Connection'}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: theme.textMuted, cursor: 'pointer' }}><Icon name="x" size={18} /></button>
        </div>
        <div style={{ padding: 24 }}>
          <Field label="Connection Name">
            <TextInput value={name} onChange={setName} placeholder="Production S3 Bucket" />
          </Field>
          <Field label="Connection Type">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {CONN_TYPES.map((ct) => (
                <button key={ct.value} onClick={() => { setType(ct.value); setConfig({}) }} style={{ padding: '6px 12px', borderRadius: 8, cursor: 'pointer', border: `2px solid ${type === ct.value ? ct.color : theme.border}`, background: type === ct.value ? ct.color + '18' : theme.bgInput, color: type === ct.value ? ct.color : theme.textMuted, fontSize: 12, fontWeight: 600, fontFamily: 'inherit', transition: 'all 0.15s' }}>
                  <Icon name={ct.icon} size={12} style={{ marginRight: 4, verticalAlign: -1 }} />{ct.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Description (optional)">
            <TextInput value={description} onChange={setDescription} placeholder="Brief description..." />
          </Field>
          {fields.length > 0 && (
            <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: 16, marginTop: 4 }}>
              <div style={{ fontSize: 11, color: theme.textDim, marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {TYPE_META[type]?.label} Configuration
              </div>
              {fields.map((f) => (
                <Field key={f.key} label={f.label + (f.required ? ' *' : '')}>
                  <TextInput value={config[f.key] ?? ''} onChange={(v) => setConf(f.key, v)} placeholder={f.placeholder} secret={f.secret} multiline={f.multiline} mono />
                </Field>
              ))}
            </div>
          )}
          {testResult && (
            <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 12, background: (testResult.ok ? theme.green : theme.red) + '18', border: `1px solid ${(testResult.ok ? theme.green : theme.red)}40`, color: testResult.ok ? theme.green : theme.red, fontSize: 12 }}>
              <Icon name={testResult.ok ? 'check' : 'x'} size={12} style={{ marginRight: 6 }} />{testResult.message}
            </div>
          )}
          {error && (
            <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 12, background: theme.red + '18', border: `1px solid ${theme.red}40`, color: theme.red, fontSize: 12 }}>{error}</div>
          )}
        </div>
        <div style={{ padding: '12px 24px 20px', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          {isEdit ? <Button variant="ghost" onClick={handleTest} disabled={testing}>{testing ? 'Testing…' : 'Test Connection'}</Button> : <div />}
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button variant="primary" onClick={handleSave} disabled={saving} icon="check">{saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Connection'}</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ConnectionCard({ conn, onEdit, onDelete, onTest }) {
  const meta = TYPE_META[conn.type] ?? { label: conn.type, icon: 'database', color: theme.accent }
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  const handleTest = async () => {
    setTesting(true); setTestResult(null)
    const r = await onTest(conn.id)
    setTestResult(r); setTesting(false)
  }

  return (
    <div style={{ background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12, padding: 16, display: 'flex', alignItems: 'flex-start', gap: 14 }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0, background: meta.color + '18', border: `1px solid ${meta.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: meta.color }}>
        <Icon name={meta.icon} size={18} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{conn.name}</span>
          <Badge style={{ background: meta.color + '18', color: meta.color, border: `1px solid ${meta.color}30` }}>{meta.label}</Badge>
          {conn.last_tested_at && (
            <Badge style={{ background: (conn.last_test_ok ? theme.green : theme.red) + '18', color: conn.last_test_ok ? theme.green : theme.red }}>
              {conn.last_test_ok ? 'OK' : 'Failed'}
            </Badge>
          )}
        </div>
        {conn.description && <div style={{ fontSize: 12, color: theme.textDim, marginTop: 4 }}>{conn.description}</div>}
        {testResult && (
          <div style={{ fontSize: 11, color: testResult.ok ? theme.green : theme.red, marginTop: 6 }}>
            <Icon name={testResult.ok ? 'check' : 'x'} size={11} style={{ marginRight: 4 }} />{testResult.message}
          </div>
        )}
        <div style={{ fontSize: 10, color: theme.textDim, marginTop: 6 }}>
          Added {new Date(conn.created_at).toLocaleDateString()}
          {conn.last_tested_at && ` · Tested ${new Date(conn.last_tested_at).toLocaleString()}`}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <Button variant="ghost" onClick={handleTest} disabled={testing} style={{ padding: '4px 10px', fontSize: 12 }}>{testing ? '…' : 'Test'}</Button>
        <Button variant="ghost" onClick={() => onEdit(conn)} style={{ padding: '4px 10px', fontSize: 12 }}><Icon name="edit" size={13} /></Button>
        <Button variant="ghost" onClick={() => onDelete(conn)} style={{ padding: '4px 10px', fontSize: 12, color: theme.red }}><Icon name="trash" size={13} /></Button>
      </div>
    </div>
  )
}

function ConnectionsPanel() {
  const [connections, setConnections] = useState([])
  const [loading, setLoading]         = useState(true)
  const [modal, setModal]             = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleting, setDeleting]       = useState(false)

  const loadConnections = useCallback(() => {
    setLoading(true)
    api.listConnections().then(setConnections).catch(() => setConnections([])).finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadConnections() }, [loadConnections])

  const handleSave = async (body) => {
    if (modal?.mode === 'edit') await api.updateConnection(modal.conn.id, body)
    else await api.createConnection(body)
    toast.success(modal?.mode === 'edit' ? 'Connection updated' : 'Connection created', { duration: 2000 })
    setModal(null); loadConnections()
  }

  const handleDelete = async (conn) => {
    setDeleting(true)
    await api.deleteConnection(conn.id).catch(() => null)
    setDeleteTarget(null); setDeleting(false); loadConnections()
  }

  const handleTest = async (connId) => {
    const r = await api.testConnection(connId)
    loadConnections(); return r
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Storage Connections</h3>
          <div style={{ fontSize: 13, color: theme.textDim, marginTop: 3 }}>Connect to data sources where your model inputs and outputs are stored.</div>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setModal({ mode: 'add' })}>Add Connection</Button>
      </div>

      <SectionLabel>Connections ({connections.length})</SectionLabel>

      {loading ? (
        <div style={{ color: theme.textDim, fontSize: 13, padding: '32px 0', textAlign: 'center' }}>Loading connections…</div>
      ) : connections.length === 0 ? (
        <div style={{ background: theme.bgCard, border: `1px dashed ${theme.border}`, borderRadius: 12, padding: '40px 24px', textAlign: 'center' }}>
          <Icon name="database" size={28} style={{ color: theme.textDim, marginBottom: 10 }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: theme.textMuted, marginBottom: 6 }}>No connections configured</div>
          <div style={{ fontSize: 12, color: theme.textDim, marginBottom: 18 }}>
            Connect S3, GCS, SQL databases, or Unity Catalog to browse and auto-discover datasets.
          </div>
          <Button variant="primary" icon="plus" onClick={() => setModal({ mode: 'add' })}>Add First Connection</Button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {connections.map((c) => (
            <ConnectionCard key={c.id} conn={c} onEdit={(conn) => setModal({ mode: 'edit', conn })} onDelete={setDeleteTarget} onTest={handleTest} />
          ))}
        </div>
      )}

      {/* Supported types strip */}
      <div style={{ marginTop: 28, padding: '14px 18px', background: theme.bgSurface, borderRadius: 10, display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 11, color: theme.textDim, fontWeight: 600 }}>Supported:</span>
        {CONN_TYPES.map((ct) => (
          <div key={ct.value} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: ct.color }} />
            <span style={{ fontSize: 12, color: theme.textDim }}>{ct.label}</span>
          </div>
        ))}
      </div>

      {modal && <ConnectionModal connection={modal.conn} onSave={handleSave} onClose={() => setModal(null)} />}

      {deleteTarget && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200 }}>
          <div style={{ background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12, padding: 28, maxWidth: 400, width: '90%' }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 10 }}>Delete Connection?</div>
            <div style={{ fontSize: 13, color: theme.textDim, marginBottom: 20 }}>
              <strong style={{ color: theme.text }}>{deleteTarget.name}</strong> will be permanently removed. Models using this connection must be updated manually.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
              <Button variant="primary" onClick={() => handleDelete(deleteTarget)} disabled={deleting} style={{ background: theme.red, borderColor: theme.red }}>
                {deleting ? 'Deleting…' : 'Delete'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════
   DATA ACCESS PANEL
   ═══════════════════════════════════════════ */

const CODE_SNIPPET = `# Install the SDK
pip install mlmonitor-sdk

# Configure once (e.g., in your model serving script)
import mlmonitor as mlm
mlm.init(
    api_key="mlm_your_key_here",
    base_url="http://localhost:8000",
)

# Log a prediction
mlm.log(
    model_id="your-model-id",
    features={"age": 34, "income": 72000, "tenure": 18},
    prediction=0.87,
    prediction_label="high_risk",
)

# Log ground truth when available
mlm.log_actuals(
    model_id="your-model-id",
    record_ids=["rec_001", "rec_002"],
    actuals=[1, 0],
)`

function CodeBlock({ code }) {
  const [copied, setCopied] = useState(false)

  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }

  return (
    <div style={{ position: 'relative', background: '#0d0d0d', border: `1px solid ${theme.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <button
        onClick={copy}
        style={{
          position: 'absolute', top: 10, right: 10,
          background: copied ? theme.green + '22' : theme.bgCard,
          border: `1px solid ${copied ? theme.green + '44' : theme.border}`,
          borderRadius: 6, padding: '3px 10px', fontSize: 11,
          color: copied ? theme.green : theme.textDim,
          cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
        }}
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
      <pre style={{ margin: 0, padding: '16px 18px', fontSize: 12, lineHeight: 1.65, color: '#c9d1d9', fontFamily: 'var(--font-mono)', overflowX: 'auto' }}>
        {code}
      </pre>
    </div>
  )
}

function EnvBlock() {
  return (
    <div style={{ background: theme.bgSurface, border: `1px solid ${theme.border}`, borderRadius: 10, padding: '12px 16px', fontFamily: 'var(--font-mono)', fontSize: 12, color: theme.textMuted, lineHeight: 2 }}>
      <span style={{ color: theme.textDim }}>MLMONITOR_API_KEY</span>=mlm_your_key_here<br />
      <span style={{ color: theme.textDim }}>MLMONITOR_BASE_URL</span>=http://localhost:8000
    </div>
  )
}

function CreateKeyModal({ onCreated, onClose }) {
  const [name, setName]           = useState('')
  const [saving, setSaving]       = useState(false)
  const [createdKey, setCreatedKey] = useState(null)
  const [copied, setCopied]       = useState(false)
  const [error, setError]         = useState(null)

  const handleCreate = async () => {
    if (!name.trim()) return
    setSaving(true); setError(null)
    try {
      const result = await api.createApiKey({ name: name.trim() })
      setCreatedKey(result)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const copyKey = () => {
    navigator.clipboard.writeText(createdKey.full_key).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }

  const handleDone = () => {
    onCreated()
    onClose()
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{ background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 16, width: '90%', maxWidth: 480 }}>
        {/* Header */}
        <div style={{ padding: '16px 24px', borderBottom: `1px solid ${theme.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 700, fontSize: 16 }}>{createdKey ? 'API Key Created' : 'Create API Key'}</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: theme.textMuted, cursor: 'pointer' }}><Icon name="x" size={18} /></button>
        </div>

        <div style={{ padding: 24 }}>
          {!createdKey ? (
            <>
              <Field label="Key Name" hint="Give it a descriptive name, e.g. 'production-scorer' or 'dev-laptop'">
                <TextInput
                  value={name}
                  onChange={setName}
                  placeholder="e.g. production-scorer"
                />
              </Field>
              {error && <div style={{ padding: '10px 14px', borderRadius: 8, marginBottom: 12, background: theme.red + '18', border: `1px solid ${theme.red}40`, color: theme.red, fontSize: 12 }}>{error}</div>}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
                <Button variant="primary" onClick={handleCreate} disabled={saving || !name.trim()} icon="key">
                  {saving ? 'Creating…' : 'Create Key'}
                </Button>
              </div>
            </>
          ) : (
            <>
              {/* Warning */}
              <div style={{ display: 'flex', gap: 10, padding: '10px 14px', borderRadius: 8, marginBottom: 18, background: theme.yellow + '14', border: `1px solid ${theme.yellow}30` }}>
                <Icon name="alert-triangle" size={14} style={{ color: theme.yellow, flexShrink: 0, marginTop: 1 }} />
                <span style={{ fontSize: 12, color: theme.textMuted }}>
                  Copy this key now — it <strong style={{ color: theme.text }}>will not be shown again</strong>.
                </span>
              </div>

              {/* Key display */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 18 }}>
                <div style={{
                  flex: 1, background: theme.bgSurface, border: `1px solid ${theme.border}`,
                  borderRadius: 8, padding: '10px 14px', fontFamily: 'var(--font-mono)',
                  fontSize: 13, color: theme.text, wordBreak: 'break-all',
                }}>
                  {createdKey.full_key}
                </div>
                <button
                  onClick={copyKey}
                  style={{
                    flexShrink: 0, padding: '10px 14px', borderRadius: 8,
                    background: copied ? theme.green + '22' : theme.bgInput,
                    border: `1px solid ${copied ? theme.green + '44' : theme.border}`,
                    color: copied ? theme.green : theme.textMuted,
                    cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', transition: 'all 0.15s',
                  }}
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button variant="primary" onClick={handleDone} icon="check">Done</Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function DataAccessPanel() {
  const [keys, setKeys]           = useState([])
  const [loading, setLoading]     = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [revoking, setRevoking]   = useState(null)

  const loadKeys = useCallback(() => {
    setLoading(true)
    api.listApiKeys().then(setKeys).catch(() => setKeys([])).finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadKeys() }, [loadKeys])

  const handleRevoke = async (id) => {
    setRevoking(id)
    await api.revokeApiKey(id).catch(() => null)
    setRevoking(null); loadKeys()
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Data Access</h3>
        <div style={{ fontSize: 13, color: theme.textDim, marginTop: 3 }}>
          Generate API keys to push predictions, features, and ground truth from your model serving infrastructure.
        </div>
      </div>

      {/* ── API Keys section ── */}
      <div style={{ background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 12, marginBottom: 24, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: `1px solid ${theme.border}` }}>
          <SectionLabel>API Keys ({keys.length})</SectionLabel>
          <Button variant="primary" icon="plus" onClick={() => setShowModal(true)} style={{ padding: '5px 12px', fontSize: 12 }}>
            Create API Key
          </Button>
        </div>

        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: theme.textDim, fontSize: 13 }}>Loading keys…</div>
        ) : keys.length === 0 ? (
          <div style={{ padding: '28px 24px', textAlign: 'center' }}>
            <Icon name="key" size={24} style={{ color: theme.textDim, marginBottom: 8 }} />
            <div style={{ fontSize: 13, fontWeight: 600, color: theme.textMuted, marginBottom: 4 }}>No API keys yet</div>
            <div style={{ fontSize: 12, color: theme.textDim }}>Create a key to start pushing data from your model serving code.</div>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${theme.border}` }}>
                {['Name', 'Key Prefix', 'Created', 'Last Used', ''].map((h) => (
                  <th key={h} style={{ padding: '8px 16px', textAlign: 'left', color: theme.textDim, fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} style={{ borderBottom: `1px solid ${theme.border}08` }}>
                  <td style={{ padding: '10px 16px', fontWeight: 600, color: theme.text }}>{k.name}</td>
                  <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 11, color: theme.textMuted }}>
                    <span style={{ background: theme.bgSurface, border: `1px solid ${theme.border}`, borderRadius: 5, padding: '2px 8px' }}>
                      {k.key_prefix}…
                    </span>
                  </td>
                  <td style={{ padding: '10px 16px', color: theme.textDim }}>{new Date(k.created_at).toLocaleDateString()}</td>
                  <td style={{ padding: '10px 16px', color: theme.textDim }}>{k.last_used_at ? new Date(k.last_used_at).toLocaleString() : '—'}</td>
                  <td style={{ padding: '10px 16px', textAlign: 'right' }}>
                    <button
                      onClick={() => handleRevoke(k.id)}
                      disabled={revoking === k.id}
                      style={{ background: theme.red + '12', border: `1px solid ${theme.red}30`, borderRadius: 6, padding: '3px 10px', fontSize: 11, color: theme.red, cursor: revoking === k.id ? 'default' : 'pointer', fontFamily: 'inherit', opacity: revoking === k.id ? 0.5 : 1 }}
                    >
                      {revoking === k.id ? 'Revoking…' : 'Revoke'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Quick Start ── */}
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <SectionLabel>Quick Start — Python SDK</SectionLabel>
        </div>
        <CodeBlock code={CODE_SNIPPET} />
      </div>

      {/* ── Env vars ── */}
      <div style={{ marginTop: 16 }}>
        <SectionLabel>Environment Variables</SectionLabel>
        <EnvBlock />
        <div style={{ fontSize: 11, color: theme.textDim, marginTop: 6 }}>
          Set these in your model serving environment to configure the SDK without hardcoding credentials.
        </div>
      </div>

      {showModal && <CreateKeyModal onCreated={loadKeys} onClose={() => setShowModal(false)} />}
    </div>
  )
}

/* ═══════════════════════════════════════════
   NOTIFICATIONS PANEL
   ═══════════════════════════════════════════ */

const CHANNEL_DEFS = [
  {
    type: 'slack',
    label: 'Slack',
    icon: 'slack',
    color: '#4A154B',
    description: 'Send alerts to a Slack channel via Incoming Webhook.',
    fields: [
      { key: 'webhook_url', label: 'Webhook URL',           placeholder: 'https://hooks.slack.com/services/…', required: true, secret: true },
      { key: 'channel',     label: 'Channel (optional)',    placeholder: '#ml-alerts' },
      { key: 'username',    label: 'Bot name (optional)',   placeholder: 'MLMonitor' },
    ],
  },
  {
    type: 'pagerduty',
    label: 'PagerDuty',
    icon: 'alert-triangle',
    color: '#06AC38',
    description: 'Create PagerDuty incidents from critical model alerts.',
    fields: [
      { key: 'integration_key', label: 'Integration Key (Events API v2)', placeholder: 'abc123…', required: true, secret: true },
    ],
  },
  {
    type: 'email',
    label: 'Email',
    icon: 'mail',
    color: '#3B82F6',
    description: 'Send alert emails via SMTP.',
    fields: [
      { key: 'recipients', label: 'Recipients (comma-separated)', placeholder: 'oncall@company.com, team@company.com', required: true },
      { key: 'smtp_host',  label: 'SMTP Host',                   placeholder: 'smtp.gmail.com', required: true },
      { key: 'smtp_port',  label: 'SMTP Port',                   placeholder: '587' },
      { key: 'smtp_user',  label: 'SMTP Username',               placeholder: 'alerts@company.com' },
      { key: 'smtp_pass',  label: 'SMTP Password',               placeholder: '••••••••', secret: true },
      { key: 'from_addr',  label: 'From Address',                placeholder: 'MLMonitor <alerts@company.com>' },
    ],
  },
]

/* Pill-style toggle switch */
function Toggle({ on, onChange }) {
  return (
    <button
      onClick={() => onChange(!on)}
      style={{
        position: 'relative', width: 40, height: 22, borderRadius: 11,
        background: on ? theme.accent : theme.bgInput,
        border: `1px solid ${on ? theme.accent : theme.border}`,
        cursor: 'pointer', transition: 'all 0.2s', flexShrink: 0,
        padding: 0,
      }}
    >
      <span style={{
        position: 'absolute', top: 2,
        left: on ? 19 : 2,
        width: 16, height: 16, borderRadius: '50%',
        background: on ? '#000' : theme.textDim,
        transition: 'left 0.2s',
        display: 'block',
      }} />
    </button>
  )
}

function maskUrl(url) {
  try {
    const u = new URL(url)
    return `${u.protocol}//${u.hostname}/••••••••`
  } catch {
    return '••••••••'
  }
}

function IntegrationCard({ def, record, onRefresh }) {
  // record: existing NotificationChannel from DB, or null
  const enabled = record?.enabled ?? false

  // For secret fields with a saved value, start with empty local state
  // so the real value is never shown — track which are in "change" mode
  const [config, setConfig] = useState(() => {
    const base = record?.config ?? {}
    const c = { ...base }
    if (record) {
      def.fields.filter((f) => f.secret && c[f.key]).forEach((f) => { c[f.key] = '' })
    }
    return c
  })
  const [changingFields, setChangingFields] = useState(new Set())
  const [saving, setSaving]   = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [error, setError] = useState(null)

  const setConf = (k, v) => setConfig((c) => ({ ...c, [k]: v }))

  const startChanging = (key) => {
    setChangingFields((s) => new Set([...s, key]))
    setConf(key, '')
  }

  const handleToggle = async (next) => {
    setSaving(true)
    try {
      if (!record) {
        await api.createNotification({ type: def.type, name: def.label, config, enabled: next })
      } else {
        await api.updateNotification(record.id, { enabled: next })
      }
      toast.success(`${def.label} ${next ? 'enabled' : 'disabled'}`, { duration: 1500 })
      onRefresh()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  const handleSave = async () => {
    setSaving(true); setError(null)
    try {
      // Build config to send: for secret fields not being changed, keep the backend value
      const configToSend = { ...config }
      if (record) {
        def.fields.filter((f) => f.secret && !changingFields.has(f.key)).forEach((f) => {
          if (record.config?.[f.key]) configToSend[f.key] = record.config[f.key]
        })
      }
      if (!record) {
        await api.createNotification({ type: def.type, name: def.label, config: configToSend, enabled: true })
      } else {
        await api.updateNotification(record.id, { config: configToSend, enabled: true })
      }
      toast.success(`${def.label} configuration saved`, { duration: 2000 })
      setChangingFields(new Set())
      onRefresh()
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  const handleTest = async () => {
    if (!record) return
    setTesting(true); setTestResult(null)
    try {
      const r = await api.testNotification(record.id)
      setTestResult(r)
      onRefresh()
    } catch (e) { setTestResult({ ok: false, message: e.message }) }
    finally { setTesting(false) }
  }

  return (
    <div style={{
      background: theme.bgCard, border: `1px solid ${enabled ? def.color + '40' : theme.border}`,
      borderRadius: 12, overflow: 'hidden', transition: 'border-color 0.2s',
    }}>
      {/* Card header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px' }}>
        <div style={{
          width: 36, height: 36, borderRadius: 9, flexShrink: 0,
          background: def.color + '18', border: `1px solid ${def.color}30`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: def.color,
        }}>
          <Icon name={def.icon} size={16} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: theme.text }}>{def.label}</div>
          <div style={{ fontSize: 11, color: theme.textDim, marginTop: 1 }}>{def.description}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {record?.last_tested_at && (
            <span style={{ fontSize: 10, color: record.last_test_ok ? theme.green : theme.red, fontWeight: 600 }}>
              {record.last_test_ok ? '✓ OK' : '✗ Failed'}
            </span>
          )}
          <span style={{ fontSize: 11, color: enabled ? theme.accent : theme.textDim, fontWeight: 600 }}>
            {enabled ? 'Enabled' : 'Disabled'}
          </span>
          <Toggle on={enabled} onChange={handleToggle} />
        </div>
      </div>

      {/* Expanded body — only when enabled */}
      {enabled && (
        <div style={{ padding: '0 18px 18px', borderTop: `1px solid ${theme.border}` }}>
          <div style={{ height: 14 }} />
          {def.fields.map((f) => {
            const hasSavedValue = f.secret && record?.config?.[f.key]
            const isChanging = changingFields.has(f.key)
            return (
              <Field key={f.key} label={f.label + (f.required ? ' *' : '')}>
                {hasSavedValue && !isChanging ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: theme.textDim, letterSpacing: 3 }}>
                      ••••••••
                    </span>
                    <button
                      onClick={() => startChanging(f.key)}
                      style={{ background: 'none', border: `1px solid ${theme.border}`, borderRadius: 5, padding: '2px 8px', fontSize: 11, color: theme.textMuted, cursor: 'pointer', fontFamily: 'inherit' }}
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <TextInput
                    value={config[f.key] ?? ''}
                    onChange={(v) => setConf(f.key, v)}
                    placeholder={isChanging ? 'Enter new value…' : f.placeholder}
                    secret={f.secret}
                    mono={f.secret}
                  />
                )}
              </Field>
            )
          })}

          {testResult && (
            <div style={{
              padding: '8px 12px', borderRadius: 8, marginBottom: 12,
              background: (testResult.ok ? theme.green : theme.red) + '15',
              border: `1px solid ${(testResult.ok ? theme.green : theme.red)}35`,
              color: testResult.ok ? theme.green : theme.red, fontSize: 12,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <Icon name={testResult.ok ? 'check-circle' : 'x'} size={12} />
              {testResult.message}
            </div>
          )}

          {error && (
            <div style={{ padding: '8px 12px', borderRadius: 8, marginBottom: 12, background: theme.red + '15', border: `1px solid ${theme.red}35`, color: theme.red, fontSize: 12 }}>{error}</div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            {record && (
              <Button variant="ghost" onClick={handleTest} disabled={testing} style={{ fontSize: 12 }}>
                {testing ? 'Testing…' : 'Test'}
              </Button>
            )}
            <Button variant="primary" onClick={handleSave} disabled={saving} icon="check" style={{ fontSize: 12 }}>
              {saving ? 'Saving…' : 'Save Changes'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function AddWebhookForm({ onSave, onCancel }) {
  const [name, setName]   = useState('')
  const [url, setUrl]     = useState('')
  const [headerName, setHeaderName]   = useState('')
  const [headerValue, setHeaderValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)

  const handleSave = async () => {
    if (!name.trim() || !url.trim()) return
    setSaving(true); setError(null)
    try {
      await api.createNotification({
        type: 'webhook',
        name: name.trim(),
        config: { url: url.trim(), secret_header_name: headerName.trim(), secret_header_value: headerValue.trim() },
        enabled: true,
      })
      toast.success('Webhook added', { duration: 2000 })
      onSave()
    } catch (e) { setError(e.message); setSaving(false) }
  }

  return (
    <div style={{ background: theme.bgSurface, border: `1px solid ${theme.border}`, borderRadius: 10, padding: 16, marginBottom: 10 }}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 140px' }}>
          <Field label="Name *">
            <TextInput value={name} onChange={setName} placeholder="prod-alerter" />
          </Field>
        </div>
        <div style={{ flex: '3 1 260px' }}>
          <Field label="URL *">
            <TextInput value={url} onChange={setUrl} placeholder="https://api.example.com/hooks/mlmonitor" mono />
          </Field>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 140px' }}>
          <Field label="Secret header name (optional)">
            <TextInput value={headerName} onChange={setHeaderName} placeholder="X-Secret-Token" mono />
          </Field>
        </div>
        <div style={{ flex: '2 1 200px' }}>
          <Field label="Secret header value (optional)">
            <TextInput value={headerValue} onChange={setHeaderValue} placeholder="••••••••" secret />
          </Field>
        </div>
      </div>
      {error && <div style={{ color: theme.red, fontSize: 12, marginBottom: 8 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={onCancel} disabled={saving} style={{ fontSize: 12 }}>Cancel</Button>
        <Button variant="primary" onClick={handleSave} disabled={saving || !name.trim() || !url.trim()} icon="link" style={{ fontSize: 12 }}>
          {saving ? 'Adding…' : 'Add Webhook'}
        </Button>
      </div>
    </div>
  )
}

function NotificationsPanel() {
  const [channels, setChannels] = useState([])
  const [loading, setLoading]   = useState(true)
  const [showAddWebhook, setShowAddWebhook] = useState(false)
  const [testingId, setTestingId] = useState(null)
  const [deletingId, setDeletingId] = useState(null)

  const loadChannels = useCallback(() => {
    setLoading(true)
    api.listNotifications().then(setChannels).catch(() => setChannels([])).finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadChannels() }, [loadChannels])

  const fixedChannels = CHANNEL_DEFS.map((def) => ({
    def,
    record: channels.find((c) => c.type === def.type) ?? null,
  }))

  const webhooks = channels.filter((c) => c.type === 'webhook')

  const handleTestWebhook = async (id) => {
    setTestingId(id); await api.testNotification(id).catch(() => null); setTestingId(null); loadChannels()
  }

  const handleDeleteWebhook = async (id) => {
    setDeletingId(id); await api.deleteNotification(id).catch(() => null); setDeletingId(null); loadChannels()
  }

  if (loading) return <div style={{ color: theme.textDim, fontSize: 13, padding: '32px 0', textAlign: 'center' }}>Loading…</div>

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Notifications</h3>
        <div style={{ fontSize: 13, color: theme.textDim, marginTop: 3 }}>
          Configure where MLMonitor sends alerts when drift or performance thresholds are breached.
        </div>
      </div>

      {/* Integration cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 32 }}>
        {fixedChannels.map(({ def, record }) => (
          <IntegrationCard key={def.type} def={def} record={record} onRefresh={loadChannels} />
        ))}
      </div>

      {/* Custom Webhooks */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <SectionLabel>Custom Webhooks ({webhooks.length})</SectionLabel>
        {!showAddWebhook && (
          <Button variant="ghost" icon="plus" onClick={() => setShowAddWebhook(true)} style={{ padding: '4px 10px', fontSize: 12 }}>
            Add Webhook
          </Button>
        )}
      </div>

      {showAddWebhook && (
        <AddWebhookForm onSave={() => { setShowAddWebhook(false); loadChannels() }} onCancel={() => setShowAddWebhook(false)} />
      )}

      {webhooks.length === 0 && !showAddWebhook ? (
        <div style={{ background: theme.bgCard, border: `1px dashed ${theme.border}`, borderRadius: 10, padding: '24px', textAlign: 'center' }}>
          <div style={{ fontSize: 12, color: theme.textDim }}>No custom webhooks configured. Add one to forward alerts to any HTTP endpoint.</div>
        </div>
      ) : (
        <div style={{ background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 10, overflow: 'hidden' }}>
          {webhooks.map((wh, i) => (
            <div
              key={wh.id}
              style={{
                display: 'grid', gridTemplateColumns: '1fr 2fr auto auto auto',
                padding: '10px 16px', alignItems: 'center', gap: 12,
                borderBottom: i < webhooks.length - 1 ? `1px solid ${theme.border}08` : 'none',
                fontSize: 12,
              }}
            >
              <span style={{ fontWeight: 600, color: theme.text }}>{wh.name}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: theme.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {wh.config?.url ? maskUrl(wh.config.url) : '—'}
              </span>
              {wh.last_tested_at ? (
                <span style={{ fontSize: 10, fontWeight: 600, color: wh.last_test_ok ? theme.green : theme.red }}>
                  {wh.last_test_ok ? '✓ OK' : '✗ Failed'}
                </span>
              ) : <span style={{ fontSize: 10, color: theme.textDim }}>—</span>}
              <button
                onClick={() => handleTestWebhook(wh.id)}
                disabled={testingId === wh.id}
                style={{ background: theme.bgInput, border: `1px solid ${theme.border}`, borderRadius: 5, padding: '3px 8px', fontSize: 10, color: theme.textMuted, cursor: 'pointer', fontFamily: 'inherit', opacity: testingId === wh.id ? 0.5 : 1 }}
              >
                {testingId === wh.id ? '…' : 'Test'}
              </button>
              <button
                onClick={() => handleDeleteWebhook(wh.id)}
                disabled={deletingId === wh.id}
                style={{ background: 'none', border: 'none', color: theme.red, cursor: 'pointer', padding: '3px 6px', opacity: deletingId === wh.id ? 0.5 : 1 }}
              >
                <Icon name="x" size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════
   USERS & TEAMS PANEL
   ═══════════════════════════════════════════ */

const ROLES = [
  { value: 'can_review', label: 'Can Review',  color: '#6366f1' },
  { value: 'can_edit',   label: 'Can Edit',    color: '#22c55e' },
  { value: 'can_manage', label: 'Can Manage',  color: '#f59e0b' },
  { value: 'can_admin',  label: 'Can Admin',   color: '#ef4444' },
]

const ROLE_META = Object.fromEntries(ROLES.map((r) => [r.value, r]))

const EXTERNAL_SOURCES = [
  { value: '', label: 'None (manual)' },
  { value: 'okta', label: 'Okta' },
  { value: 'azure_ad', label: 'Azure AD' },
  { value: 'google', label: 'Google Workspace' },
  { value: 'ldap', label: 'LDAP' },
]

function avatarInitials(name) {
  if (!name) return '?'
  return name.split(/[\s._-]+/).map((p) => p[0]?.toUpperCase()).filter(Boolean).slice(0, 2).join('')
}

function Avatar({ name, size = 30 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: theme.accent + '22', border: `1px solid ${theme.accent}40`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.35, fontWeight: 700, color: theme.accent,
    }}>
      {avatarInitials(name)}
    </div>
  )
}

function RoleBadge({ role }) {
  const meta = ROLE_META[role] ?? { label: role, color: theme.textDim }
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
      background: meta.color + '20', color: meta.color,
    }}>
      {meta.label}
    </span>
  )
}

// ── Team modal (create / edit) ─────────────────────────────────────────────

function TeamModal({ team, onSave, onClose }) {
  const [name, setName]     = useState(team?.name ?? '')
  const [desc, setDesc]     = useState(team?.description ?? '')
  const [extId, setExtId]   = useState(team?.external_id ?? '')
  const [extSrc, setExtSrc] = useState(team?.external_source ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState(null)

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true); setError(null)
    try {
      const body = {
        name: name.trim(),
        description: desc.trim() || null,
        external_id: extId.trim() || null,
        external_source: extSrc || null,
      }
      if (team) {
        await api.updateTeam(team.id, body)
        toast.success('Team updated')
      } else {
        await api.createTeam(body)
        toast.success('Team created')
      }
      onSave()
    } catch (e) { setError(e.message); setSaving(false) }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: '#00000066', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 14, padding: 28, width: 460, boxShadow: '0 8px 40px #0008' }}>
        <h3 style={{ margin: '0 0 20px', fontSize: 16, fontWeight: 700 }}>{team ? 'Edit Team' : 'New Team'}</h3>
        <Field label="Team Name *">
          <TextInput value={name} onChange={setName} placeholder="ML Platform" />
        </Field>
        <Field label="Description">
          <TextInput value={desc} onChange={setDesc} placeholder="Optional description" multiline />
        </Field>
        <SectionLabel>External Identity Provider (optional)</SectionLabel>
        <Field label="Source">
          <select
            value={extSrc}
            onChange={(e) => setExtSrc(e.target.value)}
            style={{ width: '100%', padding: '8px 12px', background: theme.bgInput, border: `1px solid ${theme.border}`, borderRadius: 8, color: theme.text, fontSize: 13, fontFamily: 'inherit' }}
          >
            {EXTERNAL_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
        {extSrc && (
          <Field label="External Group ID" hint="The group/team ID from your IdP">
            <TextInput value={extId} onChange={setExtId} placeholder="group_abc123" mono />
          </Field>
        )}
        {error && <div style={{ color: theme.red, fontSize: 12, marginBottom: 10 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <Button variant="ghost" onClick={onClose} disabled={saving} style={{ fontSize: 12 }}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving || !name.trim()} icon="check" style={{ fontSize: 12 }}>
            {saving ? 'Saving…' : team ? 'Save Changes' : 'Create Team'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Team members modal ─────────────────────────────────────────────────────

function TeamMembersModal({ team, users, onClose, onRefresh }) {
  const [members, setMembers]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [addUserId, setAddUserId]     = useState('')
  const [addSearch, setAddSearch]     = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [addRole, setAddRole]         = useState('can_edit')
  const [adding, setAdding]           = useState(false)
  const [error, setError]             = useState(null)
  const [updatingId, setUpdatingId]   = useState(null)
  const [removingId, setRemovingId]   = useState(null)

  const loadMembers = useCallback(() => {
    setLoading(true)
    api.getTeamWithMembers(team.id).then((t) => setMembers(t.members ?? [])).finally(() => setLoading(false))
  }, [team.id])

  useEffect(() => { loadMembers() }, [loadMembers])

  const eligibleUsers = users.filter(
    (u) => u.is_active && !members.some((m) => m.user_id === u.id)
  )

  const suggestions = addSearch.trim()
    ? eligibleUsers.filter((u) =>
        u.display_name.toLowerCase().includes(addSearch.toLowerCase()) ||
        u.email.toLowerCase().includes(addSearch.toLowerCase())
      )
    : eligibleUsers

  const handleSearchChange = (val) => {
    setAddSearch(val)
    setAddUserId('')
    setShowSuggestions(true)
  }

  const handleSelectUser = (u) => {
    setAddUserId(u.id)
    setAddSearch(`${u.display_name} (${u.email})`)
    setShowSuggestions(false)
  }

  const handleAdd = async () => {
    if (!addUserId) return
    setAdding(true); setError(null)
    try {
      await api.addTeamMember(team.id, { user_id: addUserId, role: addRole })
      toast.success('Member added')
      setAddUserId(''); setAddSearch('')
      loadMembers(); onRefresh()
    } catch (e) { setError(e.message) }
    finally { setAdding(false) }
  }

  const handleRoleChange = async (userId, role) => {
    setUpdatingId(userId)
    try {
      await api.updateTeamMember(team.id, userId, { role })
      loadMembers()
    } catch (e) { toast.error(e.message) }
    finally { setUpdatingId(null) }
  }

  const handleRemove = async (userId) => {
    setRemovingId(userId)
    try {
      await api.removeTeamMember(team.id, userId)
      toast.success('Member removed')
      loadMembers(); onRefresh()
    } catch (e) { toast.error(e.message) }
    finally { setRemovingId(null) }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: '#00000066', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 14, padding: 28, width: 560, maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 8px 40px #0008' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{team.name} — Members</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: theme.textDim, cursor: 'pointer', padding: 4 }}>
            <Icon name="x" size={16} />
          </button>
        </div>

        {/* Members list */}
        <div style={{ flex: 1, overflowY: 'auto', marginBottom: 16 }}>
          {loading ? (
            <div style={{ color: theme.textDim, fontSize: 13, padding: '20px 0', textAlign: 'center' }}>Loading…</div>
          ) : members.length === 0 ? (
            <div style={{ color: theme.textDim, fontSize: 13, padding: '20px 0', textAlign: 'center' }}>No members yet.</div>
          ) : members.map((m) => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${theme.border}10` }}>
              <Avatar name={m.user.display_name} size={28} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: theme.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.user.display_name}</div>
                <div style={{ fontSize: 11, color: theme.textDim }}>{m.user.email}</div>
              </div>
              <select
                value={m.role}
                disabled={updatingId === m.user_id}
                onChange={(e) => handleRoleChange(m.user_id, e.target.value)}
                style={{ background: theme.bgInput, border: `1px solid ${theme.border}`, borderRadius: 6, color: theme.text, fontSize: 11, padding: '3px 6px', fontFamily: 'inherit' }}
              >
                {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              <button
                onClick={() => handleRemove(m.user_id)}
                disabled={removingId === m.user_id}
                style={{ background: 'none', border: 'none', color: theme.red, cursor: 'pointer', padding: 4, opacity: removingId === m.user_id ? 0.4 : 1 }}
              >
                <Icon name="x" size={13} />
              </button>
            </div>
          ))}
        </div>

        {/* Add member row */}
        <div>
          <SectionLabel>Add Member</SectionLabel>
          {eligibleUsers.length === 0 ? (
            <div style={{ fontSize: 12, color: theme.textDim, padding: '10px 0' }}>
              No available users. Create users first in the <strong>Users</strong> tab.
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ flex: 2, minWidth: 160, position: 'relative' }}>
                <Field label="Search user">
                  <input
                    value={addSearch}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    onFocus={() => setShowSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                    placeholder="Name or email…"
                    style={{ width: '100%', padding: '8px 10px', background: theme.bgInput, border: `1px solid ${addUserId ? theme.accent : theme.border}`, borderRadius: 8, color: theme.text, fontSize: 13, fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none' }}
                  />
                  {showSuggestions && suggestions.length > 0 && (
                    <div style={{
                      position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 300,
                      background: theme.bgCard, border: `1px solid ${theme.border}`,
                      borderRadius: 8, boxShadow: '0 4px 20px #0006',
                      maxHeight: 200, overflowY: 'auto', marginTop: 2,
                    }}>
                      {suggestions.map((u) => (
                        <div
                          key={u.id}
                          onMouseDown={() => handleSelectUser(u)}
                          style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: `1px solid ${theme.border}10` }}
                          onMouseEnter={(e) => e.currentTarget.style.background = theme.bgInput}
                          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        >
                          <div style={{ fontSize: 13, fontWeight: 500, color: theme.text }}>{u.display_name}</div>
                          <div style={{ fontSize: 11, color: theme.textDim }}>{u.email}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {showSuggestions && addSearch.trim() && suggestions.length === 0 && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 300, background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 8, padding: '10px 12px', marginTop: 2, fontSize: 12, color: theme.textDim }}>
                      No matching users
                    </div>
                  )}
                </Field>
              </div>
              <div style={{ flex: 1, minWidth: 120 }}>
                <Field label="Role">
                  <select
                    value={addRole}
                    onChange={(e) => setAddRole(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', background: theme.bgInput, border: `1px solid ${theme.border}`, borderRadius: 8, color: theme.text, fontSize: 13, fontFamily: 'inherit' }}
                  >
                    {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </Field>
              </div>
              <div style={{ paddingBottom: 14 }}>
                <Button variant="primary" onClick={handleAdd} disabled={adding || !addUserId} icon="user-plus" style={{ fontSize: 12 }}>
                  {adding ? 'Adding…' : 'Add'}
                </Button>
              </div>
            </div>
          )}
          {error && <div style={{ color: theme.red, fontSize: 12, marginTop: -6 }}>{error}</div>}
        </div>
      </div>
    </div>
  )
}

// ── User modal (create) ────────────────────────────────────────────────────

function UserModal({ onSave, onClose }) {
  const [email, setEmail]           = useState('')
  const [displayName, setDisplayName] = useState('')
  const [extId, setExtId]           = useState('')
  const [extSrc, setExtSrc]         = useState('')
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState(null)

  const handleSave = async () => {
    if (!email.trim() || !displayName.trim()) return
    setSaving(true); setError(null)
    try {
      await api.createUser({
        email: email.trim(),
        display_name: displayName.trim(),
        external_id: extId.trim() || null,
        external_source: extSrc || null,
      })
      toast.success('User created')
      onSave()
    } catch (e) { setError(e.message); setSaving(false) }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: '#00000066', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={{ background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 14, padding: 28, width: 420, boxShadow: '0 8px 40px #0008' }}>
        <h3 style={{ margin: '0 0 20px', fontSize: 16, fontWeight: 700 }}>New User</h3>
        <Field label="Email *">
          <TextInput value={email} onChange={setEmail} placeholder="alice@company.com" />
        </Field>
        <Field label="Display Name *">
          <TextInput value={displayName} onChange={setDisplayName} placeholder="Alice Chen" />
        </Field>
        <SectionLabel>External Identity (optional)</SectionLabel>
        <Field label="Source">
          <select
            value={extSrc}
            onChange={(e) => setExtSrc(e.target.value)}
            style={{ width: '100%', padding: '8px 12px', background: theme.bgInput, border: `1px solid ${theme.border}`, borderRadius: 8, color: theme.text, fontSize: 13, fontFamily: 'inherit' }}
          >
            {EXTERNAL_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </Field>
        {extSrc && (
          <Field label="External User ID">
            <TextInput value={extId} onChange={setExtId} placeholder="user_abc123" mono />
          </Field>
        )}
        {error && <div style={{ color: theme.red, fontSize: 12, marginBottom: 10 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
          <Button variant="ghost" onClick={onClose} disabled={saving} style={{ fontSize: 12 }}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving || !email.trim() || !displayName.trim()} icon="user-plus" style={{ fontSize: 12 }}>
            {saving ? 'Creating…' : 'Create User'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Main panel ─────────────────────────────────────────────────────────────

function UsersTeamsPanel() {
  const [subTab, setSubTab]         = useState('teams')
  const [teams, setTeams]           = useState([])
  const [users, setUsers]           = useState([])
  const [loading, setLoading]       = useState(true)
  const [teamModal, setTeamModal]   = useState(null) // null | 'new' | teamObj
  const [membersTeam, setMembersTeam] = useState(null) // teamObj or null
  const [showUserModal, setShowUserModal] = useState(false)
  const [deletingId, setDeletingId] = useState(null)
  const [deactivatingId, setDeactivatingId] = useState(null)
  const [leavingId, setLeavingId] = useState(null)       // membership id being removed
  const [confirmLeaveId, setConfirmLeaveId] = useState(null) // membership id pending confirm

  const load = useCallback(() => {
    setLoading(true)
    Promise.allSettled([api.listTeams(), api.listUsers()])
      .then(([teamRes, userRes]) => {
        if (teamRes.status === 'fulfilled') setTeams(teamRes.value ?? [])
        if (userRes.status === 'fulfilled') setUsers(userRes.value ?? [])
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const handleDeleteTeam = async (t) => {
    if (!window.confirm(`Delete team "${t.name}"? This cannot be undone.`)) return
    setDeletingId(t.id)
    try {
      await api.deleteTeam(t.id)
      toast.success('Team deleted')
      load()
    } catch (e) { toast.error(e.message) }
    finally { setDeletingId(null) }
  }

  const handleLeave = async (membershipId, teamId, userId) => {
    setLeavingId(membershipId)
    try {
      await api.removeTeamMember(teamId, userId)
      toast.success('Left team')
      load()
    } catch (e) { toast.error(e.message) }
    finally { setLeavingId(null) }
  }

  const handleDeactivateUser = async (u) => {
    if (!window.confirm(`Deactivate user "${u.display_name}"?`)) return
    setDeactivatingId(u.id)
    try {
      await api.deactivateUser(u.id)
      toast.success('User deactivated')
      load()
    } catch (e) { toast.error(e.message) }
    finally { setDeactivatingId(null) }
  }

  if (loading) return <div style={{ color: theme.textDim, fontSize: 13, padding: '32px 0', textAlign: 'center' }}>Loading…</div>

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>Users & Teams</h3>
        <div style={{ fontSize: 13, color: theme.textDim, marginTop: 3 }}>
          Manage teams, member roles, and user accounts. Connect an external IdP for automatic group sync.
        </div>
      </div>

      {/* Sub-tab switcher */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24 }}>
        {[{ key: 'teams', label: 'Teams', icon: 'users' }, { key: 'users', label: 'Users', icon: 'user' }].map((t) => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', borderRadius: 7,
              border: subTab === t.key ? `1px solid ${theme.accent}40` : `1px solid ${theme.border}`,
              cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: subTab === t.key ? 600 : 400,
              background: subTab === t.key ? theme.accent + '14' : theme.bgCard,
              color: subTab === t.key ? theme.accent : theme.textMuted,
            }}
          >
            <Icon name={t.icon} size={12} />
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Teams sub-tab ── */}
      {subTab === 'teams' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <SectionLabel>Teams ({teams.length})</SectionLabel>
            <Button variant="ghost" icon="plus" onClick={() => setTeamModal('new')} style={{ padding: '4px 10px', fontSize: 12 }}>
              New Team
            </Button>
          </div>

          {teams.length === 0 ? (
            <div style={{ background: theme.bgCard, border: `1px dashed ${theme.border}`, borderRadius: 10, padding: 24, textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: theme.textDim }}>No teams yet. Create one to start organising users.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {teams.map((t) => (
                <div key={t.id} style={{ background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 10, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 600, fontSize: 14, color: theme.text }}>{t.name}</span>
                      <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: theme.textDim, background: theme.bgInput, padding: '1px 6px', borderRadius: 4 }}>{t.slug}</span>
                      {t.external_source && (
                        <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 10, background: '#6366f120', color: '#6366f1' }}>{t.external_source}</span>
                      )}
                    </div>
                    {t.description && (
                      <div style={{ fontSize: 12, color: theme.textDim, marginTop: 2 }}>{t.description}</div>
                    )}
                  </div>
                  <span style={{ fontSize: 11, color: theme.textMuted, whiteSpace: 'nowrap' }}>
                    {t.member_count} member{t.member_count !== 1 ? 's' : ''}
                  </span>
                  <button
                    onClick={() => setMembersTeam(t)}
                    style={{ background: theme.bgInput, border: `1px solid ${theme.border}`, borderRadius: 6, padding: '4px 10px', fontSize: 11, color: theme.textMuted, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}
                  >
                    <Icon name="users" size={11} style={{ marginRight: 4 }} />
                    Members
                  </button>
                  <button
                    onClick={() => setTeamModal(t)}
                    style={{ background: 'none', border: 'none', color: theme.textDim, cursor: 'pointer', padding: 4 }}
                    title="Edit team"
                  >
                    <Icon name="edit-2" size={13} />
                  </button>
                  <button
                    onClick={() => handleDeleteTeam(t)}
                    disabled={deletingId === t.id}
                    style={{ background: 'none', border: 'none', color: theme.red, cursor: 'pointer', padding: 4, opacity: deletingId === t.id ? 0.4 : 1 }}
                    title="Delete team"
                  >
                    <Icon name="trash-2" size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Users sub-tab ── */}
      {subTab === 'users' && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <SectionLabel>Users ({users.length})</SectionLabel>
            <Button variant="ghost" icon="user-plus" onClick={() => setShowUserModal(true)} style={{ padding: '4px 10px', fontSize: 12 }}>
              New User
            </Button>
          </div>

          {users.length === 0 ? (
            <div style={{ background: theme.bgCard, border: `1px dashed ${theme.border}`, borderRadius: 10, padding: 24, textAlign: 'center' }}>
              <div style={{ fontSize: 12, color: theme.textDim }}>No users yet. Create one to assign them to teams.</div>
            </div>
          ) : (
            <div style={{ background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 10, overflow: 'hidden' }}>
              {users.map((u, i) => (
                <div
                  key={u.id}
                  style={{
                    padding: '12px 16px',
                    borderBottom: i < users.length - 1 ? `1px solid ${theme.border}20` : 'none',
                    opacity: u.is_active ? 1 : 0.5,
                  }}
                >
                  {/* User header row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Avatar name={u.display_name} size={32} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>{u.display_name}</div>
                      <div style={{ fontSize: 11, color: theme.textDim }}>{u.email}</div>
                    </div>
                    {!u.is_active && (
                      <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 8, background: theme.red + '20', color: theme.red }}>Inactive</span>
                    )}
                    {u.is_active && (
                      <button
                        onClick={() => handleDeactivateUser(u)}
                        disabled={deactivatingId === u.id}
                        title="Deactivate user"
                        style={{ background: 'none', border: 'none', color: theme.textDim, cursor: 'pointer', padding: 4, opacity: deactivatingId === u.id ? 0.4 : 1 }}
                      >
                        <Icon name="user-x" size={13} />
                      </button>
                    )}
                  </div>
                  {/* Team memberships */}
                  {(u.memberships ?? []).length > 0 && (
                    <div style={{ marginTop: 8, marginLeft: 44, display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {(u.memberships ?? []).map((m) => {
                        const teamObj = teams.find((t) => t.id === m.team_id)
                        return (
                          <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 11, fontWeight: 500, color: theme.textMuted, background: theme.bgInput, padding: '2px 8px', borderRadius: 6, whiteSpace: 'nowrap' }}>
                              {teamObj?.name ?? m.team_id}
                            </span>
                            <RoleBadge role={m.role} />
                            {confirmLeaveId === m.id ? (
                              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                <span style={{ fontSize: 11, color: theme.textDim }}>Leave team?</span>
                                <button
                                  onClick={() => { setConfirmLeaveId(null); handleLeave(m.id, m.team_id, u.id) }}
                                  style={{ background: theme.red + '22', border: `1px solid ${theme.red}60`, borderRadius: 5, color: theme.red, cursor: 'pointer', padding: '1px 8px', fontSize: 11, fontFamily: 'inherit', fontWeight: 600 }}
                                >
                                  Confirm
                                </button>
                                <button
                                  onClick={() => setConfirmLeaveId(null)}
                                  style={{ background: 'none', border: `1px solid ${theme.border}`, borderRadius: 5, color: theme.textDim, cursor: 'pointer', padding: '1px 7px', fontSize: 11, fontFamily: 'inherit' }}
                                >
                                  Cancel
                                </button>
                              </span>
                            ) : (
                              <button
                                onClick={() => setConfirmLeaveId(m.id)}
                                disabled={leavingId === m.id}
                                title="Leave team"
                                style={{ background: 'none', border: `1px solid ${theme.border}`, borderRadius: 5, color: theme.textDim, cursor: 'pointer', padding: '1px 7px', fontSize: 11, fontFamily: 'inherit', opacity: leavingId === m.id ? 0.4 : 1 }}
                              >
                                {leavingId === m.id ? '…' : 'Leave'}
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {(u.memberships ?? []).length === 0 && (
                    <div style={{ marginTop: 5, marginLeft: 44, fontSize: 11, color: theme.textDim }}>No team memberships</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {teamModal && (
        <TeamModal
          team={teamModal === 'new' ? null : teamModal}
          onSave={() => { setTeamModal(null); load() }}
          onClose={() => setTeamModal(null)}
        />
      )}
      {membersTeam && (
        <TeamMembersModal
          team={membersTeam}
          users={users}
          onClose={() => setMembersTeam(null)}
          onRefresh={load}
        />
      )}
      {showUserModal && (
        <UserModal
          onSave={() => { setShowUserModal(false); load() }}
          onClose={() => setShowUserModal(false)}
        />
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════
   ROOT — Left-rail settings layout
   ═══════════════════════════════════════════ */

const SETTINGS_TABS = [
  { key: 'connections',   label: 'Connections',   icon: 'database' },
  { key: 'data-access',   label: 'Data Access',   icon: 'key' },
  { key: 'notifications', label: 'Notifications', icon: 'bell' },
  { key: 'users',         label: 'Users & Teams', icon: 'users' },
]

export default function SettingsView() {
  const { tab: urlTab } = useParams()
  const navigate = useNavigate()
  const tab = urlTab || 'connections'
  const setTab = (key) => navigate('/settings/' + key)

  return (
    <div>
      {/* Page header */}
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>Settings</h2>
        <div style={{ fontSize: 13, color: theme.textDim, marginTop: 4 }}>
          Configure data sources, platform access, and alert delivery
        </div>
      </div>

      {/* Two-column layout */}
      <div style={{ display: 'flex', gap: 0, alignItems: 'flex-start' }}>

        {/* Left rail */}
        <div style={{ width: 192, flexShrink: 0, borderRight: `1px solid ${theme.border}`, paddingRight: 0, paddingTop: 4 }}>
          {SETTINGS_TABS.map((t) => {
            const active = tab === t.key
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 9,
                  width: '100%', padding: '9px 14px', marginBottom: 2,
                  borderRadius: '8px 0 0 8px', border: 'none', cursor: 'pointer',
                  fontFamily: 'inherit', fontSize: 13, fontWeight: active ? 600 : 400,
                  background: active ? theme.accent + '14' : 'transparent',
                  color: active ? theme.accent : theme.textMuted,
                  textAlign: 'left', transition: 'all 0.15s',
                  borderRight: active ? `2px solid ${theme.accent}` : '2px solid transparent',
                }}
                onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = theme.bgCard }}
                onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent' }}
              >
                <Icon name={t.icon} size={14} />
                {t.label}
              </button>
            )
          })}
        </div>

        {/* Content area */}
        <div style={{ flex: 1, paddingLeft: 36, minWidth: 0 }}>
          {tab === 'connections'   && <ConnectionsPanel />}
          {tab === 'data-access'   && <DataAccessPanel />}
          {tab === 'notifications' && <NotificationsPanel />}
          {tab === 'users'         && <UsersTeamsPanel />}
        </div>

      </div>
    </div>
  )
}
