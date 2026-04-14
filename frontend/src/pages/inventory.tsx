import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
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

const emptyForm: FormState = {
  name: '',
  barcode: '',
  price: '',
  quantity: '1',
  unit: 'pcs',
}

const normalizeBarcode = (value: string) => String(value || '').trim().replace(/\s+/g, '').replace(/-/g, '')

export default function InventoryPage() {
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState<FormState>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)

  const [showScanner, setShowScanner] = useState(false)
  const [scanStatus, setScanStatus] = useState('')
  const [manualScanCode, setManualScanCode] = useState('')
  const [scanHistory, setScanHistory] = useState<ScanEntry[]>([])

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const lastScannedRef = useRef('')
  const lastScanAtRef = useRef(0)

  const filteredItems = useMemo(() => {
    const key = search.trim().toLowerCase()
    if (!key) return items
    return items.filter((item) =>
      item.name.toLowerCase().includes(key) || item.barcode.toLowerCase().includes(key)
    )
  }, [items, search])

  const loadItems = async () => {
    try {
      setLoading(true)
      const data = await listInventoryItems()
      setItems(data)
    } catch (error: any) {
      toast.error(error?.message || 'Failed to load items from Firebase')
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
      setScanStatus(`Found: ${match.name}`)
      toast.success(`Found item: ${match.name}`)
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

  const startScanner = async () => {
    setScanStatus('Starting camera...')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      })

      streamRef.current = stream
      if (!videoRef.current) return
      videoRef.current.srcObject = stream
      await videoRef.current.play()

      const BarcodeDetectorCtor = (window as any).BarcodeDetector
      if (!BarcodeDetectorCtor) {
        setScanStatus('Live camera barcode not supported on this browser. Use manual barcode input below.')
        return
      }

      const detector = new BarcodeDetectorCtor({
        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'],
      })

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
          const results = await detector.detect(canvas)
          const value = results?.[0]?.rawValue || ''
          if (value) {
            processScannedCode(value)
          } else {
            setScanStatus('No barcode detected yet. Reposition and keep steady.')
          }
        } catch {
          // Ignore frame misses.
        }
      }, 110)
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
          <p className="text-sm text-gray-600">No billing, no revenue. Just scan and store data.</p>
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
              <button className="text-sm text-gray-600" onClick={closeScanner}>Close</button>
            </div>
            <div className="rounded bg-black overflow-hidden">
              <video ref={videoRef} className="w-full h-64 object-contain" muted playsInline />
              <canvas ref={canvasRef} className="hidden" />
            </div>
            <p className="text-xs text-gray-600 mt-2">{scanStatus}</p>
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
