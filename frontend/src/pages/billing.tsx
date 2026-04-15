import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  BinaryBitmap,
  BarcodeFormat,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} from '@zxing/library'
import { AppHeader } from '@/components/AppHeader'
import { useRequireAuth } from '@/hooks/useRequireAuth'
import { InventoryItem, listInventoryItems } from '@/services/inventoryFirebase'

type CartEntry = {
  id: string
  name: string
  barcode: string
  price: number
  quantity: number
  unit: string
}

const INVENTORY_CACHE_KEY = 'inventory_items_cache_v1'
const CART_CACHE_KEY = 'billing_cart_cache_v1'

const normalizeBarcode = (value: string) =>
  String(value || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/-/g, '')

const barcodeCandidates = (value: string) => {
  const normalized = normalizeBarcode(value)
  if (!normalized) return []
  const candidates = new Set<string>([normalized, normalized.toUpperCase()])
  if (/^\d+$/.test(normalized)) {
    const noLeadingZero = normalized.replace(/^0+/, '') || '0'
    candidates.add(noLeadingZero)
    if (normalized.length === 12) candidates.add(`0${normalized}`)
    if (normalized.length === 13 && normalized.startsWith('0')) candidates.add(normalized.slice(1))
  }
  return Array.from(candidates)
}

const itemMatchesBarcode = (item: InventoryItem, scannedValue: string) => {
  const itemCodes = new Set(barcodeCandidates(item.barcode || ''))
  if (!itemCodes.size) return false
  return barcodeCandidates(scannedValue).some((candidate) => itemCodes.has(candidate))
}

export default function BillingPage() {
  const { authLoading, currentUserEmail } = useRequireAuth()
  const [items, setItems] = useState<InventoryItem[]>([])
  const [cart, setCart] = useState<CartEntry[]>([])
  const [manualEntry, setManualEntry] = useState('')
  const [loading, setLoading] = useState(true)

  const [showScanner, setShowScanner] = useState(false)
  const [scanStatus, setScanStatus] = useState('')
  const [manualScanCode, setManualScanCode] = useState('')
  const [rearVideoInputs, setRearVideoInputs] = useState<Array<{ id: string; label: string }>>([])
  const [selectedRearDeviceId, setSelectedRearDeviceId] = useState('')

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastScannedRef = useRef('')
  const lastScanAtRef = useRef(0)
  const zxingReaderRef = useRef<MultiFormatReader | null>(null)

  const cartTotal = useMemo(
    () => cart.reduce((sum, entry) => sum + Number(entry.price || 0) * Number(entry.quantity || 0), 0),
    [cart]
  )

  const loadItems = async () => {
    try {
      setLoading(true)
      const data = await listInventoryItems()
      setItems(data)
      if (typeof window !== 'undefined') {
        localStorage.setItem(INVENTORY_CACHE_KEY, JSON.stringify(data))
      }
    } catch {
      const fallback =
        typeof window !== 'undefined' ? JSON.parse(localStorage.getItem(INVENTORY_CACHE_KEY) || '[]') : []
      if (Array.isArray(fallback)) {
        setItems(fallback)
        toast.error('Using cached inventory for billing')
      } else {
        toast.error('Failed to load inventory')
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadItems()
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const cached = JSON.parse(localStorage.getItem(CART_CACHE_KEY) || '[]')
    if (Array.isArray(cached)) {
      setCart(cached)
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem(CART_CACHE_KEY, JSON.stringify(cart))
  }, [cart])

  const stopScanner = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }

  useEffect(() => () => stopScanner(), [])

  const closeScanner = () => {
    setShowScanner(false)
    stopScanner()
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
      const videoDevices = devices.filter((entry) => entry.kind === 'videoinput')
      const ranked = [...videoDevices].sort((a, b) => scoreCameraLabel(b.label) - scoreCameraLabel(a.label))
      const likelyRear = ranked.filter((entry) => scoreCameraLabel(entry.label) >= 0)
      const usable = (likelyRear.length ? likelyRear : ranked).map((entry, index) => ({
        id: entry.deviceId,
        label: entry.label || `Camera ${index + 1}`,
      }))
      setRearVideoInputs(usable)
      if (!selectedRearDeviceId && usable[0]?.id) {
        setSelectedRearDeviceId(usable[0].id)
      }
      return usable
    } catch {
      return []
    }
  }

  const addToCart = (item: InventoryItem) => {
    setCart((prev) => {
      const existing = prev.find((entry) => entry.id === item.id)
      if (existing) {
        return prev.map((entry) =>
          entry.id === item.id ? { ...entry, quantity: entry.quantity + 1 } : entry
        )
      }
      return [
        ...prev,
        {
          id: item.id,
          name: item.name,
          barcode: item.barcode,
          price: Number(item.price || 0),
          quantity: 1,
          unit: item.unit || 'pcs',
        },
      ]
    })
  }

  const addToBillByQuery = (query: string) => {
    const value = query.trim()
    if (!value) return

    const normalized = normalizeBarcode(value)
    const barcodeMatches = items.filter((item) => itemMatchesBarcode(item, normalized))
    if (barcodeMatches.length > 0) {
      addToCart(barcodeMatches[0])
      toast.success(`Added: ${barcodeMatches[0].name}`)
      return
    }

    const lowered = value.toLowerCase()
    const exactName = items.find((item) => item.name.trim().toLowerCase() === lowered)
    if (exactName) {
      addToCart(exactName)
      toast.success(`Added: ${exactName.name}`)
      return
    }

    const contains = items.filter((item) => item.name.toLowerCase().includes(lowered))
    if (contains.length === 1) {
      addToCart(contains[0])
      toast.success(`Added: ${contains[0].name}`)
      return
    }
    if (contains.length > 1) {
      toast.error('Multiple items matched. Enter exact barcode or full name.')
      return
    }

    toast.error('Item not found in inventory. Add it in Inventory section first.')
  }

  const processScannedCode = (rawCode: string) => {
    const code = normalizeBarcode(rawCode)
    if (!code) return

    const now = Date.now()
    if (lastScannedRef.current === code && now - lastScanAtRef.current < 900) return
    lastScannedRef.current = code
    lastScanAtRef.current = now

    const match = items.find((item) => itemMatchesBarcode(item, code))
    if (!match) {
      setScanStatus(`Not found: ${code}`)
      toast.error(`Item not found for ${code}`)
      return
    }

    addToCart(match)
    setScanStatus(`Added to bill: ${match.name}`)
    toast.success(`Added: ${match.name}`)
  }

  const decodeWithCanvas = async () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) return

    const width = Math.max(1, video.videoWidth || 1280)
    const height = Math.max(1, video.videoHeight || 720)
    canvas.width = width
    canvas.height = height

    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    ctx.filter = 'grayscale(1) contrast(1.35) brightness(1.07)'
    ctx.drawImage(video, 0, 0, width, height)

    if ('BarcodeDetector' in window) {
      try {
        const detector = new (window as any).BarcodeDetector({
          formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'],
        })
        const results = await detector.detect(canvas)
        if (results?.[0]?.rawValue) {
          processScannedCode(String(results[0].rawValue))
          return
        }
      } catch {
        // Fallback to ZXing below.
      }
    }

    const image = ctx.getImageData(0, 0, width, height)
    if (!zxingReaderRef.current) {
      const hints = new Map()
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [
        BarcodeFormat.EAN_13,
        BarcodeFormat.EAN_8,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
        BarcodeFormat.CODE_128,
        BarcodeFormat.CODE_39,
        BarcodeFormat.ITF,
      ])
      zxingReaderRef.current = new MultiFormatReader()
      zxingReaderRef.current.setHints(hints)
    }
    try {
      const luminance = new RGBLuminanceSource(image.data, width, height)
      const binary = new BinaryBitmap(new HybridBinarizer(luminance))
      const result = zxingReaderRef.current.decode(binary)
      if (result?.getText()) {
        processScannedCode(result.getText())
      }
    } catch {
      // No readable barcode in this frame.
    }
  }

  const startScanner = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setScanStatus('Camera is not available in this browser.')
      return
    }

    setScanStatus('Opening camera...')
    setShowScanner(true)
    await refreshRearVideoInputs()

    try {
      const constraints: MediaStreamConstraints = {
        audio: false,
        video: selectedRearDeviceId
          ? {
              deviceId: { exact: selectedRearDeviceId },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            }
          : {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }

      if (intervalRef.current) clearInterval(intervalRef.current)
      intervalRef.current = setInterval(() => {
        decodeWithCanvas().catch(() => {})
      }, 220)
      setScanStatus('Scanner ready. Scan item to add directly.')
    } catch (error: any) {
      setScanStatus(error?.message || 'Unable to open camera')
      toast.error(error?.message || 'Unable to open camera')
      closeScanner()
    }
  }

  const updateCartQty = (id: string, nextQty: number) => {
    if (nextQty <= 0) {
      setCart((prev) => prev.filter((entry) => entry.id !== id))
      return
    }
    setCart((prev) => prev.map((entry) => (entry.id === id ? { ...entry, quantity: nextQty } : entry)))
  }

  const printBill = () => {
    if (cart.length === 0) {
      toast.error('Cart is empty')
      return
    }

    const rows = cart
      .map((entry) => {
        const lineTotal = Number(entry.price) * Number(entry.quantity)
        return `
          <tr>
            <td style="border:1px solid #ddd;padding:6px;">${entry.name}</td>
            <td style="border:1px solid #ddd;padding:6px;text-align:right;">${entry.quantity}</td>
            <td style="border:1px solid #ddd;padding:6px;text-align:right;">${Number(entry.price).toFixed(2)}</td>
            <td style="border:1px solid #ddd;padding:6px;text-align:right;">${lineTotal.toFixed(2)}</td>
          </tr>
        `
      })
      .join('')

    const html = `
      <html>
      <head><title>Billing Receipt</title></head>
      <body style="font-family:Arial,sans-serif;padding:16px;">
        <h2 style="margin:0 0 8px;">Billing Receipt</h2>
        <div style="margin-bottom:12px;">Date: ${new Date().toLocaleString()}</div>
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr>
              <th style="border:1px solid #ddd;padding:6px;text-align:left;">Item</th>
              <th style="border:1px solid #ddd;padding:6px;text-align:right;">Qty</th>
              <th style="border:1px solid #ddd;padding:6px;text-align:right;">Price</th>
              <th style="border:1px solid #ddd;padding:6px;text-align:right;">Total</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <h3 style="text-align:right;margin-top:12px;">Grand Total: Rs ${cartTotal.toFixed(2)}</h3>
      </body>
      </html>
    `

    const popup = window.open('', '_blank', 'width=900,height=700')
    if (popup) {
      popup.document.write(html)
      popup.document.close()
      popup.onload = () => {
        popup.focus()
        popup.print()
      }
      return
    }

    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    document.body.appendChild(iframe)
    const frameDoc = iframe.contentDocument || iframe.contentWindow?.document
    if (!frameDoc) {
      document.body.removeChild(iframe)
      toast.error('Could not initialize print view')
      return
    }
    frameDoc.open()
    frameDoc.write(html)
    frameDoc.close()
    setTimeout(() => {
      iframe.contentWindow?.focus()
      iframe.contentWindow?.print()
      setTimeout(() => {
        if (document.body.contains(iframe)) document.body.removeChild(iframe)
      }, 600)
    }, 300)
  }

  if (authLoading) {
    return <div className="min-h-screen grid place-items-center text-gray-600">Checking login...</div>
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <AppHeader active="billing" userEmail={currentUserEmail || undefined} />

      <main className="max-w-6xl mx-auto p-4 space-y-4">
        <section className="bg-white rounded-lg shadow p-4">
          <h1 className="text-xl font-semibold">Billing Counter</h1>
          <p className="text-sm text-gray-600 mt-1">
            Billing view only shows items that you add to the bill. Inventory list is hidden here.
          </p>
        </section>

        <section className="bg-white rounded-lg shadow p-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <input
              className="input flex-1 min-w-[220px]"
              placeholder="Enter barcode or item name"
              value={manualEntry}
              onChange={(e) => setManualEntry(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  addToBillByQuery(manualEntry)
                  setManualEntry('')
                }
              }}
            />
            <button
              className="btn btn-primary"
              onClick={() => {
                addToBillByQuery(manualEntry)
                setManualEntry('')
              }}
              disabled={loading}
            >
              Add To Bill
            </button>
            <button className="btn btn-secondary" onClick={startScanner}>
              Scan To Bill
            </button>
            <button className="btn btn-outline" onClick={loadItems}>
              Refresh Inventory Source
            </button>
          </div>
          <div className="text-xs text-gray-600">
            {loading ? 'Loading inventory source...' : `${items.length} inventory items available for lookup`}
          </div>
        </section>

        <section className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Current Bill</h2>
            <div className="text-lg font-semibold">Rs {cartTotal.toFixed(2)}</div>
          </div>

          {cart.length === 0 ? (
            <div className="text-sm text-gray-600">No items in bill yet.</div>
          ) : (
            <div className="space-y-2">
              {cart.map((entry) => (
                <div key={entry.id} className="border rounded p-2 flex items-center justify-between gap-2">
                  <div>
                    <div className="font-medium">{entry.name}</div>
                    <div className="text-xs text-gray-600">{entry.barcode}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="btn btn-secondary btn-sm" onClick={() => updateCartQty(entry.id, entry.quantity - 1)}>
                      -
                    </button>
                    <span className="w-8 text-center text-sm">{entry.quantity}</span>
                    <button className="btn btn-secondary btn-sm" onClick={() => updateCartQty(entry.id, entry.quantity + 1)}>
                      +
                    </button>
                    <span className="w-24 text-right text-sm">Rs {(entry.price * entry.quantity).toFixed(2)}</span>
                    <button className="btn btn-destructive btn-sm" onClick={() => updateCartQty(entry.id, 0)}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="btn btn-secondary"
              onClick={() => {
                setCart([])
                if (typeof window !== 'undefined') localStorage.removeItem(CART_CACHE_KEY)
              }}
              disabled={cart.length === 0}
            >
              Clear Bill
            </button>
            <button className="btn btn-primary" onClick={printBill} disabled={cart.length === 0}>
              Print Bill
            </button>
          </div>
        </section>
      </main>

      {showScanner && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-3">
          <div className="bg-white rounded-lg w-full max-w-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Scan Barcode (Billing)</h3>
              <button className="btn btn-ghost btn-sm" onClick={closeScanner}>
                Close
              </button>
            </div>
            {rearVideoInputs.length > 0 && (
              <select
                className="input"
                value={selectedRearDeviceId}
                onChange={(e) => setSelectedRearDeviceId(e.target.value)}
              >
                {rearVideoInputs.map((cam) => (
                  <option key={cam.id} value={cam.id}>
                    {cam.label}
                  </option>
                ))}
              </select>
            )}
            <video ref={videoRef} className="w-full rounded bg-black max-h-[60vh]" autoPlay playsInline muted />
            <canvas ref={canvasRef} className="hidden" />
            <div className="text-sm text-gray-700">{scanStatus || 'Scan item to add directly to bill'}</div>
            <div className="flex gap-2">
              <input
                className="input flex-1"
                placeholder="Manual barcode entry"
                value={manualScanCode}
                onChange={(e) => setManualScanCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    processScannedCode(manualScanCode)
                    setManualScanCode('')
                  }
                }}
              />
              <button
                className="btn btn-primary"
                onClick={() => {
                  processScannedCode(manualScanCode)
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
