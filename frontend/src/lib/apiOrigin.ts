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

/** Tutorial / placeholder hosts — never use as a real API (login will always fail). */
const BLOCKED_API_HOSTS = new Set(['your-api.onrender.com'])

export function isBlockedExampleApiOrigin(raw: string): boolean {
  const n = normalizeApiOrigin(raw)
  if (!n) return false
  let urlStr = n
  if (!/^https?:\/\//i.test(urlStr)) urlStr = `https://${urlStr}`
  try {
    const host = new URL(urlStr).hostname.toLowerCase()
    if (BLOCKED_API_HOSTS.has(host)) return true
    if (host === 'example.com' || host.endsWith('.example.com')) return true
    return false
  } catch {
    return true
  }
}

export function isVercelLiveSite(): boolean {
  if (typeof window === 'undefined') return false
  const h = window.location.hostname.toLowerCase()
  return h === 'vercel.app' || h.endsWith('.vercel.app')
}

export function hasBuildTimeNextPublicApiUrl(): boolean {
  return Boolean(String(process.env.NEXT_PUBLIC_API_URL || '').trim())
}
