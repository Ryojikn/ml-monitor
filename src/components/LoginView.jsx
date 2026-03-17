import { useState } from 'react'
import { supabase } from '../supabase'

export default function LoginView() {
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  async function handleGoogleSignIn() {
    setError(null)
    setLoading(true)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    })
    if (error) {
      setError(error.message)
      setLoading(false)
    }
    // On success the browser navigates away — no need to reset loading
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: '#0f1117',
    }}>
      <div style={{
        background: '#1a1d27', border: '1px solid #2a2d3a', borderRadius: 12,
        padding: '40px 48px', width: 360, textAlign: 'center',
      }}>
        <div style={{ marginBottom: 32 }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#e2e8f0', marginBottom: 4 }}>
            MLMonitor
          </div>
          <div style={{ fontSize: 14, color: '#64748b' }}>Sign in to continue</div>
        </div>

        {error && (
          <div style={{
            marginBottom: 20, padding: '10px 12px', background: '#3b1a1a',
            border: '1px solid #7f1d1d', borderRadius: 6, fontSize: 13, color: '#fca5a5',
            textAlign: 'left',
          }}>
            {error}
          </div>
        )}

        <button
          onClick={handleGoogleSignIn}
          disabled={loading}
          style={{
            width: '100%', padding: '11px 0', borderRadius: 8,
            border: '1px solid #2a2d3a',
            background: loading ? '#1e2130' : '#fff',
            color: loading ? '#64748b' : '#1f2937',
            fontSize: 14, fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            transition: 'background 0.15s',
          }}
        >
          {!loading && (
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
              <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
            </svg>
          )}
          {loading ? 'Redirecting…' : 'Continue with Google'}
        </button>
      </div>
    </div>
  )
}
