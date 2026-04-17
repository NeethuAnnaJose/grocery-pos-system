import type { InventoryItem } from '@/services/inventoryFirebase'

/** Same key on every origin so tunnel vs localhost still share data in one browser. */
const INVENTORY_LOCAL_KEY = 'shopprinter_inventory_items_v2'
const LEGACY_KEYS = ['inventory_items_cache_v1']

const safeParse = (raw: string | null): InventoryItem[] => {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as InventoryItem[]) : []
  } catch {
    return []
  }
}

const migrateLegacyIfNeeded = (): InventoryItem[] => {
  if (typeof window === 'undefined') return []
  const existing = safeParse(localStorage.getItem(INVENTORY_LOCAL_KEY))
  if (existing.length) return existing
  for (const key of LEGACY_KEYS) {
    const legacy = safeParse(localStorage.getItem(key))
    if (legacy.length) {
      localStorage.setItem(INVENTORY_LOCAL_KEY, JSON.stringify(legacy))
      return legacy
    }
  }
  return []
}

export const loadInventoryFromLocal = (): InventoryItem[] => migrateLegacyIfNeeded()

export const saveInventoryToLocal = (items: InventoryItem[]) => {
  if (typeof window === 'undefined') return
  localStorage.setItem(INVENTORY_LOCAL_KEY, JSON.stringify(items))
  LEGACY_KEYS.forEach((key) => localStorage.removeItem(key))
}

const tsMillis = (item: InventoryItem) =>
  item.updatedAt?.toMillis?.() || item.createdAt?.toMillis?.() || 0

/** Prefer newer record per id; for same barcode keep both if ids differ (rare). */
export const mergeInventoryLists = (primary: InventoryItem[], secondary: InventoryItem[]): InventoryItem[] => {
  const map = new Map<string, InventoryItem>()
  const add = (item: InventoryItem) => {
    const existing = map.get(item.id)
    if (!existing) {
      map.set(item.id, item)
      return
    }
    map.set(item.id, tsMillis(item) >= tsMillis(existing) ? item : existing)
  }
  secondary.forEach(add)
  primary.forEach(add)
  return Array.from(map.values()).sort((a, b) => tsMillis(b) - tsMillis(a))
}
