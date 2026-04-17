import { useState, useEffect, useRef, useMemo } from 'react'
import { useRouter } from 'next/router'
import { useSelector, useDispatch } from 'react-redux'
import { RootState, AppDispatch } from '@/store'
import { addToCart, removeFromCart, updateQuantity, clearCart, setCustomer, setPaymentMethod } from '@/store/slices/cartSlice'
import { itemsAPI, customersAPI, ordersAPI, categoriesAPI, productAPI } from '@/services/api'
import toast from 'react-hot-toast'

interface Item {
  id: string
  name: string
  price: number
  costPrice?: number
  quantity: number
  barcode?: string
  unit?: string
  categoryId?: string
  category?: { id: string; name: string } | null
}

interface Customer {
  id: string
  name: string
  phone: string
  email?: string
}

interface Category {
  id: string
  name: string
}

interface ScannedListEntry {
  id: string
  name: string
  barcode?: string
  price: number
  scannedAt: number
}

type ScanMode = 'LIST' | 'CART'

export default function POS() {
  const router = useRouter()
  const dispatch = useDispatch<AppDispatch>()
  const { items, subtotal, discount, gstAmount, totalAmount, customerId, paymentMethod } = useSelector((state: RootState) => state.cart)
  const { user } = useSelector((state: RootState) => state.auth)

  const [availableItems, setAvailableItems] = useState<Item[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [showCustomerModal, setShowCustomerModal] = useState(false)
  const [showScanner, setShowScanner] = useState(false)
  const [scanMode, setScanMode] = useState<ScanMode>('CART')
  const [scanStatus, setScanStatus] = useState('')
  const [scanError, setScanError] = useState('')
  const [isScanStarting, setIsScanStarting] = useState(false)
  const [isSoundReady, setIsSoundReady] = useState(false)
  const [isOffline, setIsOffline] = useState(false)
  const [lastScannedCode, setLastScannedCode] = useState('')
  const [lastScannedItemId, setLastScannedItemId] = useState('')
  const [scannedItemsList, setScannedItemsList] = useState<ScannedListEntry[]>([])
  const [preferredFacingMode, setPreferredFacingMode] = useState<'environment' | 'user'>('environment')
  const [rearVideoInputs, setRearVideoInputs] = useState<Array<{ id: string; label: string }>>([])
  const [selectedRearDeviceId, setSelectedRearDeviceId] = useState('')
  const [manualScanCode, setManualScanCode] = useState('')
  const [pendingScannedBarcode, setPendingScannedBarcode] = useState('')
  const [newItemFromScan, setNewItemFromScan] = useState({
    name: '',
    price: '',
    costPrice: '',
    quantity: '1',
    categoryId: '',
    unit: 'pcs',
  })
  const [manualItem, setManualItem] = useState({
    name: '',
    price: '',
    quantity: '1',
  })
  const [editingItem, setEditingItem] = useState<Item | null>(null)
  const [editItemForm, setEditItemForm] = useState({
    name: '',
    barcode: '',
    price: '',
    costPrice: '',
    quantity: '',
    unit: 'pcs',
    categoryId: '',
  })
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const imageScanInputRef = useRef<HTMLInputElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scanIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const zxingReaderRef = useRef<any>(null)
  const processScanRef = useRef<(code: string, source?: 'camera' | 'manual' | 'external-scanner' | 'image') => Promise<void>>()
  const lastScanAtRef = useRef<number>(0)
  const scanMissCountRef = useRef<number>(0)
  const isProcessingScanRef = useRef(false)
  const lastFetchErrorAtRef = useRef(0)
  const localBarcodeMapRef = useRef<Map<string, Item>>(new Map())
  const cameraCandidateRef = useRef<{ code: string; count: number }>({ code: '', count: 0 })
  const audioContextRef = useRef<AudioContext | null>(null)
  const lastBeepAtRef = useRef(0)
  const scannerBufferRef = useRef<string>('')
  const scannerBufferTimerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    fetchItems()
    fetchCategories()
    fetchCustomers()
    setIsOffline(typeof navigator !== 'undefined' ? !navigator.onLine : false)
  }, [])

  useEffect(() => {
    const onOnline = () => setIsOffline(false)
    const onOffline = () => setIsOffline(true)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      stopScanner()
    }
  }, [])

  useEffect(() => {
    const onKeyDown = async (event: KeyboardEvent) => {
      if (event.key === 'F8') {
        event.preventDefault()
        unlockAudio()
        setShowScanner(true)
        setTimeout(() => {
          startScanner()
        }, 0)
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
        return
      }

      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        const buffered = scannerBufferRef.current.trim()
        scannerBufferRef.current = ''
        if (scannerBufferTimerRef.current) {
          clearTimeout(scannerBufferTimerRef.current)
          scannerBufferTimerRef.current = null
        }
        if (buffered.length >= 6) {
          await processScanRef.current?.(buffered, 'external-scanner')
        }
        return
      }
      if (event.key.length === 1) {
        scannerBufferRef.current += event.key
        if (scannerBufferTimerRef.current) {
          clearTimeout(scannerBufferTimerRef.current)
        }
        scannerBufferTimerRef.current = setTimeout(() => {
          scannerBufferRef.current = ''
        }, 120)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      if (scannerBufferTimerRef.current) {
        clearTimeout(scannerBufferTimerRef.current)
      }
    }
  }, [])

  const fetchItems = async () => {
    try {
      // Keep a larger local catalog so barcode lookup works for most stores without extra API calls.
      const response = await itemsAPI.getItems({ limit: 1000 })
      const itemsData = Array.isArray(response.data?.data?.items) ? response.data.data.items : []
      setAvailableItems(itemsData)
      if (typeof window !== 'undefined') {
        localStorage.setItem('cached_products', JSON.stringify(itemsData))
      }
    } catch (error) {
      const cached =
        typeof window !== 'undefined'
          ? JSON.parse(localStorage.getItem('cached_products') || '[]')
          : []
      if (Array.isArray(cached) && cached.length) {
        setAvailableItems(cached)
        setIsOffline(true)
        if (Date.now() - lastFetchErrorAtRef.current > 5000) {
          toast.error('Offline mode: using cached products')
          lastFetchErrorAtRef.current = Date.now()
        }
      } else {
        if (Date.now() - lastFetchErrorAtRef.current > 5000) {
          toast.error('Failed to fetch items')
          lastFetchErrorAtRef.current = Date.now()
        }
        setAvailableItems([])
      }
    }
  }

  const fetchCustomers = async () => {
    try {
      const response = await customersAPI.getCustomers({ limit: 50 })
      setCustomers(Array.isArray(response.data?.data?.customers) ? response.data.data.customers : [])
    } catch (error) {
      toast.error('Failed to fetch customers')
      setCustomers([])
    }
  }

  const fetchCategories = async () => {
    try {
      const response = await categoriesAPI.getCategories()
      const fetchedCategories = Array.isArray(response.data?.data?.categories) ? response.data.data.categories : []
      setCategories(fetchedCategories)
      if (fetchedCategories.length > 0) {
        setNewItemFromScan((prev) => ({
          ...prev,
          categoryId: prev.categoryId || fetchedCategories[0].id,
        }))
      }
    } catch {
      setCategories([])
    }
  }

  const normalizeBarcode = (value: string) => {
    const raw = String(value || '').trim()
    if (!raw) return ''
    const compact = raw.replace(/\s+/g, '').replace(/-/g, '')
    if (/^\d+$/.test(compact)) {
      return compact
    }
    return compact.toUpperCase()
  }

  const barcodeCandidates = (value: string) => {
    const normalized = normalizeBarcode(value)
    if (!normalized) return []
    const candidates = new Set<string>([normalized])
    if (/^\d+$/.test(normalized)) {
      const noLeadingZero = normalized.replace(/^0+/, '') || '0'
      candidates.add(noLeadingZero)
      if (normalized.length === 12) {
        candidates.add(`0${normalized}`)
      }
      if (normalized.length === 13 && normalized.startsWith('0')) {
        candidates.add(normalized.slice(1))
      }
    }
    return Array.from(candidates)
  }

  const itemMatchesBarcode = (item: Item, scannedValue: string) => {
    const itemCandidates = barcodeCandidates(item.barcode || '')
    if (!itemCandidates.length) return false
    const scannedCandidates = new Set(barcodeCandidates(scannedValue))
    return itemCandidates.some((candidate) => scannedCandidates.has(candidate))
  }

  useEffect(() => {
    const map = new Map<string, Item>()
    for (const item of availableItems) {
      for (const key of barcodeCandidates(item.barcode || '')) {
        map.set(key, item)
      }
    }
    localBarcodeMapRef.current = map
  }, [availableItems])

  const isExpectedDecodeMiss = (error: any) => {
    const name = String(error?.name || '')
    const message = String(error?.message || '')
    return (
      name === 'NotFoundException' ||
      /no multiformat readers were able to detect the code/i.test(message) ||
      /not found/i.test(message)
    )
  }

  const playScanBeep = (type: 'success' | 'captured' = 'success') => {
    try {
      const now = Date.now()
      if (now - lastBeepAtRef.current < 120) {
        return
      }
      lastBeepAtRef.current = now

      const AudioCtx =
        typeof window !== 'undefined'
          ? ((window as any).AudioContext || (window as any).webkitAudioContext)
          : null
      if (!AudioCtx) {
        return
      }
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioCtx()
      }
      const ctx = audioContextRef.current
      if (!ctx) {
        return
      }
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {})
      }

      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = type === 'success' ? 920 : 720
      gain.gain.setValueAtTime(0.0001, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.09)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.1)
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(type === 'success' ? 40 : 20)
      }
    } catch {
      // Ignore beep failures silently.
    }
  }

  const unlockAudio = async () => {
    try {
      const AudioCtx =
        typeof window !== 'undefined'
          ? ((window as any).AudioContext || (window as any).webkitAudioContext)
          : null
      if (!AudioCtx) return
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioCtx()
      }
      const ctx = audioContextRef.current
      if (!ctx) return
      if (ctx.state === 'suspended') {
        await ctx.resume()
      }
      setIsSoundReady(true)
      playScanBeep('captured')
    } catch {
      // Audio unlock is optional.
    }
  }

  const fetchProductByBarcode = async (code: string) => {
    const normalizedCode = normalizeBarcode(code)
    if (!normalizedCode) return null

    // Instant path: resolve from locally cached inventory first.
    for (const candidate of barcodeCandidates(normalizedCode)) {
      const hit = localBarcodeMapRef.current.get(candidate)
      if (hit) {
        return hit
      }
    }

    if (isOffline) {
      return null
    }

    try {
      const response = await productAPI.getByBarcode(normalizedCode)
      const product = response.data?.data?.product
      return product || null
    } catch {
      const localMatch = availableItems.find((item) => itemMatchesBarcode(item, normalizedCode))
      return localMatch || null
    }
  }

  const handleAddToCart = async (item: Item) => {
    if (item.quantity === 0) {
      toast.error('Item is out of stock')
      return
    }

    const cartItem = items.find(cartItem => cartItem.id === item.id)
    const currentQuantity = cartItem ? cartItem.quantity : 0

    if (currentQuantity >= item.quantity) {
      toast.error('Insufficient stock')
      return
    }

    try {
      // Reserve one unit at cart stage to lock stock and avoid race conditions.
      await itemsAPI.updateStock(item.id, {
        quantity: 1,
        type: 'STOCK_OUT',
        reason: 'Reserved in cart',
      })

      dispatch(addToCart({
        id: item.id,
        name: item.name,
        price: item.price,
        barcode: item.barcode,
        unit: item.unit,
      }))
      setAvailableItems((prev) =>
        prev.map((p) =>
          p.id === item.id ? { ...p, quantity: Math.max(0, p.quantity - 1) } : p
        )
      )
    } catch (error: any) {
      if (!error?.response) {
        // Offline/network fallback: keep billing flow running, sync stock later.
        dispatch(addToCart({
          id: item.id,
          name: item.name,
          price: item.price,
          barcode: item.barcode,
          unit: item.unit,
        }))
        setAvailableItems((prev) =>
          prev.map((p) =>
            p.id === item.id ? { ...p, quantity: Math.max(0, p.quantity - 1) } : p
          )
        )
        toast.success(`${item.name} added (offline mode)`)
        return
      }
      toast.error(error.response?.data?.message || 'Could not reserve stock')
    }
  }

  const stopScanner = () => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current)
      scanIntervalRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    cameraCandidateRef.current = { code: '', count: 0 }
  }

  const closeScannerModal = () => {
    setShowScanner(false)
    stopScanner()
  }

  const startEditingItem = (item: Item) => {
    setEditingItem(item)
    setEditItemForm({
      name: item.name || '',
      barcode: item.barcode || '',
      price: String(item.price ?? ''),
      costPrice: String(item.costPrice ?? item.price ?? ''),
      quantity: String(item.quantity ?? 0),
      unit: item.unit || 'pcs',
      categoryId: item.category?.id || item.categoryId || '',
    })
  }

  const handleSaveItemEdit = async () => {
    if (!editingItem) return
    const name = editItemForm.name.trim()
    const barcode = editItemForm.barcode.trim()
    const price = Number(editItemForm.price)
    const costPrice = Number(editItemForm.costPrice || editItemForm.price)
    const quantity = Number(editItemForm.quantity)
    const unit = (editItemForm.unit || 'pcs').trim()

    if (!name) return toast.error('Item name is required')
    if (!barcode) return toast.error('Barcode is required')
    if (!Number.isFinite(price) || price < 0) return toast.error('Enter valid selling price')
    if (!Number.isFinite(costPrice) || costPrice < 0) return toast.error('Enter valid cost price')
    if (!Number.isInteger(quantity) || quantity < 0) return toast.error('Enter valid quantity')

    try {
      const response = await itemsAPI.updateItem(editingItem.id, {
        name,
        barcode,
        price,
        costPrice,
        quantity,
        unit: unit || 'pcs',
        ...(editItemForm.categoryId ? { categoryId: editItemForm.categoryId } : {}),
      })
      const updated = response.data?.data?.item || response.data?.data?.product
      if (updated) {
        setAvailableItems((prev) => prev.map((entry) => (entry.id === updated.id ? updated : entry)))
      } else {
        await fetchItems()
      }
      setScannedItemsList((prev) =>
        prev.map((entry) =>
          entry.id === editingItem.id
            ? { ...entry, name, barcode, price }
            : entry
        )
      )
      setEditingItem(null)
      toast.success('Item updated')
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to update item')
    }
  }

  const handleDeleteItem = async (item: Item) => {
    const confirmed = window.confirm(`Delete "${item.name}"? This will remove it from active items.`)
    if (!confirmed) return
    try {
      await itemsAPI.deleteItem(item.id)
      setAvailableItems((prev) => prev.filter((entry) => entry.id !== item.id))
      setScannedItemsList((prev) => prev.filter((entry) => entry.id !== item.id))
      dispatch(removeFromCart(item.id))
      if (editingItem?.id === item.id) {
        setEditingItem(null)
      }
      toast.success('Item deleted')
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to delete item')
    }
  }

  const processScannedCode = async (rawCode: string, source: 'camera' | 'manual' | 'external-scanner' | 'image' = 'camera') => {
    if (isProcessingScanRef.current) {
      return
    }
    const code = String(rawCode || '').trim()
    if (!code) {
      return
    }

    // Debounce duplicate scans unless user explicitly enters manually.
    const now = Date.now()
    const normalizedCode = normalizeBarcode(code)
    if (source !== 'manual' && normalizedCode === lastScannedCode && now - lastScanAtRef.current < 1300) {
      return
    }
    lastScanAtRef.current = now
    setLastScannedCode(normalizedCode)
    setScanStatus(`Scanning (${source})...`)

    isProcessingScanRef.current = true
    try {
      const matchedItem = await fetchProductByBarcode(normalizedCode)
      if (matchedItem) {
        playScanBeep('success')
        closeScannerModal()
        if (scanMode === 'CART') {
          await handleAddToCart(matchedItem)
          setScanStatus(`Product added to cart: ${matchedItem.name}`)
          toast.success(`Added to cart: ${matchedItem.name}`)
        } else {
          setScannedItemsList((prev) => {
            const next = [{ id: matchedItem.id, name: matchedItem.name, barcode: matchedItem.barcode, price: matchedItem.price, scannedAt: now }, ...prev]
            return next.slice(0, 50)
          })
          setScanStatus(`Added to scanned list: ${matchedItem.name}`)
          toast.success(`Added to list: ${matchedItem.name}`)
        }
        setLastScannedItemId(matchedItem.id)
        setPendingScannedBarcode('')
      } else {
        playScanBeep('captured')
        closeScannerModal()
        setSearchTerm(normalizedCode)
        setPendingScannedBarcode(normalizedCode)
        setScanStatus('New barcode captured. Add product details below.')
        if (scanMode === 'CART') {
          toast.error(`Product not found for barcode ${normalizedCode}`)
        } else {
          toast.success(`Captured barcode ${normalizedCode}. Fill details to add.`)
        }
      }
    } finally {
      isProcessingScanRef.current = false
    }
  }

  useEffect(() => {
    processScanRef.current = processScannedCode
  }, [availableItems, items, scanMode, lastScannedCode])

  const decodeBarcodeFromImageFile = async (file: File) => {
    if (!file) {
      return
    }

    const objectUrl = URL.createObjectURL(file)
    try {
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('Failed to load image'))
        img.src = objectUrl
      })

      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth || img.width
      canvas.height = img.naturalHeight || img.height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        toast.error('Could not process image')
        return
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

      const BarcodeDetectorCtor = (window as any).BarcodeDetector
      let decodedValue = ''

      if (BarcodeDetectorCtor) {
        const detector = new BarcodeDetectorCtor({
          formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'],
        })
        const results = await detector.detect(canvas)
        decodedValue = results?.[0]?.rawValue || ''
      }

      if (!decodedValue) {
        const zxing = await import('@zxing/library')
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
        try {
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
          const source = new zxing.RGBLuminanceSource(imageData.data, canvas.width, canvas.height)
          const bitmap = new zxing.BinaryBitmap(new zxing.HybridBinarizer(source))
          const result = reader.decode(bitmap)
          decodedValue = result?.getText?.() || ''
        } finally {
          reader.reset()
        }
      }

      if (decodedValue) {
        await processScannedCode(decodedValue, 'image')
      } else {
        toast.error('No barcode detected in selected image')
      }
    } catch (error: any) {
      if (isExpectedDecodeMiss(error)) {
        setScanStatus('No barcode found in image. Move closer and retry.')
      } else {
        toast.error('Failed to scan image')
      }
    } finally {
      URL.revokeObjectURL(objectUrl)
      if (imageScanInputRef.current) {
        imageScanInputRef.current.value = ''
      }
    }
  }

  const handleCreateItemFromScan = async () => {
    const name = newItemFromScan.name.trim()
    const barcode = pendingScannedBarcode.trim()
    const price = Number(newItemFromScan.price)
    const costPrice = Number(newItemFromScan.costPrice || newItemFromScan.price)
    const quantity = Number(newItemFromScan.quantity)

    if (!barcode) {
      toast.error('Scan barcode first')
      return
    }
    if (!name) {
      toast.error('Enter item name')
      return
    }
    if (!Number.isFinite(price) || price <= 0) {
      toast.error('Enter valid price')
      return
    }
    if (!Number.isFinite(costPrice) || costPrice < 0) {
      toast.error('Enter valid cost price')
      return
    }
    if (!Number.isInteger(quantity) || quantity < 0) {
      toast.error('Enter valid quantity')
      return
    }

    try {
      const response = await productAPI.createProduct({
        name,
        barcode,
        ...(newItemFromScan.categoryId ? { categoryId: newItemFromScan.categoryId } : {}),
        price,
        costPrice,
        quantity,
        unit: newItemFromScan.unit || 'pcs',
      })

      const createdItem = response.data?.data?.product
      if (createdItem) {
        setAvailableItems((prev) => [createdItem, ...prev])
      } else {
        await fetchItems()
      }
      setPendingScannedBarcode('')
      setNewItemFromScan((prev) => ({
        ...prev,
        name: '',
        price: '',
        costPrice: '',
        quantity: '1',
      }))

      if (createdItem && scanMode === 'CART') {
        await handleAddToCart(createdItem)
      }
      if (createdItem && scanMode === 'LIST') {
        setScannedItemsList((prev) => [
          { id: createdItem.id, name: createdItem.name, barcode: createdItem.barcode, price: createdItem.price, scannedAt: Date.now() },
          ...prev,
        ])
      }
      toast.success(scanMode === 'CART' ? 'Item created and added to cart' : 'Item created and added to scanned list')
    } catch (error: any) {
      const serverMessage =
        error?.response?.data?.message ||
        error?.response?.data?.errors?.[0]?.msg
      toast.error(serverMessage || 'Failed to create item')
    }
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
    const nav = typeof navigator !== 'undefined' ? navigator : null
    try {
      const devices = await nav?.mediaDevices?.enumerateDevices?.()
      const videoDevices = (devices || []).filter((d) => d.kind === 'videoinput')
      if (!videoDevices.length) {
        setRearVideoInputs([])
        setSelectedRearDeviceId('')
        return ''
      }
      const ranked = [...videoDevices].sort((a, b) => scoreCameraLabel(b.label) - scoreCameraLabel(a.label))
      const likelyRear = ranked.filter((device) => scoreCameraLabel(device.label) >= 0)
      const usableList = (likelyRear.length > 0 ? likelyRear : ranked).map((device, index) => ({
        id: device.deviceId,
        label: device.label?.trim() || `Camera ${index + 1}`,
      }))

      const hasCurrent = usableList.some((d) => d.id === selectedRearDeviceId)
      const resolvedId = hasCurrent ? selectedRearDeviceId : (usableList[0]?.id || '')

      setRearVideoInputs(usableList)
      if (resolvedId !== selectedRearDeviceId) {
        setSelectedRearDeviceId(resolvedId)
      }
      return resolvedId
    } catch {
      return selectedRearDeviceId
    }
  }

  const startScanner = async (facingMode: 'environment' | 'user' = preferredFacingMode) => {
    setIsScanStarting(true)
    setScanError('')
    setScanStatus(`Scanning for ${scanMode === 'CART' ? 'cart billing' : 'inventory list'}...`)
    const nav = typeof navigator !== 'undefined' ? navigator : null
    const isInsecureContext = typeof window !== 'undefined' && !window.isSecureContext
    const isMobileBrowser =
      !!nav &&
      /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent || '')
    const secureContextHint = isInsecureContext
      ? isMobileBrowser
        ? ' Open this POS over HTTPS (or localhost) on mobile to allow camera.'
        : ' Use HTTPS to allow camera in this browser context.'
      : ''
    try {
      const getUserMedia =
        nav?.mediaDevices?.getUserMedia?.bind(nav.mediaDevices) ||
        ((constraints: MediaStreamConstraints) => {
          const legacyGetUserMedia =
            (nav as any)?.getUserMedia ||
            (nav as any)?.webkitGetUserMedia ||
            (nav as any)?.mozGetUserMedia ||
            (nav as any)?.msGetUserMedia

          if (!legacyGetUserMedia) {
            return Promise.reject(new Error('Camera API not available'))
          }

          return new Promise<MediaStream>((resolve, reject) => {
            legacyGetUserMedia.call(nav as Navigator, constraints, resolve, reject)
          })
        })

      const fallbackFacingMode = facingMode === 'environment' ? 'user' : 'environment'
      const rearDeviceId =
        facingMode === 'environment'
          ? (selectedRearDeviceId || (await refreshRearVideoInputs()))
          : ''
      const cameraConstraints: MediaStreamConstraints[] = [
        ...(rearDeviceId
          ? [
              {
                video: {
                  deviceId: { exact: rearDeviceId },
                  width: { ideal: 1280 },
                  height: { ideal: 720 },
                  frameRate: { ideal: 24, max: 30 },
                },
              } as MediaStreamConstraints,
            ]
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
      let streamError: any = null
      for (const constraints of cameraConstraints) {
        try {
          stream = await getUserMedia(constraints)
          break
        } catch (err) {
          streamError = err
        }
      }
      if (!stream) {
        throw streamError || new Error('Could not access camera')
      }

      streamRef.current = stream
      const [videoTrack] = stream.getVideoTracks()
      if (facingMode === 'environment') {
        await refreshRearVideoInputs()
      }
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
        if (facingMode === 'environment') {
          if (typeof capabilities.zoom?.max === 'number') {
            const zoomTarget = Math.min(
              capabilities.zoom.max,
              Math.max(capabilities.zoom.min || 1, capabilities.zoom.max >= 1.4 ? 1.4 : capabilities.zoom.max)
            )
            if (Number.isFinite(zoomTarget) && zoomTarget > 1) {
              advanced.push({ zoom: zoomTarget })
            }
          }
          if (typeof capabilities.focusDistance?.max === 'number') {
            const nearFocus = Math.max(
              capabilities.focusDistance.min || 0,
              Math.min(capabilities.focusDistance.max, capabilities.focusDistance.max * 0.75)
            )
            if (Number.isFinite(nearFocus) && nearFocus > 0) {
              advanced.push({ focusDistance: nearFocus })
            }
          }
        }
        if (advanced.length > 0) {
          await videoTrack.applyConstraints({ advanced }).catch(() => {
            // Ignore unsupported advanced constraints.
          })
        }
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.muted = true
        videoRef.current.setAttribute('playsinline', 'true')
        videoRef.current.setAttribute('autoplay', 'true')
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play().catch(() => {
            // We already show manual fallback; ignore autoplay failures.
          })
        }
        await videoRef.current.play()
        if (!videoRef.current.videoWidth || !videoRef.current.videoHeight) {
          setScanError('Camera started but no video frames received. Try switching camera app permission or reload scanner.')
        }
      }

      const BarcodeDetectorCtor = (window as any).BarcodeDetector
      const scanFormats = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code']
      const detector = BarcodeDetectorCtor
        ? new BarcodeDetectorCtor({ formats: scanFormats })
        : null
      const confirmationThreshold = detector ? 1 : 2

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
        if (!videoRef.current || !canvasRef.current || videoRef.current.readyState < 2) {
          return
        }
        const video = videoRef.current
        const canvas = canvasRef.current
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          return
        }
        ctx.filter = 'grayscale(100%) contrast(180%) brightness(110%)'
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

        try {
          let firstValue = ''
          if (detector) {
            const results = await detector.detect(canvas)
            firstValue = results?.[0]?.rawValue || ''
          } else if (zxingReaderRef.current) {
            const { zxing, reader } = zxingReaderRef.current
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
            const source = new zxing.RGBLuminanceSource(imageData.data, canvas.width, canvas.height)
            const bitmap = new zxing.BinaryBitmap(new zxing.HybridBinarizer(source))
            const result = reader.decode(bitmap)
            firstValue = result?.getText?.() || result?.text || ''
            reader.reset()
          }

          if (firstValue) {
            const normalizedFrameCode = normalizeBarcode(firstValue)
            const currentCandidate = cameraCandidateRef.current
            if (currentCandidate.code === normalizedFrameCode) {
              currentCandidate.count += 1
            } else {
              cameraCandidateRef.current = { code: normalizedFrameCode, count: 1 }
            }

            if (cameraCandidateRef.current.count >= confirmationThreshold) {
              scanMissCountRef.current = 0
              cameraCandidateRef.current = { code: '', count: 0 }
              await processScannedCode(normalizedFrameCode)
            }
          } else {
            scanMissCountRef.current += 1
            if (scanMissCountRef.current % 8 === 0) {
              setScanStatus('No barcode detected yet. Reposition barcode and keep steady.')
            }
          }
        } catch (frameError: any) {
          const notFound = isExpectedDecodeMiss(frameError)
          if (zxingReaderRef.current) {
            zxingReaderRef.current.reader?.reset?.()
          }
          if (!notFound) {
            setScanStatus('Scanner frame issue detected. Retrying...')
          }
        }
      }, 90)
    } catch (error: any) {
      const errorName = error?.name || ''
      const errorMessage = error?.message || ''

      if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError') {
        setScanError(`Camera permission denied.${secureContextHint} Allow camera access in browser settings, or use manual barcode entry below.`)
      } else if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
        setScanError('No camera device found. Connect a camera or use manual barcode entry below.')
      } else if (
        errorName === 'NotSupportedError' ||
        errorName === 'TypeError' ||
        /camera api not available/i.test(errorMessage)
      ) {
        setScanError(`Camera is not available in this browser/context.${secureContextHint} Use manual barcode entry below.`)
      } else {
        setScanError(`${errorMessage || 'Could not access camera'}.${secureContextHint} Use manual barcode entry below.`)
      }
    } finally {
      setIsScanStarting(false)
    }
  }

  const handleCheckout = async () => {
    const hasCustomItems = items.some((item: any) => item.isCustom)
    if (hasCustomItems) {
      toast.error('Custom/manual items are for instant print only. Use Print Instant Bill.')
      return
    }

    if (items.length === 0) {
      toast.error('Cart is empty')
      return
    }

    setIsLoading(true)

    try {
      const orderData = {
        orderItems: items.map(item => ({
          itemId: item.id,
          quantity: item.quantity,
          discount: item.discount || 0,
        })),
        customerId: customerId || undefined,
        paymentMethod,
        discount,
        stockReserved: true,
      }

      const response = await ordersAPI.createOrder(orderData)
      
      toast.success('Order created successfully')
      dispatch(clearCart())
      await fetchItems()
      
      // Print receipt or open invoice
      if (response.data?.data?.order) {
        window.open(`/invoice/${response.data.data.order.id}`, '_blank')
      }
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to create order')
    } finally {
      setIsLoading(false)
    }
  }

  const handleQuantityChange = async (cartItem: any, nextQuantity: number) => {
    if (nextQuantity < 1) {
      return
    }

    const diff = nextQuantity - cartItem.quantity
    if (diff === 0) {
      return
    }

    try {
      if (cartItem.isCustom) {
        dispatch(updateQuantity({ id: cartItem.id, quantity: nextQuantity }))
        return
      }

      if (diff > 0) {
        await itemsAPI.updateStock(cartItem.id, {
          quantity: diff,
          type: 'STOCK_OUT',
          reason: 'Reserved in cart',
        })
      } else {
        await itemsAPI.updateStock(cartItem.id, {
          quantity: Math.abs(diff),
          type: 'STOCK_IN',
          reason: 'Released from cart',
        })
      }
      dispatch(updateQuantity({ id: cartItem.id, quantity: nextQuantity }))
      await fetchItems()
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Stock update failed')
    }
  }

  const handleRemoveFromCart = async (cartItem: any) => {
    try {
      if (cartItem.isCustom) {
        dispatch(removeFromCart(cartItem.id))
        return
      }

      await itemsAPI.updateStock(cartItem.id, {
        quantity: cartItem.quantity,
        type: 'STOCK_IN',
        reason: 'Released from cart',
      })
      dispatch(removeFromCart(cartItem.id))
      await fetchItems()
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to release stock')
    }
  }

  const handleClearCart = async () => {
    try {
      for (const cartItem of items) {
        if (cartItem.isCustom) {
          continue
        }
        await itemsAPI.updateStock(cartItem.id, {
          quantity: cartItem.quantity,
          type: 'STOCK_IN',
          reason: 'Released from cart clear',
        })
      }
      dispatch(clearCart())
      await fetchItems()
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to clear cart')
    }
  }

  const handleAddManualItem = () => {
    const name = manualItem.name.trim()
    const price = Number(manualItem.price)
    const quantity = Number(manualItem.quantity)

    if (!name) {
      toast.error('Enter manual item name')
      return
    }
    if (!Number.isFinite(price) || price <= 0) {
      toast.error('Enter valid manual item price')
      return
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      toast.error('Enter valid quantity')
      return
    }

    const id = `manual-${Date.now()}`
    dispatch(addToCart({
      id,
      name,
      price,
      unit: 'pcs',
      isCustom: true,
    }))
    if (quantity > 1) {
      dispatch(updateQuantity({ id, quantity }))
    }

    setManualItem({ name: '', price: '', quantity: '1' })
    toast.success('Manual item added')
  }

  const handleInstantPrint = () => {
    if (items.length === 0) {
      toast.error('Cart is empty')
      return
    }

    const customerName = selectedCustomer?.name || 'Walk-in Customer'
    const lines = items.map((item) => {
      const lineTotal = item.price * item.quantity
      return `
        <tr>
          <td style="padding:6px;border:1px solid #ddd;">${item.name}${(item as any).isCustom ? ' (Manual)' : ''}</td>
          <td style="padding:6px;border:1px solid #ddd;text-align:right;">${item.quantity}</td>
          <td style="padding:6px;border:1px solid #ddd;text-align:right;">${item.price.toFixed(2)}</td>
          <td style="padding:6px;border:1px solid #ddd;text-align:right;">${lineTotal.toFixed(2)}</td>
        </tr>
      `
    }).join('')

    const popup = window.open('', '_blank', 'width=900,height=700')
    if (!popup) {
      toast.error('Popup blocked. Allow popups to print.')
      return
    }

    popup.document.write(`
      <html>
      <head>
        <title>Instant Bill</title>
        <style>
          @media print {
            body { margin: 0; padding: 8px; font-size: 12px; }
            .receipt { max-width: 80mm; margin: 0 auto; }
            table { font-size: 11px; }
          }
        </style>
      </head>
      <body style="font-family: Arial, sans-serif; padding: 16px;">
        <div class="receipt">
        <h2 style="margin:0 0 6px;">Instant Bill</h2>
        <div style="margin:0 0 12px;font-size:14px;">Date: ${new Date().toLocaleString()}</div>
        <div style="margin:0 0 4px;font-size:14px;">Customer: ${customerName}</div>
        <table style="width:100%;border-collapse:collapse;margin-top:12px;font-size:14px;">
          <thead>
            <tr>
              <th style="padding:6px;border:1px solid #ddd;text-align:left;">Item</th>
              <th style="padding:6px;border:1px solid #ddd;text-align:right;">Qty</th>
              <th style="padding:6px;border:1px solid #ddd;text-align:right;">Price</th>
              <th style="padding:6px;border:1px solid #ddd;text-align:right;">Total</th>
            </tr>
          </thead>
          <tbody>${lines}</tbody>
        </table>
        <div style="margin-top:14px;max-width:320px;margin-left:auto;font-size:14px;">
          <div style="display:flex;justify-content:space-between;"><span>Subtotal</span><span>${subtotal.toFixed(2)}</span></div>
          <div style="display:flex;justify-content:space-between;"><span>GST</span><span>${gstAmount.toFixed(2)}</span></div>
          <div style="display:flex;justify-content:space-between;"><span>Discount</span><span>${discount.toFixed(2)}</span></div>
          <div style="display:flex;justify-content:space-between;font-weight:bold;border-top:1px solid #ddd;padding-top:8px;"><span>Total</span><span>${totalAmount.toFixed(2)}</span></div>
        </div>
        <script>
          window.onload = function() {
            window.print();
          };
        </script>
        </div>
      </body>
      </html>
    `)
    popup.document.close()
  }

  const filteredItems = useMemo(() => {
    const loweredSearch = searchTerm.toLowerCase()
    return availableItems.filter((item) => {
      const matchesSearch =
        item.name.toLowerCase().includes(loweredSearch) ||
        item.barcode?.includes(searchTerm)
      const itemCategoryName = item.category?.name || 'Uncategorized'
      const matchesCategory = !selectedCategory || itemCategoryName === selectedCategory
      return matchesSearch && matchesCategory
    })
  }, [availableItems, searchTerm, selectedCategory])

  const selectedCustomer = customers.find(c => c.id === customerId)

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <h1 className="text-2xl font-bold text-gray-900">Point of Sale</h1>
            <div className="flex items-center space-x-4">
              <span className="text-sm text-gray-600">User: {user?.name}</span>
              <button
                onClick={() => router.push('/dashboard')}
                className="btn btn-secondary btn-sm"
              >
                Dashboard
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="pos-grid max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Items Section */}
        <div className="space-y-4">
          {/* Search and Filter */}
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setScanMode('LIST')}
                  className={`py-2 rounded text-sm font-semibold ${scanMode === 'LIST' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
                >
                  Scan for List
                </button>
                <button
                  type="button"
                  onClick={() => setScanMode('CART')}
                  className={`py-2 rounded text-sm font-semibold ${scanMode === 'CART' ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-700'}`}
                >
                  Scan for Cart
                </button>
              </div>
              <div className="text-xs text-gray-600">
                Active mode: <span className="font-semibold">{scanMode === 'CART' ? 'Cart Billing' : 'Inventory List'}</span>
                {isOffline && <span className="ml-2 text-orange-600 font-medium">(Offline cache mode)</span>}
              </div>
            </div>
            <div className="mt-3 flex flex-col md:flex-row gap-3">
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search items or scan barcode..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="flex-1 input"
              />
              <button
                onClick={() => {
                  unlockAudio()
                  setShowScanner(true)
                  setTimeout(() => {
                    startScanner()
                  }, 0)
                }}
                className="btn btn-secondary whitespace-nowrap text-base px-5 py-3"
              >
                {scanMode === 'CART' ? 'Scan for Cart' : 'Scan for List'}
              </button>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="input"
              >
                <option value="">All Categories</option>
                {Array.from(new Set(availableItems.map(item => item.category?.name || 'Uncategorized'))).map(category => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </div>
          </div>

          {pendingScannedBarcode && (
            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="font-medium mb-3">Add New Product from Scanned Barcode</h3>
              <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
                <input
                  type="text"
                  className="input md:col-span-2"
                  value={pendingScannedBarcode}
                  readOnly
                />
                <input
                  type="text"
                  placeholder="Product name"
                  className="input md:col-span-2"
                  value={newItemFromScan.name}
                  onChange={(e) => setNewItemFromScan((prev) => ({ ...prev, name: e.target.value }))}
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Selling price"
                  className="input"
                  value={newItemFromScan.price}
                  onChange={(e) => setNewItemFromScan((prev) => ({ ...prev, price: e.target.value }))}
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Cost price"
                  className="input"
                  value={newItemFromScan.costPrice}
                  onChange={(e) => setNewItemFromScan((prev) => ({ ...prev, costPrice: e.target.value }))}
                />
                <input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="Qty"
                  className="input"
                  value={newItemFromScan.quantity}
                  onChange={(e) => setNewItemFromScan((prev) => ({ ...prev, quantity: e.target.value }))}
                />
                <select
                  className="input"
                  value={newItemFromScan.categoryId}
                  onChange={(e) => setNewItemFromScan((prev) => ({ ...prev, categoryId: e.target.value }))}
                >
                  <option value="">Select category</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="Unit (pcs, kg)"
                  className="input"
                  value={newItemFromScan.unit}
                  onChange={(e) => setNewItemFromScan((prev) => ({ ...prev, unit: e.target.value }))}
                />
                <button onClick={handleCreateItemFromScan} className="btn btn-primary">
                  {scanMode === 'CART' ? 'Create + Add to Cart' : 'Create + Add to List'}
                </button>
                <button
                  onClick={() => setPendingScannedBarcode('')}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium">Scanned Items List (List Mode)</h3>
              <button
                type="button"
                className="text-sm text-blue-600 hover:text-blue-800"
                onClick={() => setScannedItemsList([])}
                disabled={scannedItemsList.length === 0}
              >
                Clear List
              </button>
            </div>
            <div className="max-h-48 overflow-y-auto space-y-2">
              {scannedItemsList.map((entry) => (
                <div
                  key={`${entry.id}-${entry.scannedAt}`}
                  className={`rounded border p-2 ${lastScannedItemId === entry.id ? 'border-green-500 bg-green-50' : 'border-gray-200'}`}
                >
                  <div className="text-sm font-medium">{entry.name}</div>
                  <div className="text-xs text-gray-600">Barcode: {entry.barcode || '-'}</div>
                  <div className="text-xs text-gray-700">Price: Rs {Number(entry.price || 0).toFixed(2)}</div>
                </div>
              ))}
              {scannedItemsList.length === 0 && (
                <div className="text-sm text-gray-500">No products scanned in list mode yet.</div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="font-medium mb-3">Manual Item (Not in List)</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
              <input
                type="text"
                placeholder="Item name"
                className="input"
                value={manualItem.name}
                onChange={(e) => setManualItem((prev) => ({ ...prev, name: e.target.value }))}
              />
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Price"
                className="input"
                value={manualItem.price}
                onChange={(e) => setManualItem((prev) => ({ ...prev, price: e.target.value }))}
              />
              <input
                type="number"
                min="1"
                step="1"
                placeholder="Qty"
                className="input"
                value={manualItem.quantity}
                onChange={(e) => setManualItem((prev) => ({ ...prev, quantity: e.target.value }))}
              />
              <button onClick={handleAddManualItem} className="btn btn-secondary">
                Add Manual Item
              </button>
            </div>
          </div>

          {/* Items Grid */}
          <div className="bg-white rounded-lg shadow p-4">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-h-96 overflow-y-auto">
              {filteredItems.map(item => (
                <div
                  key={item.id}
                  className="border rounded-lg p-3 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => handleAddToCart(item)}
                >
                  <div className="text-sm font-medium text-gray-900">{item.name}</div>
                  <div className="text-xs text-gray-500">{item.category?.name || 'Uncategorized'}</div>
                  <div className="text-lg font-bold text-green-600">Rs {item.price}</div>
                  <div className="text-xs text-gray-500">Stock: {item.quantity} {item.unit}</div>
                  {item.quantity === 0 && (
                    <div className="text-xs text-red-500 font-medium">Out of Stock</div>
                  )}
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700 hover:bg-blue-200"
                      onClick={(event) => {
                        event.stopPropagation()
                        startEditingItem(item)
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="text-xs px-2 py-1 rounded bg-red-100 text-red-700 hover:bg-red-200"
                      onClick={(event) => {
                        event.stopPropagation()
                        handleDeleteItem(item)
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Cart Section */}
        <div className="space-y-4">
          {/* Customer Selection */}
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-medium">Customer</h3>
              <button
                onClick={() => setShowCustomerModal(true)}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                {selectedCustomer ? 'Change' : 'Add Customer'}
              </button>
            </div>
            {selectedCustomer ? (
              <div className="text-sm">
                <div className="font-medium">{selectedCustomer.name}</div>
                <div className="text-gray-500">{selectedCustomer.phone}</div>
              </div>
            ) : (
              <div className="text-sm text-gray-500">Walk-in Customer</div>
            )}
          </div>

          {/* Cart Items */}
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="font-medium mb-3">Cart Items</h3>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {items.map(item => (
                <div key={item.id} className="flex justify-between items-center py-2 border-b">
                  <div className="flex-1">
                    <div className="text-sm font-medium">{item.name}</div>
                    <div className="text-xs text-gray-500">Rs {item.price} x {item.quantity}</div>
                    {(item as any).isCustom && (
                      <div className="text-xs text-orange-600">Manual Item</div>
                    )}
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => handleQuantityChange(item, item.quantity - 1)}
                      className="w-6 h-6 rounded bg-gray-200 hover:bg-gray-300 text-xs"
                    >
                      -
                    </button>
                    <span className="text-sm w-8 text-center">{item.quantity}</span>
                    <button
                      onClick={() => handleQuantityChange(item, item.quantity + 1)}
                      className="w-6 h-6 rounded bg-gray-200 hover:bg-gray-300 text-xs"
                    >
                      +
                    </button>
                    <button
                      onClick={() => handleRemoveFromCart(item)}
                      className="text-red-500 hover:text-red-700 text-sm"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
              {items.length === 0 && (
                <div className="text-center text-gray-500 py-4">Cart is empty</div>
              )}
            </div>
          </div>

          {/* Payment Method */}
          <div className="bg-white rounded-lg shadow p-4">
            <h3 className="font-medium mb-3">Payment Method</h3>
            <div className="grid grid-cols-2 gap-2">
              {['CASH', 'UPI', 'CARD', 'CREDIT'].map(method => (
                <button
                  key={method}
                  onClick={() => dispatch(setPaymentMethod(method as any))}
                  className={`py-2 px-4 rounded text-sm font-medium ${
                    paymentMethod === method
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  {method}
                </button>
              ))}
            </div>
          </div>

          {/* Order Summary */}
          <div className="bg-white rounded-lg shadow p-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Subtotal:</span>
                <span>Rs {subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>GST:</span>
                <span>Rs {gstAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Discount:</span>
                <span>Rs {discount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold text-lg pt-2 border-t">
                <span>Total:</span>
                <span>Rs {totalAmount.toFixed(2)}</span>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              <button
                onClick={handleClearCart}
                className="w-full btn btn-secondary"
                disabled={items.length === 0}
              >
                Clear Cart
              </button>
              <button
                onClick={handleCheckout}
                className="w-full btn btn-primary"
                disabled={items.length === 0 || isLoading}
              >
                {isLoading ? 'Processing...' : `Complete Order - Rs ${totalAmount.toFixed(2)}`}
              </button>
              <button
                onClick={handleInstantPrint}
                className="w-full btn btn-secondary"
                disabled={items.length === 0}
              >
                Print Instant Bill
              </button>
            </div>
          </div>
        </div>
      </div>

      {showScanner && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Scan Product Barcode ({scanMode === 'CART' ? 'Cart' : 'List'} Mode)</h3>
              <div className="flex items-center gap-2">
                {preferredFacingMode === 'environment' && rearVideoInputs.length > 1 && (
                  <button
                    onClick={() => {
                      const currentIndex = rearVideoInputs.findIndex((d) => d.id === selectedRearDeviceId)
                      const nextIndex =
                        currentIndex >= 0
                          ? (currentIndex + 1) % rearVideoInputs.length
                          : 0
                      const nextId = rearVideoInputs[nextIndex]?.id || ''
                      if (!nextId) return
                      setSelectedRearDeviceId(nextId)
                      stopScanner()
                      setTimeout(() => {
                        startScanner('environment')
                      }, 100)
                    }}
                    className="text-xs px-2 py-1 border rounded text-gray-700 hover:bg-gray-100"
                    type="button"
                  >
                    Rear Lens {Math.max(1, rearVideoInputs.findIndex((d) => d.id === selectedRearDeviceId) + 1)}
                  </button>
                )}
                <button
                  onClick={() => {
                    const nextMode = preferredFacingMode === 'environment' ? 'user' : 'environment'
                    setPreferredFacingMode(nextMode)
                    stopScanner()
                    setTimeout(() => {
                      startScanner(nextMode)
                    }, 100)
                  }}
                  className="text-xs px-2 py-1 border rounded text-gray-700 hover:bg-gray-100"
                  type="button"
                >
                  {preferredFacingMode === 'environment' ? 'Use Front Camera' : 'Use Rear Camera'}
                </button>
                <button
                  onClick={() => {
                    closeScannerModal()
                  }}
                  className="text-gray-500 hover:text-gray-800"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="rounded overflow-hidden bg-black">
              <video ref={videoRef} className="w-full h-72 object-contain" muted playsInline />
              <canvas ref={canvasRef} className="hidden" />
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Point the camera at product barcode (EAN/UPC/Code128).
            </p>
            {preferredFacingMode === 'environment' && (
              <p className="text-xs text-gray-500 mt-1">
                Rear camera tip: keep barcode 10-15 cm away and centered for fastest focus lock.
              </p>
            )}
            {preferredFacingMode === 'environment' && rearVideoInputs.length > 1 && (
              <p className="text-xs text-gray-500 mt-1">
                If blur remains, tap "Rear Lens" to switch to another back camera.
              </p>
            )}
            <p className="text-xs text-gray-500 mt-1">
              External scanner support: scan using hardware scanner and press Enter.
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Beep status: {isSoundReady ? 'ready' : 'tap Test Beep once to enable sound on mobile'}
            </p>
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={manualScanCode}
                onChange={(e) => setManualScanCode(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key !== 'Enter') return
                  e.preventDefault()
                  if (!manualScanCode.trim()) {
                    toast.error('Enter barcode first')
                    return
                  }
                  await processScannedCode(manualScanCode.trim(), 'manual')
                  setManualScanCode('')
                }}
                className="input flex-1"
                placeholder="Enter barcode manually"
              />
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => imageScanInputRef.current?.click()}
              >
                Scan Image
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => {
                  unlockAudio()
                  playScanBeep('success')
                }}
              >
                Test Beep
              </button>
              <button
                className="btn btn-secondary"
                onClick={async () => {
                  if (!manualScanCode.trim()) {
                    toast.error('Enter barcode first')
                    return
                  }
                  await processScannedCode(manualScanCode.trim(), 'manual')
                  setManualScanCode('')
                }}
              >
                Add
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => {
                  scanMissCountRef.current = 0
                  setScanStatus('Retrying scan...')
                }}
              >
                Retry
              </button>
            </div>
            <input
              ref={imageScanInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                if (file) {
                  await decodeBarcodeFromImageFile(file)
                }
              }}
            />
            {isScanStarting && <p className="text-sm text-blue-600 mt-2">Starting camera...</p>}
            {scanStatus && <p className="text-sm text-green-700 mt-2">{scanStatus}</p>}
            {scanError && <p className="text-sm text-red-600 mt-2">{scanError}</p>}
          </div>
        </div>
      )}

      {editingItem && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-xl p-4">
            <h3 className="font-semibold mb-3">Edit Item</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input
                className="input"
                placeholder="Name"
                value={editItemForm.name}
                onChange={(e) => setEditItemForm((prev) => ({ ...prev, name: e.target.value }))}
              />
              <input
                className="input"
                placeholder="Barcode"
                value={editItemForm.barcode}
                onChange={(e) => setEditItemForm((prev) => ({ ...prev, barcode: e.target.value }))}
              />
              <input
                type="number"
                min="0"
                step="0.01"
                className="input"
                placeholder="Selling price"
                value={editItemForm.price}
                onChange={(e) => setEditItemForm((prev) => ({ ...prev, price: e.target.value }))}
              />
              <input
                type="number"
                min="0"
                step="0.01"
                className="input"
                placeholder="Cost price"
                value={editItemForm.costPrice}
                onChange={(e) => setEditItemForm((prev) => ({ ...prev, costPrice: e.target.value }))}
              />
              <input
                type="number"
                min="0"
                step="1"
                className="input"
                placeholder="Quantity"
                value={editItemForm.quantity}
                onChange={(e) => setEditItemForm((prev) => ({ ...prev, quantity: e.target.value }))}
              />
              <input
                className="input"
                placeholder="Unit"
                value={editItemForm.unit}
                onChange={(e) => setEditItemForm((prev) => ({ ...prev, unit: e.target.value }))}
              />
              <select
                className="input md:col-span-2"
                value={editItemForm.categoryId}
                onChange={(e) => setEditItemForm((prev) => ({ ...prev, categoryId: e.target.value }))}
              >
                <option value="">Select category</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button className="btn btn-secondary" onClick={() => setEditingItem(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleSaveItemEdit}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
