import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { AppHeader } from '@/components/AppHeader'
import { useRequireAuth } from '@/hooks/useRequireAuth'
import { authAPI, itemsAPI, ordersAPI, productAPI } from '@/services/api'

/**
 * Mall-style billing counter: products live in the store DB (same API as POS).
 * Staff signs in → catalog loads → scan (camera / USB scanner / manual) reserves stock and adds to bill → Complete sale creates an order.
 */

type CatalogItem = {
  id: string
  name: string
  price: number
  quantity: number
  barcode?: string
  unit?: string
}

type BillLine = {
  id: string
  name: string
  price: number
  quantity: number
  barcode?: string
  unit?: string
}

const BILL_CACHE_KEY = 'billing_counter_cart_v2'

const normalizeBarcode = (value: string) => {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const compact = raw.replace(/\s+/g, '').replace(/-/g, '')
  if (/^\d+$/.test(compact)) return compact
  return compact.toUpperCase()
}

const barcodeCandidates = (value: string) => {
  const normalized = normalizeBarcode(value)
  if (!normalized) return []
  const candidates = new Set<string>([normalized])
  if (/^\d+$/.test(normalized)) {
    const noLeadingZero = normalized.replace(/^0+/, '') || '0'
    candidates.add(noLeadingZero)
    if (normalized.length === 12) candidates.add(`0${normalized}`)
    if (normalized.length === 13 && normalized.startsWith('0')) candidates.add(normalized.slice(1))
  }
  return Array.from(candidates)
}

const itemMatchesBarcode = (item: CatalogItem, scannedValue: string) => {
  const itemCandidates = barcodeCandidates(item.barcode || '')
  if (!itemCandidates.length) return false
  const scannedCandidates = new Set(barcodeCandidates(scannedValue))
  return itemCandidates.some((c) => scannedCandidates.has(c))
}

const getStoredToken = () => (typeof window !== 'undefined' ? localStorage.getItem('token') : '')

export default function BillingPage() {
  const { authLoading, currentUserEmail } = useRequireAuth()
  const [storeToken, setStoreToken] = useState('')
  const [staffEmail, setStaffEmail] = useState('')
  const [staffPassword, setStaffPassword] = useState('')
  const [loginSubmitting, setLoginSubmitting] = useState(false)

  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const [cart, setCart] = useState<BillLine[]>([])
  const [manualEntry, setManualEntry] = useState('')
  const [loadingCatalog, setLoadingCatalog] = useState(false)

  const [showScanner, setShowScanner] = useState(false)
  const [scanStatus, setScanStatus] = useState('')
  const [scanError, setScanError] = useState('')
  const [manualScanCode, setManualScanCode] = useState('')
  const [isScanStarting, setIsScanStarting] = useState(false)
  const [isCheckoutLoading, setIsCheckoutLoading] = useState(false)
  const [isPrinting, setIsPrinting] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'UPI' | 'CARD' | 'CREDIT' | 'BANK_TRANSFER'>('CASH')
  const [preferredFacingMode, setPreferredFacingMode] = useState<'environment' | 'user'>('environment')
  const [rearVideoInputs, setRearVideoInputs] = useState<Array<{ id: string; label: string }>>([])
  const [selectedRearDeviceId, setSelectedRearDeviceId] = useState('')
  const [isOffline, setIsOffline] = useState(false)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const manualEntryRef = useRef<HTMLInputElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const zxingReaderRef = useRef<any>(null)
  const processScanRef = useRef<(code: string, source?: 'camera' | 'manual' | 'external-scanner') => Promise<void>>()
  const lastScanAtRef = useRef(0)
  const lastScannedCodeRef = useRef('')
  const scanMissCountRef = useRef(0)
  const isProcessingScanRef = useRef(false)
  const localBarcodeMapRef = useRef<Map<string, CatalogItem>>(new Map())
  const cameraCandidateRef = useRef<{ code: string; count: number }>({ code: '', count: 0 })
  const scannerBufferRef = useRef('')
  const scannerBufferTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cartRef = useRef<BillLine[]>([])
  const catalogRef = useRef<CatalogItem[]>([])

  const cartTotal = useMemo(
    () => cart.reduce((sum, line) => sum + Number(line.price || 0) * Number(line.quantity || 0), 0),
    [cart]
  )

  useEffect(() => {
    cartRef.current = cart
  }, [cart])

  useEffect(() => {
    catalogRef.current = catalog
  }, [catalog])

  useEffect(() => {
    setStoreToken(getStoredToken() || '')
  }, [])

  useEffect(() => {
    const map = new Map<string, CatalogItem>()
    for (const item of catalog) {
      for (const key of barcodeCandidates(item.barcode || '')) {
        if (!map.has(key)) map.set(key, item)
      }
    }
    localBarcodeMapRef.current = map
  }, [catalog])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = localStorage.getItem(BILL_CACHE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        cartRef.current = parsed
        setCart(parsed)
      }
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem(BILL_CACHE_KEY, JSON.stringify(cart))
  }, [cart])

  const loadCatalog = useCallback(async () => {
    if (!getStoredToken()) return
    try {
      setLoadingCatalog(true)
      const response = await itemsAPI.getItems({ limit: 2000 })
      const rows = Array.isArray(response.data?.data?.items) ? response.data.data.items : []
      setCatalog(rows)
      setIsOffline(false)
      if (typeof window !== 'undefined') {
        localStorage.setItem('cached_products', JSON.stringify(rows))
      }
    } catch {
      const cached =
        typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('cached_products') || '[]') : []
      if (Array.isArray(cached) && cached.length) {
        setCatalog(cached)
        setIsOffline(true)
        toast.error('Using offline product cache. Reconnect and refresh.')
      } else {
        setCatalog([])
        toast.error('Could not load product catalog. Check API login and server.')
      }
    } finally {
      setLoadingCatalog(false)
    }
  }, [])

  useEffect(() => {
    if (storeToken) void loadCatalog()
  }, [storeToken, loadCatalog])

  const handleStaffLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    const email = staffEmail.trim().toLowerCase()
    if (!email || !staffPassword) {
      toast.error('Enter staff email and password (same as POS / store server).')
      return
    }
    setLoginSubmitting(true)
    try {
      const response = await authAPI.login({ email, password: staffPassword })
      const body = response.data
      const token = body?.data?.token
      if (!token) {
        toast.error(body?.message || 'Login failed')
        return
      }
      localStorage.setItem('token', token)
      setStoreToken(token)
      setStaffPassword('')
      toast.success('Store connected. Catalog loading…')
      await loadCatalog()
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Store login failed')
    } finally {
      setLoginSubmitting(false)
    }
  }

  const fetchProductByBarcode = async (code: string) => {
    const normalizedCode = normalizeBarcode(code)
    if (!normalizedCode) return null
    for (const candidate of barcodeCandidates(normalizedCode)) {
      const hit = localBarcodeMapRef.current.get(candidate)
      if (hit) return hit
    }
    if (isOffline) return null
    try {
      const response = await productAPI.getByBarcode(normalizedCode)
      return response.data?.data?.product || null
    } catch {
      return catalogRef.current.find((item) => itemMatchesBarcode(item, normalizedCode)) || null
    }
  }

  const addLineToBill = async (item: CatalogItem) => {
    if (item.quantity === 0) {
      toast.error('Out of stock')
      return false
    }
    const inBill = cartRef.current.find((l) => l.id === item.id)
    if (inBill && inBill.quantity >= item.quantity) {
      toast.error('Cannot add more than available stock')
      return false
    }
    try {
      await itemsAPI.updateStock(item.id, {
        quantity: 1,
        type: 'STOCK_OUT',
        reason: 'Billing counter',
      })
      setCatalog((prev) =>
        prev.map((p) => (p.id === item.id ? { ...p, quantity: Math.max(0, p.quantity - 1) } : p))
      )
      setCart((prev) => {
        const cur = prev.find((l) => l.id === item.id)
        if (cur) {
          return prev.map((l) => (l.id === item.id ? { ...l, quantity: l.quantity + 1 } : l))
        }
        return [
          ...prev,
          {
            id: item.id,
            name: item.name,
            price: item.price,
            quantity: 1,
            barcode: item.barcode,
            unit: item.unit || 'pcs',
          },
        ]
      })
      return true
    } catch (err: any) {
      if (!err?.response) {
        setCatalog((prev) =>
          prev.map((p) => (p.id === item.id ? { ...p, quantity: Math.max(0, p.quantity - 1) } : p))
        )
        setCart((prev) => {
          const cur = prev.find((l) => l.id === item.id)
          if (cur) return prev.map((l) => (l.id === item.id ? { ...l, quantity: l.quantity + 1 } : l))
          return [
            ...prev,
            {
              id: item.id,
              name: item.name,
              price: item.price,
              quantity: 1,
              barcode: item.barcode,
              unit: item.unit || 'pcs',
            },
          ]
        })
        toast.success(`${item.name} added (offline)`)
        return true
      }
      toast.error(err?.response?.data?.message || 'Could not reserve stock')
      return false
    }
  }

  const processScannedCode = async (rawCode: string, source: 'camera' | 'manual' | 'external-scanner' = 'camera') => {
    if (!storeToken) {
      toast.error('Sign in to store server first')
      return
    }
    if (isProcessingScanRef.current) return
    const code = String(rawCode || '').trim()
    if (!code) return
    const normalizedCode = normalizeBarcode(code)
    const now = Date.now()
    if (source !== 'manual' && normalizedCode === lastScannedCodeRef.current && now - lastScanAtRef.current < 1200) {
      return
    }
    lastScanAtRef.current = now
    lastScannedCodeRef.current = normalizedCode
    setScanStatus('Looking up product…')
    isProcessingScanRef.current = true
    try {
      const product = await fetchProductByBarcode(normalizedCode)
      if (product) {
        const ok = await addLineToBill(product)
        if (ok) {
          setScanStatus(`Added: ${product.name}`)
          toast.success(`Added: ${product.name}`)
          setShowScanner(false)
          stopScanner()
        }
      } else {
        setScanStatus(`Not in catalog: ${normalizedCode}`)
        toast.error(`No product for barcode ${normalizedCode}`)
        if (source === 'camera') {
          setShowScanner(false)
          stopScanner()
        }
      }
    } finally {
      isProcessingScanRef.current = false
    }
  }

  useEffect(() => {
    processScanRef.current = processScannedCode
  }, [processScannedCode])

  const addToBillByQuery = async (query: string) => {
    const value = query.trim()
    if (!value) return
    if (!storeToken) {
      toast.error('Sign in to store server first')
      return
    }
    const normalized = normalizeBarcode(value)
    const product = await fetchProductByBarcode(normalized)
    if (product) {
      const ok = await addLineToBill(product)
      if (ok) toast.success(`Added: ${product.name}`)
      return
    }
    const lowered = value.toLowerCase()
    const byName = catalog.filter((p) => p.name.toLowerCase().includes(lowered))
    if (byName.length === 1) {
      const ok = await addLineToBill(byName[0])
      if (ok) toast.success(`Added: ${byName[0].name}`)
      return
    }
    toast.error('Product not found. Add it in POS / inventory admin first.')
  }

  const isExpectedDecodeMiss = (error: any) => {
    const name = String(error?.name || '')
    const message = String(error?.message || '')
    return (
      name === 'NotFoundException' ||
      /no multiformat readers were able to detect the code/i.test(message) ||
      /not found/i.test(message)
    )
  }

  const stopScanner = () => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current)
      scanIntervalRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) videoRef.current.srcObject = null
    cameraCandidateRef.current = { code: '', count: 0 }
  }

  const scoreCameraLabel = (label: string) => {
    const value = String(label || '').toLowerCase()
    let score = 0
    if (/rear|back|environment|world/.test(value)) score += 50
    if (/front|facetime|user|selfie/.test(value)) score -= 90
    if (/macro|ultra/.test(value)) score -= 20
    if (/tele/.test(value)) score += 10
    if (/main|wide/.test(value)) score += 6
    return score
  }

  const refreshRearVideoInputs = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const videoDevices = devices.filter((d) => d.kind === 'videoinput')
      const ranked = [...videoDevices].sort((a, b) => scoreCameraLabel(b.label) - scoreCameraLabel(a.label))
      const likelyRear = ranked.filter((d) => scoreCameraLabel(d.label) >= 0)
      const usable = (likelyRear.length ? likelyRear : ranked).map((d, i) => ({
        id: d.deviceId,
        label: d.label?.trim() || `Camera ${i + 1}`,
      }))
      setRearVideoInputs(usable)
      const resolved = usable.find((d) => d.id === selectedRearDeviceId)?.id || usable[0]?.id || ''
      if (resolved && resolved !== selectedRearDeviceId) setSelectedRearDeviceId(resolved)
      return resolved
    } catch {
      return selectedRearDeviceId
    }
  }

  const startScanner = async (facingMode: 'environment' | 'user' = preferredFacingMode) => {
    if (!storeToken) {
      toast.error('Sign in to store server before scanning')
      return
    }
    const nav = typeof navigator !== 'undefined' ? navigator : null
    const gUM = nav?.mediaDevices?.getUserMedia?.bind(nav.mediaDevices)
    if (!gUM) {
      setScanError('Camera not available in this browser.')
      return
    }
    setIsScanStarting(true)
    setScanError('')
    setScanStatus('Starting camera…')
    setShowScanner(true)
    try {
      const rearId = facingMode === 'environment' ? selectedRearDeviceId || (await refreshRearVideoInputs()) : ''
      const fallbackFacing = facingMode === 'environment' ? 'user' : 'environment'
      const tries: MediaStreamConstraints[] = [
        ...(rearId
          ? [{ video: { deviceId: { exact: rearId }, width: { ideal: 1280 }, height: { ideal: 720 } } }]
          : []),
        { video: { facingMode: { exact: facingMode }, width: { ideal: 1920 }, height: { ideal: 1080 } } },
        { video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } } },
        { video: { facingMode: { ideal: fallbackFacing }, width: { ideal: 1280 }, height: { ideal: 720 } } },
        { video: true },
      ]
      let stream: MediaStream | null = null
      for (const c of tries) {
        try {
          stream = await gUM(c)
          break
        } catch {
          /* next */
        }
      }
      if (!stream) throw new Error('Could not open camera')
      streamRef.current = stream
      if (videoRef.current) {
        const v = videoRef.current
        v.srcObject = stream
        v.muted = true
        v.setAttribute('playsinline', 'true')
        await v.play().catch(() => {})
      }

      const BarcodeDetectorCtor = (window as any).BarcodeDetector
      const detector = BarcodeDetectorCtor
        ? new BarcodeDetectorCtor({
            formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'],
          })
        : null
      const needFrames = detector ? 1 : 2

      if (!detector) {
        const zxing = await import('@zxing/library')
        if (!zxingReaderRef.current) {
          const hints = new Map()
          hints.set(zxing.DecodeHintType.POSSIBLE_FORMATS, [
            zxing.BarcodeFormat.EAN_13,
            zxing.BarcodeFormat.EAN_8,
            zxing.BarcodeFormat.UPC_A,
            zxing.BarcodeFormat.UPC_E,
            zxing.BarcodeFormat.CODE_128,
            zxing.BarcodeFormat.CODE_39,
            zxing.BarcodeFormat.ITF,
            zxing.BarcodeFormat.QR_CODE,
          ])
          const reader = new zxing.MultiFormatReader()
          reader.setHints(hints)
          zxingReaderRef.current = { zxing, reader }
        }
      }

      scanIntervalRef.current = setInterval(async () => {
        if (!videoRef.current || !canvasRef.current || videoRef.current.readyState < 2) return
        const video = videoRef.current
        const canvas = canvasRef.current
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.filter = 'grayscale(100%) contrast(180%) brightness(110%)'
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        try {
          let raw = ''
          if (detector) {
            const results = await detector.detect(canvas)
            raw = results?.[0]?.rawValue || ''
          } else if (zxingReaderRef.current) {
            const { zxing, reader } = zxingReaderRef.current
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
            const source = new zxing.RGBLuminanceSource(imageData.data, canvas.width, canvas.height)
            const bitmap = new zxing.BinaryBitmap(new zxing.HybridBinarizer(source))
            const result = reader.decode(bitmap)
            raw = result?.getText?.() || result?.text || ''
            reader.reset?.()
          }
          if (raw) {
            const norm = normalizeBarcode(raw)
            const cur = cameraCandidateRef.current
            if (cur.code === norm) cur.count += 1
            else cameraCandidateRef.current = { code: norm, count: 1 }
            if (cameraCandidateRef.current.count >= needFrames) {
              scanMissCountRef.current = 0
              cameraCandidateRef.current = { code: '', count: 0 }
              await processScanRef.current?.(norm, 'camera')
            }
          } else {
            scanMissCountRef.current += 1
            if (scanMissCountRef.current % 8 === 0) {
              setScanStatus('Point camera at barcode…')
            }
          }
        } catch (e: any) {
          if (!isExpectedDecodeMiss(e)) setScanStatus('Adjust distance or lighting')
          zxingReaderRef.current?.reader?.reset?.()
        }
      }, 90)
      setScanStatus('Scanner ready — scan a product')
    } catch (e: any) {
      setScanError(e?.message || 'Camera error')
      toast.error(e?.message || 'Camera error')
      setShowScanner(false)
      stopScanner()
    } finally {
      setIsScanStarting(false)
    }
  }

  useEffect(() => {
    const onKey = async (event: KeyboardEvent) => {
      if (event.key === 'F8') {
        event.preventDefault()
        if (!storeToken) return
        setShowScanner(true)
        setTimeout(() => void startScanner(), 0)
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        manualEntryRef.current?.focus()
        manualEntryRef.current?.select()
        return
      }
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (event.key === 'Enter') {
        event.preventDefault()
        const buffered = scannerBufferRef.current.trim()
        scannerBufferRef.current = ''
        if (scannerBufferTimerRef.current) {
          clearTimeout(scannerBufferTimerRef.current)
          scannerBufferTimerRef.current = null
        }
        if (buffered.length >= 6) await processScanRef.current?.(buffered, 'external-scanner')
        return
      }
      if (event.key.length === 1) {
        scannerBufferRef.current += event.key
        if (scannerBufferTimerRef.current) clearTimeout(scannerBufferTimerRef.current)
        scannerBufferTimerRef.current = setTimeout(() => {
          scannerBufferRef.current = ''
        }, 120)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (scannerBufferTimerRef.current) clearTimeout(scannerBufferTimerRef.current)
    }
  }, [storeToken])

  useEffect(() => () => stopScanner(), [])

  const updateLineQty = async (lineId: string, nextQty: number) => {
    const line = cartRef.current.find((l) => l.id === lineId)
    if (!line) return
    const q = Math.max(0, Math.floor(nextQty))
    const delta = q - line.quantity
    if (delta === 0) return
    const cat = catalogRef.current.find((c) => c.id === lineId)
    if (!cat) return
    try {
      if (delta > 0) {
        if (cat.quantity < delta) {
          toast.error('Not enough stock')
          return
        }
        await itemsAPI.updateStock(lineId, {
          quantity: delta,
          type: 'STOCK_OUT',
          reason: 'Billing counter',
        })
      } else {
        await itemsAPI.updateStock(lineId, {
          quantity: Math.abs(delta),
          type: 'STOCK_IN',
          reason: 'Billing line adjust',
        })
      }
      setCatalog((prev) =>
        prev.map((p) =>
          p.id === lineId ? { ...p, quantity: Math.max(0, p.quantity - delta) } : p
        )
      )
      if (q <= 0) setCart((prev) => prev.filter((l) => l.id !== lineId))
      else setCart((prev) => prev.map((l) => (l.id === lineId ? { ...l, quantity: q } : l)))
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Stock update failed')
    }
  }

  const clearBill = async () => {
    const lines = cartRef.current
    if (!lines.length) return
    for (const line of lines) {
      try {
        await itemsAPI.updateStock(line.id, {
          quantity: line.quantity,
          type: 'STOCK_IN',
          reason: 'Bill cleared',
        })
      } catch {
        /* still clear UI */
      }
    }
    await loadCatalog()
    setCart([])
    localStorage.removeItem(BILL_CACHE_KEY)
    toast.success('Bill cleared')
  }

  const completeSale = async () => {
    if (!cart.length) {
      toast.error('Bill is empty')
      return
    }
    setIsCheckoutLoading(true)
    try {
      const orderData = {
        orderItems: cart.map((line) => ({
          itemId: line.id,
          quantity: line.quantity,
          discount: 0,
        })),
        paymentMethod,
        discount: 0,
        stockReserved: true,
      }
      const response = await ordersAPI.createOrder(orderData as any)
      toast.success('Sale completed')
      setCart([])
      localStorage.removeItem(BILL_CACHE_KEY)
      await loadCatalog()
      const orderId = response.data?.data?.order?.id
      if (orderId) window.open(`/invoice/${orderId}`, '_blank')
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Checkout failed')
    } finally {
      setIsCheckoutLoading(false)
    }
  }

  const printBill = () => {
    if (!cart.length) {
      toast.error('Bill is empty')
      return
    }
    setIsPrinting(true)
    const rows = cart
      .map((line) => {
        const t = line.price * line.quantity
        return `<tr><td style="border:1px solid #ddd;padding:6px;">${line.name}</td><td style="border:1px solid #ddd;padding:6px;text-align:right;">${line.quantity}</td><td style="border:1px solid #ddd;padding:6px;text-align:right;">${line.price.toFixed(2)}</td><td style="border:1px solid #ddd;padding:6px;text-align:right;">${t.toFixed(2)}</td></tr>`
      })
      .join('')
    const html = `<html><head><title>Bill</title></head><body style="font-family:Arial,sans-serif;padding:16px;"><h2>Bill</h2><p>${new Date().toLocaleString()}</p><table style="width:100%;border-collapse:collapse;"><thead><tr><th style="border:1px solid #ddd;padding:6px;">Item</th><th style="border:1px solid #ddd;padding:6px;text-align:right;">Qty</th><th style="border:1px solid #ddd;padding:6px;text-align:right;">Price</th><th style="border:1px solid #ddd;padding:6px;text-align:right;">Total</th></tr></thead><tbody>${rows}</tbody></table><h3 style="text-align:right;">Total: Rs ${cartTotal.toFixed(2)}</h3></body></html>`
    const w = window.open('', '_blank', 'width=900,height=700')
    if (w) {
      w.document.write(html)
      w.document.close()
      w.onload = () => {
        w.print()
        setIsPrinting(false)
      }
    } else setIsPrinting(false)
  }

  if (authLoading) {
    return <div className="min-h-screen grid place-items-center text-gray-600">Checking login…</div>
  }

  if (!storeToken) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-200">
        <AppHeader active="billing" userEmail={currentUserEmail || undefined} />
        <main className="max-w-md mx-auto p-6 mt-8">
          <section className="bg-white rounded-xl shadow border border-slate-200 p-6 space-y-4">
            <h1 className="text-xl font-semibold">Store billing (counter)</h1>
            <p className="text-sm text-gray-600">
              Products and stock are loaded from your <strong>store database</strong> (same as POS). Sign in with the
              staff account you use for the POS server so scanning matches shelf barcodes.
            </p>
            <form onSubmit={handleStaffLogin} className="space-y-3">
              <input
                className="input w-full"
                type="email"
                autoComplete="username"
                placeholder="Staff email"
                value={staffEmail}
                onChange={(e) => setStaffEmail(e.target.value)}
              />
              <input
                className="input w-full"
                type="password"
                autoComplete="current-password"
                placeholder="Password"
                value={staffPassword}
                onChange={(e) => setStaffPassword(e.target.value)}
              />
              <button type="submit" className="btn btn-primary w-full" disabled={loginSubmitting}>
                {loginSubmitting ? 'Signing in…' : 'Connect store & open billing'}
              </button>
            </form>
            <p className="text-xs text-gray-500">
              After this, use <span className="font-medium">Scan to bill</span> or a USB barcode scanner. Manage full catalog in{' '}
              <a className="text-blue-600 underline" href="/pos">
                POS
              </a>
              .
            </p>
          </section>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-200">
      <AppHeader active="billing" userEmail={currentUserEmail || undefined} />

      <main className="max-w-6xl mx-auto p-4 space-y-4">
        <section className="bg-white/95 backdrop-blur rounded-xl shadow p-5 border border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-xl font-semibold">Billing counter</h1>
            <p className="text-sm text-gray-600 mt-1">
              {loadingCatalog ? 'Loading catalog…' : `${catalog.length} products`}
              {isOffline && <span className="text-amber-600 ml-2">(offline cache)</span>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-outline btn-sm" onClick={() => void loadCatalog()} disabled={loadingCatalog}>
              Refresh catalog
            </button>
            <a href="/pos" className="btn btn-ghost btn-sm">
              Open POS
            </a>
          </div>
        </section>

        <section className="bg-white/95 backdrop-blur rounded-xl shadow p-5 space-y-3 border border-slate-200">
          <div className="flex flex-wrap gap-2">
            <input
              ref={manualEntryRef}
              className="input flex-1 min-w-[220px]"
              placeholder="Scan or type barcode / product name"
              value={manualEntry}
              onChange={(e) => setManualEntry(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  void addToBillByQuery(manualEntry)
                  setManualEntry('')
                }
              }}
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                void addToBillByQuery(manualEntry)
                setManualEntry('')
              }}
              disabled={loadingCatalog}
            >
              Add to bill
            </button>
            <button
              type="button"
              className="btn btn-secondary min-w-32"
              onClick={() => {
                setShowScanner(true)
                setTimeout(() => void startScanner(), 0)
              }}
              disabled={isScanStarting}
            >
              {isScanStarting ? 'Opening…' : 'Scan to bill'}
            </button>
          </div>
          <p className="text-xs text-gray-500">USB scanner: scan barcode then Enter. Camera: F8 or Scan to bill.</p>
        </section>

        <section className="bg-white/95 backdrop-blur rounded-xl shadow p-5 border border-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h2 className="text-lg font-semibold">Current bill</h2>
            <div className="text-lg font-semibold">Rs {cartTotal.toFixed(2)}</div>
          </div>
          <div className="mb-3 flex flex-wrap gap-2">
            {(['CASH', 'UPI', 'CARD', 'CREDIT'] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={`btn btn-sm ${paymentMethod === m ? 'btn-primary' : 'btn-outline'}`}
                onClick={() => setPaymentMethod(m)}
              >
                {m}
              </button>
            ))}
          </div>
          {cart.length === 0 ? (
            <p className="text-sm text-gray-600">No lines yet — scan products to add.</p>
          ) : (
            <div className="space-y-2">
              {cart.map((line) => (
                <div key={line.id} className="border rounded p-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-medium">{line.name}</div>
                    <div className="text-xs text-gray-600">{line.barcode || '—'}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => void updateLineQty(line.id, line.quantity - 1)}>
                      −
                    </button>
                    <span className="w-8 text-center text-sm">{line.quantity}</span>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => void updateLineQty(line.id, line.quantity + 1)}>
                      +
                    </button>
                    <span className="w-24 text-right text-sm">Rs {(line.price * line.quantity).toFixed(2)}</span>
                    <button type="button" className="btn btn-destructive btn-sm" onClick={() => void updateLineQty(line.id, 0)}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => void clearBill()} disabled={!cart.length}>
              Clear bill
            </button>
            <button type="button" className="btn btn-outline" onClick={printBill} disabled={!cart.length || isPrinting}>
              {isPrinting ? 'Printing…' : 'Print bill'}
            </button>
            <button type="button" className="btn btn-primary min-w-40" onClick={() => void completeSale()} disabled={!cart.length || isCheckoutLoading}>
              {isCheckoutLoading ? 'Completing…' : 'Complete sale'}
            </button>
          </div>
        </section>
      </main>

      {showScanner && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-3">
          <div className="bg-white rounded-xl w-full max-w-xl p-4 space-y-3 border border-slate-200">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Scan product</h3>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setShowScanner(false)
                  stopScanner()
                }}
              >
                Close
              </button>
            </div>
            {rearVideoInputs.length > 1 && (
              <div className="flex gap-2 flex-wrap">
                <select
                  className="input flex-1"
                  value={selectedRearDeviceId}
                  onChange={(e) => {
                    setSelectedRearDeviceId(e.target.value)
                    stopScanner()
                    setTimeout(() => void startScanner(), 80)
                  }}
                >
                  {rearVideoInputs.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() => {
                    const next = preferredFacingMode === 'environment' ? 'user' : 'environment'
                    setPreferredFacingMode(next)
                    stopScanner()
                    setTimeout(() => void startScanner(next), 80)
                  }}
                >
                  {preferredFacingMode === 'environment' ? 'Front camera' : 'Back camera'}
                </button>
              </div>
            )}
            <video ref={videoRef} className="w-full rounded bg-black max-h-[60vh]" autoPlay playsInline muted />
            <canvas ref={canvasRef} className="hidden" />
            <p className="text-sm text-gray-700">{scanStatus}</p>
            {scanError ? <p className="text-sm text-red-600">{scanError}</p> : null}
            <div className="flex gap-2">
              <input
                className="input flex-1"
                placeholder="Manual barcode"
                value={manualScanCode}
                onChange={(e) => setManualScanCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    void processScannedCode(manualScanCode, 'manual')
                    setManualScanCode('')
                  }
                }}
              />
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  void processScannedCode(manualScanCode, 'manual')
                  setManualScanCode('')
                }}
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
