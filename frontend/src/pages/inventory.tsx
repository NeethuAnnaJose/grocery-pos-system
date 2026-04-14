import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  DecodeHintType,
  BarcodeFormat,
  MultiFormatReader,
  BinaryBitmap,
  HybridBinarizer,
  RGBLuminanceSource,
} from '@zxing/library'
import {
  InventoryItem,
  createInventoryItem,
  deleteInventoryItem,
  listInventoryItems,
  updateInventoryItem,
} from '@/services/inventoryFirebase'

type FormState = {
  name: string
  barcode: string
  price: string
  quantity: string
  unit: string
}

type ScanEntry = {
  code: string
  name: string
  scannedAt: number
}

type CartEntry = {
  id: string
  name: string
  barcode: string
  price: number
  quantity: number
  unit: string
}

const emptyForm: FormState = {
  name: '',
  barcode: '',
  price: '',
  quantity: '1',
  unit: 'pcs',
}

const normalizeBarcode = (value: string) => String(value || '').trim().replace(/\s+/g, '').replace(/-/g, '')
const INVENTORY_CACHE_KEY = 'inventory_items_cache_v1'
const CART_CACHE_KEY = 'inventory_cart_cache_v1'

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState<FormState>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)

  const [showScanner, setShowScanner] = useState(false)
  const [preferredFacingMode, setPreferredFacingMode] = useState<'environment' | 'user'>('environment')
  const [rearVideoInputs, setRearVideoInputs] = useState<Array<{ id: string; label: string }>>([])
  const [selectedRearDeviceId, setSelectedRearDeviceId] = useState('')
  const [scanStatus, setScanStatus] = useState('')
  const [manualScanCode, setManualScanCode] = useState('')
  const [scanHistory, setScanHistory] = useState<ScanEntry[]>([])
  const [cart, setCart] = useState<CartEntry[]>([])

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const lastScannedRef = useRef('')
  const lastScanAtRef = useRef(0)
  const zxingReaderRef = useRef<MultiFormatReader | null>(null)

  const filteredItems = useMemo(() => {
    const key = search.trim().toLowerCase()
    if (!key) return items
    return items.filter((item) =>
      item.name.toLowerCase().includes(key) || item.barcode.toLowerCase().includes(key)
    )
  }, [items, search])

  const cartTotal = useMemo(
    () => cart.reduce((sum, entry) => sum + entry.price * entry.quantity, 0),
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
    } catch (error: any) {
      const fallback =
        typeof window !== 'undefined'
          ? JSON.parse(localStorage.getItem(INVENTORY_CACHE_KEY) || '[]')
          : []
      if (Array.isArray(fallback) && fallback.length) {
        setItems(fallback)
        toast.error('Firebase load failed. Showing cached items.')
      } else {
        toast.error(error?.message || 'Failed to load items from Firebase')
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
    if (Array.isArray(cached) && cached.length) {
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

    const lines = cart
      .map((entry) => {
        const lineTotal = entry.price * entry.quantity
        return `
          <tr>
            <td style="border:1px solid #ddd;padding:6px;">${entry.name}</td>
            <td style="border:1px solid #ddd;padding:6px;text-align:right;">${entry.quantity}</td>
            <td style="border:1px solid #ddd;padding:6px;text-align:right;">${entry.price.toFixed(2)}</td>
            <td style="border:1px solid #ddd;padding:6px;text-align:right;">${lineTotal.toFixed(2)}</td>
          </tr>
        `
      })
      .join('')

    const html = `
      <html>
      <head><title>Inventory Bill</title></head>
      <body style="font-family:Arial,sans-serif;padding:16px;">
        <h2 style="margin:0 0 8px;">Inventory Bill</h2>
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
          <tbody>${lines}</tbody>
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

    // Mobile fallback for blocked popups: print through hidden iframe.
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
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe)
        }
      }, 600)
    }, 300)
  }

  const processScannedCode = (rawCode: string) => {
    const code = normalizeBarcode(rawCode)
    if (!code) return

    const now = Date.now()
    if (lastScannedRef.current === code && now - lastScanAtRef.current < 1200) {
      return
    }
    lastScannedRef.current = code
    lastScanAtRef.current = now

    const match = items.find((item) => normalizeBarcode(item.barcode) === code)
    if (match) {
      setScanHistory((prev) => [{ code, name: match.name, scannedAt: now }, ...prev].slice(0, 20))
      addToCart(match)
      setScanStatus(`Added to cart: ${match.name}`)
      toast.success(`Added to cart: ${match.name}`)
      closeScanner()
      return
    }

    setForm((prev) => ({ ...prev, barcode: code }))
    setEditingId(null)
    setScanHistory((prev) => [{ code, name: 'New barcode', scannedAt: now }, ...prev].slice(0, 20))
    setScanStatus(`Captured new barcode: ${code}`)
    toast.success(`Captured: ${code}`)
    closeScanner()
  }

  const startScanner = async (facingMode: 'environment' | 'user' = preferredFacingMode) => {
    setScanStatus('Starting camera...')
    try {
      const rearList = facingMode === 'environment' ? await refreshRearVideoInputs() : []
      const rearDeviceId = facingMode === 'environment'
        ? (selectedRearDeviceId || rearList[0]?.id || '')
        : ''

      const fallbackFacingMode = facingMode === 'environment' ? 'user' : 'environment'
      const cameraConstraints: MediaStreamConstraints[] = [
        ...(rearDeviceId
          ? [{
              video: {
                deviceId: { exact: rearDeviceId },
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 24, max: 30 },
              },
            } as MediaStreamConstraints]
          : []),
        {
          video: {
            facingMode: { exact: facingMode },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30, max: 60 },
          },
        },
        {
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 24, max: 30 },
          },
        },
        {
          video: {
            facingMode: { ideal: fallbackFacingMode },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 24, max: 30 },
          },
        },
        { video: true },
      ]

      let stream: MediaStream | null = null
      for (const constraints of cameraConstraints) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints)
          break
        } catch {
          // Try next fallback
        }
      }
      if (!stream) {
        throw new Error('Could not start camera')
      }

      streamRef.current = stream
      const [videoTrack] = stream.getVideoTracks()
      if (videoTrack?.applyConstraints) {
        const capabilities = (videoTrack.getCapabilities?.() || {}) as any
        const advanced: any[] = []
        if (Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes('continuous')) {
          advanced.push({ focusMode: 'continuous' })
        }
        if (Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes('single-shot')) {
          advanced.push({ focusMode: 'single-shot' })
        }
        if (Array.isArray(capabilities.exposureMode) && capabilities.exposureMode.includes('continuous')) {
          advanced.push({ exposureMode: 'continuous' })
        }
        if (Array.isArray(capabilities.whiteBalanceMode) && capabilities.whiteBalanceMode.includes('continuous')) {
          advanced.push({ whiteBalanceMode: 'continuous' })
        }
        if (facingMode === 'environment' && typeof capabilities.zoom?.max === 'number') {
          const zoomTarget = Math.min(
            capabilities.zoom.max,
            Math.max(capabilities.zoom.min || 1, capabilities.zoom.max >= 1.4 ? 1.4 : capabilities.zoom.max)
          )
          if (Number.isFinite(zoomTarget) && zoomTarget > 1) {
            advanced.push({ zoom: zoomTarget })
          }
        }
        if (advanced.length) {
          await videoTrack.applyConstraints({ advanced }).catch(() => {})
        }
      }
      if (!videoRef.current) return
      videoRef.current.srcObject = stream
      await videoRef.current.play()

      const BarcodeDetectorCtor = (window as any).BarcodeDetector
      const detector = BarcodeDetectorCtor
        ? new BarcodeDetectorCtor({
            formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'],
          })
        : null

      if (!detector && !zxingReaderRef.current) {
        const hints = new Map()
        hints.set(DecodeHintType.POSSIBLE_FORMATS, [
          BarcodeFormat.EAN_13,
          BarcodeFormat.EAN_8,
          BarcodeFormat.UPC_A,
          BarcodeFormat.UPC_E,
          BarcodeFormat.CODE_128,
          BarcodeFormat.CODE_39,
          BarcodeFormat.ITF,
          BarcodeFormat.QR_CODE,
        ])
        const reader = new MultiFormatReader()
        reader.setHints(hints)
        zxingReaderRef.current = reader
      }

      intervalRef.current = setInterval(async () => {
        if (!videoRef.current || !canvasRef.current || videoRef.current.readyState < 2) return
        const canvas = canvasRef.current
        const video = videoRef.current
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.filter = 'grayscale(100%) contrast(180%) brightness(110%)'
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

        try {
          let value = ''
          if (detector) {
            const results = await detector.detect(canvas)
            value = results?.[0]?.rawValue || ''
          } else if (zxingReaderRef.current) {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
            const source = new RGBLuminanceSource(imageData.data, canvas.width, canvas.height)
            const bitmap = new BinaryBitmap(new HybridBinarizer(source))
            const result = zxingReaderRef.current.decode(bitmap)
            value = result?.getText?.() || ''
            zxingReaderRef.current.reset()
          }
          if (value) {
            processScannedCode(value)
          } else {
            setScanStatus('No barcode detected yet. Reposition and keep steady.')
          }
        } catch {
          // Ignore frame misses.
        }
      }, 80)
    } catch (error: any) {
      setScanStatus(error?.message || 'Failed to access camera')
      toast.error('Camera unavailable. Use manual scan input.')
    }
  }

  const handleSave = async () => {
    const name = form.name.trim()
    const barcode = normalizeBarcode(form.barcode)
    const price = Number(form.price)
    const quantity = Number(form.quantity)
    const unit = form.unit.trim() || 'pcs'

    if (!name) return toast.error('Item name is required')
    if (!barcode) return toast.error('Barcode is required')
    if (!Number.isFinite(price) || price < 0) return toast.error('Enter valid price')
    if (!Number.isInteger(quantity) || quantity < 0) return toast.error('Enter valid quantity')

    try {
      if (editingId) {
        await updateInventoryItem(editingId, { name, barcode, price, quantity, unit })
        toast.success('Item updated')
      } else {
        await createInventoryItem({ name, barcode, price, quantity, unit })
        toast.success('Item created')
      }
      setForm(emptyForm)
      setEditingId(null)
      await loadItems()
    } catch (error: any) {
      toast.error(error?.message || 'Failed to save item')
    }
  }

  const handleEdit = (item: InventoryItem) => {
    setEditingId(item.id)
    setForm({
      name: item.name,
      barcode: item.barcode,
      price: String(item.price),
      quantity: String(item.quantity),
      unit: item.unit || 'pcs',
    })
  }

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this item?')) return
    try {
      await deleteInventoryItem(id)
      toast.success('Item deleted')
      await loadItems()
      if (editingId === id) {
        setEditingId(null)
        setForm(emptyForm)
      }
    } catch (error: any) {
      toast.error(error?.message || 'Failed to delete item')
    }
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="bg-white border-b shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold">Inventory Scanner (Firebase)</h1>
          <p className="text-sm text-gray-600">Scan items, add to cart, and print bill.</p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        <div className="bg-white rounded-lg shadow p-4">
          <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
            <input
              className="input md:col-span-2"
              placeholder="Item name"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            />
            <input
              className="input md:col-span-2"
              placeholder="Barcode"
              value={form.barcode}
              onChange={(e) => setForm((prev) => ({ ...prev, barcode: e.target.value }))}
            />
            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              placeholder="Price"
              value={form.price}
              onChange={(e) => setForm((prev) => ({ ...prev, price: e.target.value }))}
            />
            <input
              className="input"
              type="number"
              min="0"
              step="1"
              placeholder="Quantity"
              value={form.quantity}
              onChange={(e) => setForm((prev) => ({ ...prev, quantity: e.target.value }))}
            />
            <input
              className="input"
              placeholder="Unit (pcs, kg)"
              value={form.unit}
              onChange={(e) => setForm((prev) => ({ ...prev, unit: e.target.value }))}
            />
            <button className="btn btn-secondary" onClick={() => { setForm(emptyForm); setEditingId(null) }}>
              Clear
            </button>
            <button className="btn btn-primary md:col-span-2" onClick={handleSave}>
              {editingId ? 'Update Item' : 'Add Item'}
            </button>
            <button
              className="btn btn-secondary md:col-span-2"
              onClick={() => {
                setShowScanner(true)
                setTimeout(() => startScanner(), 0)
              }}
            >
              Open Scanner
            </button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex gap-2">
            <input
              className="input"
              placeholder="Search by name/barcode"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button className="btn btn-secondary" onClick={loadItems}>Refresh</button>
          </div>
          <div className="mt-3 max-h-96 overflow-auto">
            {loading ? (
              <p className="text-sm text-gray-500">Loading...</p>
            ) : filteredItems.length === 0 ? (
              <p className="text-sm text-gray-500">No items yet.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Barcode</th>
                    <th>Price</th>
                    <th>Qty</th>
                    <th>Unit</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => (
                    <tr key={item.id}>
                      <td>{item.name}</td>
                      <td>{item.barcode}</td>
                      <td>{item.price}</td>
                      <td>{item.quantity}</td>
                      <td>{item.unit}</td>
                      <td className="space-x-2">
                        <button className="btn btn-primary btn-sm" onClick={() => addToCart(item)}>Add Cart</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => handleEdit(item)}>Edit</button>
                        <button className="btn btn-destructive btn-sm" onClick={() => handleDelete(item.id)}>Delete</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold">Cart</h3>
            <div className="text-sm font-semibold">Total: Rs {cartTotal.toFixed(2)}</div>
          </div>
          <div className="space-y-2 max-h-56 overflow-auto">
            {cart.length === 0 ? (
              <p className="text-sm text-gray-500">No items in cart.</p>
            ) : (
              cart.map((entry) => (
                <div className="flex items-center justify-between border rounded p-2" key={entry.id}>
                  <div>
                    <div className="text-sm font-medium">{entry.name}</div>
                    <div className="text-xs text-gray-600">{entry.barcode}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="btn btn-secondary btn-sm" onClick={() => updateCartQty(entry.id, entry.quantity - 1)}>-</button>
                    <span className="text-sm w-8 text-center">{entry.quantity}</span>
                    <button className="btn btn-secondary btn-sm" onClick={() => updateCartQty(entry.id, entry.quantity + 1)}>+</button>
                    <span className="text-sm w-20 text-right">Rs {(entry.price * entry.quantity).toFixed(2)}</span>
                    <button className="btn btn-destructive btn-sm" onClick={() => updateCartQty(entry.id, 0)}>Remove</button>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="mt-3 flex gap-2">
            <button
              className="btn btn-secondary"
              onClick={() => {
                setCart([])
                if (typeof window !== 'undefined') {
                  localStorage.removeItem(CART_CACHE_KEY)
                }
              }}
              disabled={cart.length === 0}
            >
              Clear Cart
            </button>
            <button className="btn btn-primary" onClick={printBill} disabled={cart.length === 0}>
              Print Bill
            </button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-4">
          <h3 className="font-semibold mb-2">Recent Scans</h3>
          <div className="space-y-1 max-h-40 overflow-auto">
            {scanHistory.length === 0 ? (
              <p className="text-sm text-gray-500">No scans yet.</p>
            ) : scanHistory.map((entry) => (
              <div className="text-sm border rounded p-2" key={`${entry.code}-${entry.scannedAt}`}>
                {entry.name} ({entry.code})
              </div>
            ))}
          </div>
        </div>
      </div>

      {showScanner && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-4">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-semibold">Scan Barcode</h3>
              <div className="flex gap-2">
                {preferredFacingMode === 'environment' && rearVideoInputs.length > 1 && (
                  <button
                    className="text-xs px-2 py-1 border rounded text-gray-700 hover:bg-gray-100"
                    onClick={() => {
                      const currentIndex = rearVideoInputs.findIndex((entry) => entry.id === selectedRearDeviceId)
                      const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % rearVideoInputs.length : 0
                      const nextId = rearVideoInputs[nextIndex]?.id || ''
                      if (!nextId) return
                      setSelectedRearDeviceId(nextId)
                      stopScanner()
                      setTimeout(() => startScanner('environment'), 100)
                    }}
                  >
                    Rear Lens {Math.max(1, rearVideoInputs.findIndex((entry) => entry.id === selectedRearDeviceId) + 1)}
                  </button>
                )}
                <button
                  className="text-xs px-2 py-1 border rounded text-gray-700 hover:bg-gray-100"
                  onClick={() => {
                    const next = preferredFacingMode === 'environment' ? 'user' : 'environment'
                    setPreferredFacingMode(next)
                    stopScanner()
                    setTimeout(() => startScanner(next), 100)
                  }}
                >
                  {preferredFacingMode === 'environment' ? 'Use Front Camera' : 'Use Rear Camera'}
                </button>
                <button className="text-sm text-gray-600" onClick={closeScanner}>Close</button>
              </div>
            </div>
            <div className="rounded bg-black overflow-hidden">
              <video ref={videoRef} className="w-full h-64 object-contain" muted playsInline />
              <canvas ref={canvasRef} className="hidden" />
            </div>
            <p className="text-xs text-gray-600 mt-2">{scanStatus}</p>
            {preferredFacingMode === 'environment' && (
              <p className="text-xs text-gray-500 mt-1">
                Rear camera tip: keep barcode 10-15 cm away and centered for fast focus lock.
              </p>
            )}
            <div className="mt-2 flex gap-2">
              <input
                className="input flex-1"
                placeholder="Manual barcode"
                value={manualScanCode}
                onChange={(e) => setManualScanCode(e.target.value)}
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
