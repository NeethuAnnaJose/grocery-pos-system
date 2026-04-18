/**
 * Optional browser override when NEXT_PUBLIC_API_URL was not set at build time
 * (e.g. Vercel) or you need to point at a LAN/tunnel API without rebuilding.
 */
export const SHOPPOS_API_ORIGIN_KEY = 'SHOPPOS_API_ORIGIN'

export function normalizeApiOrigin(raw: string | undefined | null): string {
  const t = String(raw || '')
    .trim()
    .replace(/\/+$/, '')
  if (!t) return ''
  if (t.endsWith('/api')) return t.slice(0, -4).replace(/\/+$/, '')
  return t
}

export function getStoredApiOrigin(): string {
  if (typeof window === 'undefined') return ''
  return normalizeApiOrigin(window.localStorage.getItem(SHOPPOS_API_ORIGIN_KEY))
}

export function setStoredApiOrigin(origin: string) {
  if (typeof window === 'undefined') return
  const n = normalizeApiOrigin(origin)
  if (!n) {
    window.localStorage.removeItem(SHOPPOS_API_ORIGIN_KEY)
    return
  }
  window.localStorage.setItem(SHOPPOS_API_ORIGIN_KEY, n)
}

/** Axios baseURL (includes /api). */
export function getBrowserApiBaseURL(envOrigin: string): string {
  const fromStorage = getStoredApiOrigin()
  const base = fromStorage || normalizeApiOrigin(envOrigin)
  return base ? `${base}/api` : '/api'
}
