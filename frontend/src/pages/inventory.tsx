import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import toast from 'react-hot-toast'
import { BinaryBitmap, BarcodeFormat, DecodeHintType, HybridBinarizer, MultiFormatReader, RGBLuminanceSource } from '@zxing/library'
import { drawVideoToDecodeCanvas } from '@/lib/drawVideoToDecodeCanvas'
import { decodeQuaggaFromCanvas } from '@/lib/quaggaFrameDecode'
import { AppHeader } from '@/components/AppHeader'
import { useRequireAuth } from '@/hooks/useRequireAuth'
import {
  InventoryItem,
  createInventoryItem,
  deleteInventoryItem,
  listInventoryItems,
  updateInventoryItem,
} from '@/services/inventoryFirebase'
import { hasFirebaseConfig } from '@/lib/firebase'
import { loadInventoryFromLocal, mergeInventoryLists, saveInventoryToLocal } from '@/services/inventoryLocalStore'
import { itemsAPI, productAPI } from '@/services/api'

type FormState = {
  name: string
  barcode: string
  price: string
  quantity: string
  unit: string
}

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

const getStoreJwt = () => (typeof window !== 'undefined' ? localStorage.getItem('token') : null)

const mapApiRowToInventoryItem = (row: any): InventoryItem => ({
  id: row.id,
  name: row.name || '',
  barcode: String(row.barcode || ''),
  price: Number(row.price || 0),
  quantity: Number(row.quantity || 0),
  unit: row.unit || 'pcs',
})

export default function InventoryPage() {
  const router = useRouter()
  const { authLoading, currentUserEmail } = useRequireAuth()
  const [items, setItems] = useState<InventoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState<FormState>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)

  const [showScanner, setShowScanner] = useState(false)
  const [scanStatus, setScanStatus] = useState('')
  const [manualScanCode, setManualScanCode] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isScannerStarting, setIsScannerStarting] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)
  const [torchEnabled, setTorchEnabled] = useState(false)
  const [rearVideoInputs, setRearVideoInputs] = useState<Array<{ id: string; label: string }>>([])
  const [selectedRearDeviceId, setSelectedRearDeviceId] = useState('')

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const detectorRef = useRef<any | null>(null)
  const isDecodingRef = useRef(false)
  const scanRafRef = useRef<number | null>(null)
  const lastScannedRef = useRef('')
  const lastScanAtRef = useRef(0)
  const lastQuaggaAttemptRef = useRef(0)
  const zxingReaderRef = useRef<MultiFormatReader | null>(null)
  const itemsRef = useRef<InventoryItem[]>([])
  const itemCategoryIdsRef = useRef<Map<string, string>>(new Map())
  const scannerBufferRef = useRef('')
  const scannerBufferTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const filteredItems = useMemo(() => {
    const key = search.trim().toLowerCase()
    if (!key) return items
    return items.filter(
      (item) => item.name.toLowerCase().includes(key) || item.barcode.toLowerCase().includes(key)
    )
  }, [items, search])
  const barcodeIndex = useMemo(() => {
    const map = new Map<string, InventoryItem>()
    for (const item of items) {
      for (const key of barcodeCandidates(item.barcode || '')) {
        if (!map.has(key)) {
          map.set(key, item)
        }
      }
    }
    return map
  }, [items])

  const cacheItems = (nextItems: InventoryItem[]) => {
    setItems(nextItems)
    if (!getStoreJwt()) {
      saveInventoryToLocal(nextItems)
    }
  }

  const loadItems = useCallback(async () => {
    try {
      setLoading(true)
      const token = getStoreJwt()
      if (token) {
        itemCategoryIdsRef.current.clear()
        const response = await itemsAPI.getItems({ limit: 2000 })
        const rows = Array.isArray(response.data?.data?.items) ? response.data.data.items : []
        for (const r of rows) {
          if (r?.id && r?.categoryId) itemCategoryIdsRef.current.set(r.id, r.categoryId)
        }
        setItems(rows.map(mapApiRowToInventoryItem))
        return
      }

      const local = loadInventoryFromLocal()
      if (local.length) {
        setItems(local)
      }

      if (!hasFirebaseConfig) {
        cacheItems(local)
        if (!local.length) {
          toast('Add items — they are saved on this device (browser storage).')
        }
        return
      }

      try {
        const remote = await listInventoryItems()
        const merged = mergeInventoryLists(remote, loadInventoryFromLocal())
        cacheItems(merged)
      } catch (error: any) {
        const stillLocal = loadInventoryFromLocal()
        if (stillLocal.length) {
          setItems(stillLocal)
          toast.error('Could not reach cloud. Showing saved inventory on this device.')
        } else {
          toast.error(error?.message || 'Failed to load inventory')
        }
      }
    } catch {
      if (getStoreJwt()) {
        toast.error('Could not load store inventory. Sign in on Billing (store login) first, then refresh.')
        setItems([])
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadItems()
  }, [loadItems])

  useEffect(() => {
    const onRoute = () => void loadItems()
    router.events.on('routeChangeComplete', onRoute)
    return () => router.events.off('routeChangeComplete', onRoute)
  }, [router.events, loadItems])

  useEffect(() => {
    itemsRef.current = items
  }, [items])

  const stopScanner = () => {
    if (scanRafRef.current !== null) {
      cancelAnimationFrame(scanRafRef.current)
      scanRafRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setTorchSupported(false)
    setTorchEnabled(false)
    detectorRef.current = null
    isDecodingRef.current = false
  }

  useEffect(() => () => stopScanner(), [])

  useEffect(() => {
    const handleHardwareScanner = (event: KeyboardEvent) => {
      if (event.key === 'F8') {
        event.preventDefault()
        void startScanner()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        nameInputRef.current?.focus()
        return
      }

      const target = event.target as HTMLElement | null
      const isEditableTarget =
        !!target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      if (isEditableTarget) return

      if (event.key === 'Enter') {
        const buffered = scannerBufferRef.current.trim()
        scannerBufferRef.current = ''
        if (scannerBufferTimerRef.current) {
          clearTimeout(scannerBufferTimerRef.current)
          scannerBufferTimerRef.current = null
        }
        if (buffered.length >= 6) {
          event.preventDefault()
          processScannedCode(buffered)
        }
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

    window.addEventListener('keydown', handleHardwareScanner)
    return () => {
      window.removeEventListener('keydown', handleHardwareScanner)
      if (scannerBufferTimerRef.current) clearTimeout(scannerBufferTimerRef.current)
    }
  }, [items, selectedRearDeviceId])

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
    if (lastScannedRef.current === code && now - lastScanAtRef.current < 400) return

    lastScannedRef.current = code
    lastScanAtRef.current = now

    const quickMatch = barcodeCandidates(code).map((candidate) => barcodeIndex.get(candidate)).find(Boolean) || null
    const match = quickMatch || itemsRef.current.find((item) => itemMatchesBarcode(item, code))
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
    if (isDecodingRef.current) return
    isDecodingRef.current = true
    try {
      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas || video.readyState < 2) return

      const detectOnSurface = async (
        surface: NonNullable<ReturnType<typeof drawVideoToDecodeCanvas>>,
        opts: { allowQuagga: boolean; tryHarder: boolean }
      ) => {
        const { ctx, dw, dh } = surface

        if ('BarcodeDetector' in window) {
          try {
            if (!detectorRef.current) {
              detectorRef.current = new (window as any).BarcodeDetector({
                formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'],
              })
            }
            const results = await detectorRef.current.detect(canvas)
            if (results?.[0]?.rawValue) {
              processScannedCode(String(results[0].rawValue))
              return true
            }
          } catch {
            // Fallback to ZXing below.
          }
        }

        try {
          const image = ctx.getImageData(0, 0, dw, dh)
          if (!zxingReaderRef.current) {
            zxingReaderRef.current = new MultiFormatReader()
          }
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
          if (opts.tryHarder) {
            hints.set(DecodeHintType.TRY_HARDER, true)
          }
          zxingReaderRef.current.setHints(hints)
          const luminance = new RGBLuminanceSource(image.data, dw, dh)
          const binary = new BinaryBitmap(new HybridBinarizer(luminance))
          const result = zxingReaderRef.current.decode(binary)
          if (result?.getText()) {
            processScannedCode(result.getText())
            return true
          }
        } catch {
          // ZXing miss — optional Quagga below (final pass only; throttled).
        }

        if (!opts.allowQuagga) return false

        const now = Date.now()
        if (now - lastQuaggaAttemptRef.current < 320) return false
        lastQuaggaAttemptRef.current = now
        const qText = await decodeQuaggaFromCanvas(canvas, { maxSide: 560, timeoutMs: 300 })
        if (qText) {
          processScannedCode(qText)
          return true
        }
        return false
      }

      const surface1 = drawVideoToDecodeCanvas(video, canvas, 'grayscale(1) contrast(1.35) brightness(1.1)')
      if (!surface1) return
      if (await detectOnSurface(surface1, { allowQuagga: false, tryHarder: false })) return

      const surface2 = drawVideoToDecodeCanvas(video, canvas, 'grayscale(1) contrast(1.9) brightness(1.4)')
      if (!surface2) return
      await detectOnSurface(surface2, { allowQuagga: true, tryHarder: true })
    } finally {
      isDecodingRef.current = false
    }
  }

  const applyCameraEnhancements = async (stream: MediaStream) => {
    const track = stream.getVideoTracks()[0]
    if (!track || !track.applyConstraints) return
    const capabilities = (track.getCapabilities?.() || {}) as any
    const advanced: any[] = []

    if (Array.isArray(capabilities.focusMode) && capabilities.focusMode.includes('continuous')) {
      advanced.push({ focusMode: 'continuous' })
    }
    if (Array.isArray(capabilities.exposureMode) && capabilities.exposureMode.includes('continuous')) {
      advanced.push({ exposureMode: 'continuous' })
    }
    if (Array.isArray(capabilities.whiteBalanceMode) && capabilities.whiteBalanceMode.includes('continuous')) {
      advanced.push({ whiteBalanceMode: 'continuous' })
    }
    if (typeof capabilities.zoom?.max === 'number' && capabilities.zoom.max > 1) {
      const zoomValue = Math.min(capabilities.zoom.max, Math.max(capabilities.zoom.min || 1, 1.2))
      advanced.push({ zoom: zoomValue })
    }

    if (advanced.length) {
      await track.applyConstraints({ advanced }).catch(() => {})
    }

    const supportsTorch = !!capabilities.torch
    setTorchSupported(supportsTorch)
  }

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks?.()[0]
    if (!track?.applyConstraints) return
    const next = !torchEnabled
    try {
      await track.applyConstraints({ advanced: [{ torch: next }] as any }).catch(() => {})
      setTorchEnabled(next)
    } catch {
      toast.error('Torch is not supported on this device')
    }
  }

  const startScanner = async (preferredDeviceId = '') => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setScanStatus('Camera is not available in this browser.')
      return
    }

    setScanStatus('Opening camera...')
    setIsScannerStarting(true)
    setShowScanner(true)
    const rearList = await refreshRearVideoInputs()

    try {
      const preferredRearId = preferredDeviceId || selectedRearDeviceId || rearList[0]?.id || ''
      const options: MediaStreamConstraints[] = [
        ...(preferredRearId
          ? [{
              audio: false,
              video: {
                deviceId: { exact: preferredRearId },
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                frameRate: { ideal: 30, max: 60 },
              },
            }]
          : []),
        {
          audio: false,
          video: {
            facingMode: { exact: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30, max: 60 },
          },
        },
        {
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 24, max: 30 },
          },
        },
        { audio: false, video: true },
      ]

      let stream: MediaStream | null = null
      for (const constraints of options) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints)
          break
        } catch {
          // Continue through fallbacks
        }
      }
      if (!stream) throw new Error('Unable to access camera')
      streamRef.current = stream
      await applyCameraEnhancements(stream)
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play().catch(() => {})
      }

      const tick = () => {
        scanRafRef.current = requestAnimationFrame(tick)
        decodeWithCanvas().catch(() => {})
      }
      scanRafRef.current = requestAnimationFrame(tick)
      setScanStatus('Scanner is active')
    } catch (error: any) {
      setScanStatus(error?.message || 'Unable to open camera')
      toast.error(error?.message || 'Unable to open camera')
      closeScanner()
    } finally {
      setIsScannerStarting(false)
    }
  }

  const handleSave = async () => {
    if (isSaving) return
    const name = form.name.trim()
    const barcode = normalizeBarcode(form.barcode)
    const price = Number(form.price)
    const quantity = Number(form.quantity)
    const unit = form.unit.trim() || 'pcs'

    if (!name || !barcode || Number.isNaN(price) || Number.isNaN(quantity)) {
      toast.error('Name, barcode, price and quantity are required')
      return
    }

    if (!editingId) {
      const existingByBarcode = items.find((item) => itemMatchesBarcode(item, barcode))
      if (existingByBarcode) {
        toast.error('This barcode already exists. Use Edit instead of adding duplicate.')
        setEditingId(existingByBarcode.id)
        setForm({
          name: existingByBarcode.name,
          barcode: existingByBarcode.barcode,
          price: String(existingByBarcode.price),
          quantity: String(existingByBarcode.quantity),
          unit: existingByBarcode.unit || 'pcs',
        })
        return
      }
    }

    setIsSaving(true)
    if (editingId) {
      try {
        if (getStoreJwt()) {
          const categoryId = itemCategoryIdsRef.current.get(editingId)
          const res = await itemsAPI.updateItem(editingId, {
            name,
            barcode,
            price,
            costPrice: price,
            quantity,
            unit,
            ...(categoryId ? { categoryId } : {}),
          })
          const updated = res.data?.data?.item
          const prevRow = items.find((i) => i.id === editingId)
          const mapped = updated
            ? mapApiRowToInventoryItem(updated)
            : prevRow
              ? { ...prevRow, name, barcode, price, quantity, unit }
              : mapApiRowToInventoryItem({ id: editingId, name, barcode, price, quantity, unit })
          if (updated?.categoryId) itemCategoryIdsRef.current.set(editingId, updated.categoryId)
          const next = items.map((item) => (item.id === editingId ? mapped : item))
          setItems(next)
          toast.success('Item updated')
        } else {
          await updateInventoryItem(editingId, { name, barcode, price, quantity, unit })
          const next = items.map((item) =>
            item.id === editingId ? { ...item, name, barcode, price, quantity, unit } : item
          )
          cacheItems(next)
          toast.success('Item updated')
        }
      } catch (error: any) {
        if (getStoreJwt()) {
          toast.error(error?.response?.data?.message || error?.message || 'Update failed')
        } else {
          const next = items.map((item) =>
            item.id === editingId ? { ...item, name, barcode, price, quantity, unit } : item
          )
          cacheItems(next)
          toast.error(error?.message || 'Firebase update failed. Updated locally.')
        }
      }
    } else {
      try {
        if (getStoreJwt()) {
          await productAPI.createProduct({
            name,
            barcode,
            price,
            costPrice: price,
            quantity,
            unit,
          })
          await loadItems()
          toast.success('Item added to store')
        } else {
          const created = await createInventoryItem({ name, barcode, price, quantity, unit })
          cacheItems([created, ...items])
          toast.success('Item added')
        }
      } catch (error: any) {
        if (getStoreJwt()) {
          toast.error(error?.response?.data?.message || error?.message || 'Could not add item')
        } else {
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
    }

    setForm(emptyForm)
    setEditingId(null)
    setScanStatus('')
    setIsSaving(false)
  }

  const handleDelete = async (itemId: string) => {
    const item = items.find((entry) => entry.id === itemId)
    if (!item) return
    if (!window.confirm(`Delete "${item.name}"?`)) return
    try {
      if (getStoreJwt()) {
        await itemsAPI.deleteItem(itemId)
        itemCategoryIdsRef.current.delete(itemId)
        setItems(items.filter((entry) => entry.id !== itemId))
      } else {
        await deleteInventoryItem(itemId)
        cacheItems(items.filter((entry) => entry.id !== itemId))
      }
      if (editingId === itemId) {
        setEditingId(null)
        setForm(emptyForm)
      }
      toast.success('Item deleted')
    } catch (error: any) {
      if (getStoreJwt()) {
        toast.error(error?.response?.data?.message || error?.message || 'Delete failed')
      } else {
        cacheItems(items.filter((entry) => entry.id !== itemId))
        if (editingId === itemId) {
          setEditingId(null)
          setForm(emptyForm)
        }
        toast.error(error?.message || 'Firebase delete failed. Removed locally.')
      }
    }
  }

  if (authLoading) {
    return <div className="min-h-screen grid place-items-center text-gray-600">Checking login...</div>
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-100 to-slate-200">
      <AppHeader active="inventory" userEmail={currentUserEmail || undefined} />

      <main className="max-w-6xl mx-auto p-4 space-y-4">
        <section className="bg-white/95 backdrop-blur rounded-xl shadow p-5 border border-slate-200">
          <h1 className="text-xl font-semibold">Inventory Management</h1>
          <p className="text-sm text-gray-600 mt-1">
            Add or update stock here. Scanning here only fills barcode/item details.
          </p>
          {getStoreJwt() ? (
            <p className="text-sm text-green-800 bg-green-50 border border-green-200 rounded-lg px-3 py-2 mt-3">
              <strong>Store database mode:</strong> this list is the same catalog as <strong>POS</strong> and{' '}
              <strong>Billing</strong> (PostgreSQL). Scans on Billing will find these products.
            </p>
          ) : (
            <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-3">
              <strong>Local / Firebase mode:</strong> products here are{' '}
              <strong>not</strong> the same as Billing or POS until you sign in to the store. Open{' '}
              <a href="/billing" className="text-blue-700 underline font-medium">
                Billing
              </a>
              , use <strong>Connect store</strong> (staff login), then return here — the page will load your real shop
              inventory.
            </p>
          )}
        </section>

        <section className="bg-white/95 backdrop-blur rounded-xl shadow p-5 space-y-3 border border-slate-200">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <input
              ref={nameInputRef}
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
            <button className="btn btn-primary min-w-32" onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Saving...' : editingId ? 'Update Item' : 'Add Item'}
            </button>
            <button className="btn btn-secondary min-w-32" onClick={() => void startScanner()} disabled={isScannerStarting}>
              {isScannerStarting ? 'Opening...' : 'Scan Barcode'}
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

        <section className="bg-white/95 backdrop-blur rounded-xl shadow p-5 space-y-3 border border-slate-200">
          <div className="flex flex-wrap gap-2 items-center justify-between">
            <h2 className="text-lg font-semibold">Inventory Items</h2>
            <input
              ref={searchInputRef}
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
          <div className="bg-white rounded-xl w-full max-w-xl p-4 space-y-3 border border-slate-200">
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
                onChange={(e) => {
                  const nextId = e.target.value
                  setSelectedRearDeviceId(nextId)
                  if (!showScanner) return
                  stopScanner()
                  setScanStatus('Switching camera...')
                  void startScanner(nextId)
                }}
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
            {torchSupported ? (
              <button className="btn btn-outline btn-sm" onClick={toggleTorch}>
                {torchEnabled ? 'Torch Off' : 'Torch On'}
              </button>
            ) : null}
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
