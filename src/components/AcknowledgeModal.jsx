/* ═══════════════════════════════════════════
   AcknowledgeModal — assign alert to a team member
   ═══════════════════════════════════════════ */

import { useState, useEffect, useRef } from 'react'
import Icon from './Icon.jsx'
import { theme, severityColor } from '../utils/theme.js'
import { api } from '../api.js'

export default function AcknowledgeModal({ alert, models, teams, currentUser, onConfirm, onClose }) {
  const [teamMembers, setTeamMembers] = useState([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [selectedUser, setSelectedUser] = useState(null)
  const [search, setSearch] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef(null)

  const model = models.find(m => m.id === alert.model_id)
  const teamName = model?.team ?? '—'
  const teamObj = teams.find(t => t.name === teamName)

  // Pre-fill with current assignee if reassigning
  useEffect(() => {
    if (alert.assigned_user) {
      setSelectedUser(alert.assigned_user)
      setSearch(`${alert.assigned_user.display_name} (${alert.assigned_user.email})`)
    }
  }, [alert.assigned_user])

  // Fetch team members
  useEffect(() => {
    if (!teamObj) return
    setLoadingMembers(true)
    api.getTeamWithMembers(teamObj.id)
      .then(t => setTeamMembers(t.members ?? []))
      .catch(() => setTeamMembers([]))
      .finally(() => setLoadingMembers(false))
  }, [teamObj?.id])

  const suggestions = search.trim()
    ? teamMembers.filter(m =>
        m.user.display_name.toLowerCase().includes(search.toLowerCase()) ||
        m.user.email.toLowerCase().includes(search.toLowerCase())
      )
    : teamMembers

  const handleSelectUser = (membership) => {
    setSelectedUser(membership.user)
    setSearch(`${membership.user.display_name} (${membership.user.email})`)
    setShowSuggestions(false)
  }

  const handleAssignToMe = () => {
    if (!currentUser) return
    const me = teamMembers.find(m => m.user.id === currentUser.id)
    if (me) {
      handleSelectUser(me)
    } else {
      // currentUser is not on this team — still allow self-assignment
      setSelectedUser(currentUser)
      setSearch(`${currentUser.display_name} (${currentUser.email})`)
      setShowSuggestions(false)
    }
  }

  const handleConfirm = async () => {
    if (!selectedUser) return
    setSaving(true)
    try {
      await api.updateAlert(alert.id, { assigned_to_user_id: selectedUser.id })
      onConfirm?.()
      onClose()
    } catch (e) {
      console.error(e)
    } finally {
      setSaving(false)
    }
  }

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const isReassign = !!alert.assigned_user

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 500,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: theme.bgCard, border: `1px solid ${theme.border}`,
        borderRadius: 16, padding: 28, width: 460, maxWidth: '95vw',
        boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="user-check" size={16} style={{ color: theme.accent }} />
            <span style={{ fontWeight: 700, fontSize: 15, color: theme.text }}>
              {isReassign ? 'Reassign Alert' : 'Acknowledge & Assign'}
            </span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.textDim, padding: 4 }}>
            <Icon name="x" size={16} />
          </button>
        </div>

        {/* Alert summary */}
        <div style={{
          padding: '12px 14px', borderRadius: 10, marginBottom: 20,
          background: theme.bg, border: `1px solid ${theme.border}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
              background: severityColor(alert.severity) + '20',
              color: severityColor(alert.severity),
              textTransform: 'uppercase', letterSpacing: 0.5,
            }}>{alert.severity}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>{alert.metric_name}</span>
            {alert.feature_name && <span style={{ fontSize: 12, color: theme.textDim }}>· {alert.feature_name}</span>}
          </div>
          <div style={{ fontSize: 12, color: theme.textMuted }}>
            <span style={{ color: theme.text, fontWeight: 500 }}>{model?.name ?? alert.model_id}</span>
            <span style={{ margin: '0 6px', color: theme.textDim }}>·</span>
            <span>{teamName}</span>
            <span style={{ margin: '0 6px', color: theme.textDim }}>·</span>
            <span>Value: <strong style={{ color: theme.text }}>{alert.metric_value}</strong></span>
          </div>
        </div>

        {/* Assign to field */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: theme.textMuted, marginBottom: 8 }}>
            Assign to <span style={{ color: theme.textDim, fontWeight: 400 }}>(team: {teamName})</span>
          </div>

          {/* Assign to me quick action */}
          {currentUser && (
            <button
              onClick={handleAssignToMe}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8,
                padding: '5px 12px', borderRadius: 8, border: `1px solid ${theme.accent}40`,
                background: theme.accent + '12', color: theme.accent,
                cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 500,
              }}
            >
              <Icon name="user" size={11} />
              Assign to me ({currentUser.display_name})
            </button>
          )}

          {/* Searchable combobox */}
          <div style={{ position: 'relative' }}>
            <input
              ref={inputRef}
              type="text"
              placeholder={loadingMembers ? 'Loading members…' : teamMembers.length === 0 ? 'No team members found' : 'Search by name or email…'}
              value={search}
              onChange={e => { setSearch(e.target.value); setSelectedUser(null); setShowSuggestions(true) }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              disabled={loadingMembers || teamMembers.length === 0}
              style={{
                width: '100%', padding: '9px 12px', borderRadius: 8, boxSizing: 'border-box',
                background: theme.bgInput, border: `1px solid ${selectedUser ? theme.accent + '60' : theme.border}`,
                color: theme.text, fontFamily: 'inherit', fontSize: 13,
                outline: 'none',
              }}
            />

            {showSuggestions && suggestions.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4,
                background: theme.bgCard, border: `1px solid ${theme.border}`, borderRadius: 8,
                zIndex: 10, maxHeight: 200, overflowY: 'auto',
                boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
              }}>
                {suggestions.map(m => (
                  <div
                    key={m.user.id}
                    onMouseDown={() => handleSelectUser(m)}
                    style={{
                      padding: '9px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                      borderBottom: `1px solid ${theme.border}20`,
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = theme.bgCardHover}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                      background: theme.purple + '25', color: theme.purple,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 700,
                    }}>
                      {m.user.display_name[0].toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: theme.text }}>{m.user.display_name}</div>
                      <div style={{ fontSize: 11, color: theme.textDim }}>{m.user.email} · {m.role}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {teamMembers.length === 0 && !loadingMembers && (
            <div style={{ marginTop: 8, fontSize: 12, color: theme.yellow }}>
              <Icon name="alert-triangle" size={11} style={{ marginRight: 4 }} />
              No registered team members. Add members in Settings → Users &amp; Teams.
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onClose}
            style={{
              padding: '8px 18px', borderRadius: 8, border: `1px solid ${theme.border}`,
              background: 'transparent', color: theme.textMuted,
              cursor: 'pointer', fontFamily: 'inherit', fontSize: 13,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedUser || saving}
            style={{
              padding: '8px 20px', borderRadius: 8, border: 'none',
              background: selectedUser && !saving ? theme.accent : theme.border,
              color: selectedUser && !saving ? '#000' : theme.textDim,
              cursor: selectedUser && !saving ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
              transition: 'all 0.15s',
            }}
          >
            {saving ? 'Saving…' : isReassign ? 'Reassign' : 'Acknowledge & Assign'}
          </button>
        </div>
      </div>
    </div>
  )
}
