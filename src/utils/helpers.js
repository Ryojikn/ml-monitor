export const uuid = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10)

export const rng   = (min, max) => Math.random() * (max - min) + min
export const pick  = (arr)      => arr[Math.floor(Math.random() * arr.length)]
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
export const fmt   = (v, d = 4) => (typeof v === 'number' ? v.toFixed(d) : v)
export const fmtPct = (v)       => (v * 100).toFixed(1) + '%'

export const DAY_MS = 86_400_000
