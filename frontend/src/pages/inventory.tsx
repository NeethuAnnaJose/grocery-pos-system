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

const INVENTORY_CACHE_KEY = 'inventory_items_cache_v1'

const emptyForm: FormState = {
  name: '',
  barcode: '',
  price: '',
  quantity: '1',
  unit: 'pcs',
}

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

export default function InventoryPage() {
  const { authLoading, currentUserEmail } = useRequireAuth()
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState<FormState>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)

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

  const filteredItems = useMemo(() => {
    const key = search.trim().toLowerCase()
    if (!key) return items
    return items.filter(
      (item) => item.name.toLowerCase().includes(key) || item.barcode.toLowerCase().includes(key)
    )
  }, [items, search])

  const cacheItems = (nextItems: InventoryItem[]) => {
    setItems(nextItems)
    if (typeof window !== 'undefined') {
      localStorage.setItem(INVENTORY_CACHE_KEY, JSON.stringify(nextItems))
    }
  }

  const loadItems = async () => {
    try {
      setLoading(true)
      const data = await listInventoryItems()
      cacheItems(data)
    } catch (error: any) {
      const fallback =
        typeof window !== 'undefined' ? JSON.parse(localStorage.getItem(INVENTORY_CACHE_KEY) || '[]') : []
      if (Array.isArray(fallback) && fallback.length) {
        setItems(fallback)
        toast.error('Firebase load failed. Showing cached items.')
      } else {
        toast.error(error?.message || 'Failed to load inventory')
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadItems()
  }, [])

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

  const processScannedCode = (rawCode: string) => {
    const code = normalizeBarcode(rawCode)
    if (!code) return

    const now = Date.now()
    if (lastScannedRef.current === code && now - lastScanAtRef.current < 1200) return

    lastScannedRef.current = code
    lastScanAtRef.current = now

    const match = items.find((item) => itemMatchesBarcode(item, code))
    if (match) {
      setEditingId(match.id)
      setForm({
        name: match.name,
        barcode: match.barcode,
        price: String(match.price),
        quantity: String(match.quantity),
        unit: match.unit || 'pcs',
      })
      setScanStatus(`Matched existing item: ${match.name}`)
      toast.success(`Loaded: ${match.name}`)
      closeScanner()
      return
    }

    setEditingId(null)
    setForm((prev) => ({ ...prev, barcode: code }))
    setScanStatus(`Captured barcode: ${code}`)
    toast.success(`Captured: ${code}`)
    closeScanner()
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
      setScanStatus('Scanner is active')
    } catch (error: any) {
      setScanStatus(error?.message || 'Unable to open camera')
      toast.error(error?.message || 'Unable to open camera')
      closeScanner()
    }
  }

  const handleSave = async () => {
    const name = form.name.trim()
    const barcode = normalizeBarcode(form.barcode)
    const price = Number(form.price)
    const quantity = Number(form.quantity)
    const unit = form.unit.trim() || 'pcs'

    if (!name || !barcode || Number.isNaN(price) || Number.isNaN(quantity)) {
      toast.error('Name, barcode, price and quantity are required')
      return
    }

    if (editingId) {
      try {
        await updateInventoryItem(editingId, { name, barcode, price, quantity, unit })
        const next = items.map((item) =>
          item.id === editingId ? { ...item, name, barcode, price, quantity, unit } : item
        )
        cacheItems(next)
        toast.success('Item updated')
      } catch (error: any) {
        // Keep local cache updated even when Firebase is unavailable.
        const next = items.map((item) =>
          item.id === editingId ? { ...item, name, barcode, price, quantity, unit } : item
        )
        cacheItems(next)
        toast.error(error?.message || 'Firebase update failed. Updated locally.')
      }
    } else {
      try {
        const created = await createInventoryItem({ name, barcode, price, quantity, unit })
        cacheItems([created, ...items])
        toast.success('Item added')
      } catch (error: any) {
        // Keep local cache updated even when Firebase is unavailable.
        const localItem: InventoryItem = {
          id: `local-${Date.now()}`,
          name,
          barcode,
          price,
          quantity,
          unit,
          createdAt: null,
          updatedAt: null,
        }
        cacheItems([localItem, ...items])
        toast.error(error?.message || 'Firebase add failed. Saved locally.')
      }
    }

    setForm(emptyForm)
    setEditingId(null)
    setScanStatus('')
  }

  const handleDelete = async (itemId: string) => {
    const item = items.find((entry) => entry.id === itemId)
    if (!item) return
    if (!window.confirm(`Delete "${item.name}"?`)) return
    try {
      await deleteInventoryItem(itemId)
      cacheItems(items.filter((entry) => entry.id !== itemId))
      if (editingId === itemId) {
        setEditingId(null)
        setForm(emptyForm)
      }
      toast.success('Item deleted')
    } catch (error: any) {
      cacheItems(items.filter((entry) => entry.id !== itemId))
      if (editingId === itemId) {
        setEditingId(null)
        setForm(emptyForm)
      }
      toast.error(error?.message || 'Firebase delete failed. Removed locally.')
    }
  }

  if (authLoading) {
    return <div className="min-h-screen grid place-items-center text-gray-600">Checking login...</div>
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <AppHeader active="inventory" userEmail={currentUserEmail || undefined} />

      <main className="max-w-6xl mx-auto p-4 space-y-4">
        <section className="bg-white rounded-lg shadow p-4">
          <h1 className="text-xl font-semibold">Inventory Management</h1>
          <p className="text-sm text-gray-600 mt-1">
            Add or update stock here. Scanning here only fills barcode/item details.
          </p>
        </section>

        <section className="bg-white rounded-lg shadow p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <input
              className="input"
              placeholder="Item name"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            />
            <input
              className="input"
              placeholder="Barcode"
              value={form.barcode}
              onChange={(e) => setForm((prev) => ({ ...prev, barcode: e.target.value }))}
            />
            <input
              className="input"
              type="number"
              placeholder="Price"
              value={form.price}
              onChange={(e) => setForm((prev) => ({ ...prev, price: e.target.value }))}
            />
            <input
              className="input"
              type="number"
              placeholder="Quantity"
              value={form.quantity}
              onChange={(e) => setForm((prev) => ({ ...prev, quantity: e.target.value }))}
            />
            <input
              className="input"
              placeholder="Unit (pcs, kg, etc.)"
              value={form.unit}
              onChange={(e) => setForm((prev) => ({ ...prev, unit: e.target.value }))}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={handleSave}>
              {editingId ? 'Update Item' : 'Add Item'}
            </button>
            <button className="btn btn-secondary" onClick={startScanner}>
              Scan Barcode
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                setEditingId(null)
                setForm(emptyForm)
                setScanStatus('')
              }}
            >
              Clear Form
            </button>
          </div>
          {scanStatus ? <div className="text-sm text-blue-700">{scanStatus}</div> : null}
        </section>

        <section className="bg-white rounded-lg shadow p-4 space-y-3">
          <div className="flex flex-wrap gap-2 items-center justify-between">
            <h2 className="text-lg font-semibold">Inventory Items</h2>
            <input
              className="input w-full sm:w-72"
              placeholder="Search name or barcode"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {loading ? (
            <div className="text-sm text-gray-600">Loading items...</div>
          ) : filteredItems.length === 0 ? (
            <div className="text-sm text-gray-600">No items found.</div>
          ) : (
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2 pr-4">Name</th>
                    <th className="py-2 pr-4">Barcode</th>
                    <th className="py-2 pr-4">Price</th>
                    <th className="py-2 pr-4">Qty</th>
                    <th className="py-2 pr-4">Unit</th>
                    <th className="py-2 pr-4">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => (
                    <tr key={item.id} className="border-b">
                      <td className="py-2 pr-4">{item.name}</td>
                      <td className="py-2 pr-4">{item.barcode}</td>
                      <td className="py-2 pr-4">{Number(item.price || 0).toFixed(2)}</td>
                      <td className="py-2 pr-4">{item.quantity}</td>
                      <td className="py-2 pr-4">{item.unit || 'pcs'}</td>
                      <td className="py-2 pr-4">
                        <div className="flex gap-2">
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => {
                              setEditingId(item.id)
                              setForm({
                                name: item.name,
                                barcode: item.barcode,
                                price: String(item.price),
                                quantity: String(item.quantity),
                                unit: item.unit || 'pcs',
                              })
                            }}
                          >
                            Edit
                          </button>
                          <button className="btn btn-destructive btn-sm" onClick={() => handleDelete(item.id)}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {showScanner && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-3">
          <div className="bg-white rounded-lg w-full max-w-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Scan Barcode (Inventory)</h3>
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
            <div className="text-sm text-gray-700">{scanStatus || 'Point camera to barcode'}</div>
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
                Use
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
