import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { getDb } from '@/lib/firebase'

export interface InventoryItem {
  id: string
  name: string
  barcode: string
  price: number
  quantity: number
  unit: string
  createdAt?: Timestamp | null
  updatedAt?: Timestamp | null
}

const COLLECTION_NAME = 'inventory_items'

const collectionRef = () => collection(getDb(), COLLECTION_NAME)

export const listInventoryItems = async (): Promise<InventoryItem[]> => {
  const snapshot = await getDocs(query(collectionRef(), orderBy('updatedAt', 'desc')))
  return snapshot.docs.map((entry) => {
    const data = entry.data() as Omit<InventoryItem, 'id'>
    return {
      id: entry.id,
      name: data.name || '',
      barcode: data.barcode || '',
      price: Number(data.price || 0),
      quantity: Number(data.quantity || 0),
      unit: data.unit || 'pcs',
      createdAt: data.createdAt || null,
      updatedAt: data.updatedAt || null,
    }
  })
}

export const createInventoryItem = async (payload: {
  name: string
  barcode: string
  price: number
  quantity: number
  unit: string
}) => {
  await addDoc(collectionRef(), {
    ...payload,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export const updateInventoryItem = async (
  id: string,
  payload: {
    name: string
    barcode: string
    price: number
    quantity: number
    unit: string
  }
) => {
  await updateDoc(doc(getDb(), COLLECTION_NAME, id), {
    ...payload,
    updatedAt: serverTimestamp(),
  })
}

export const deleteInventoryItem = async (id: string) => {
  await deleteDoc(doc(getDb(), COLLECTION_NAME, id))
}
