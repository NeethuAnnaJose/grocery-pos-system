import { createSlice, PayloadAction } from '@reduxjs/toolkit'

interface CartItem {
  id: string
  name: string
  price: number
  quantity: number
  isCustom?: boolean
  barcode?: string
  unit?: string
  gstRate?: number
  discount?: number
}

interface CartState {
  items: CartItem[]
  subtotal: number
  discount: number
  gstAmount: number
  totalAmount: number
  customerId: string | null
  customerName: string | null
  paymentMethod: 'CASH' | 'UPI' | 'CARD' | 'CREDIT' | 'BANK_TRANSFER'
  notes: string
}

const initialState: CartState = {
  items: [],
  subtotal: 0,
  discount: 0,
  gstAmount: 0,
  totalAmount: 0,
  customerId: null,
  customerName: null,
  paymentMethod: 'CASH',
  notes: '',
}

const calculateTotals = (items: CartItem[], discount: number) => {
  const subtotal = items.reduce((sum, item) => {
    const itemTotal = item.price * item.quantity
    const itemDiscount = (item.discount || 0) * item.quantity
    return sum + (itemTotal - itemDiscount)
  }, 0)

  const gstAmount = items.reduce((sum, item) => {
    const itemTotal = item.price * item.quantity
    const itemDiscount = (item.discount || 0) * item.quantity
    const taxableAmount = itemTotal - itemDiscount
    return sum + (taxableAmount * ((item.gstRate || 0) / 100))
  }, 0)

  const totalAmount = subtotal + gstAmount - discount

  return {
    subtotal: parseFloat(subtotal.toFixed(2)),
    gstAmount: parseFloat(gstAmount.toFixed(2)),
    totalAmount: parseFloat(totalAmount.toFixed(2)),
  }
}

const cartSlice = createSlice({
  name: 'cart',
  initialState,
  reducers: {
    addToCart: (state, action: PayloadAction<Omit<CartItem, 'quantity'>>) => {
      const existingItem = state.items.find(item => item.id === action.payload.id)
      
      if (existingItem) {
        existingItem.quantity += 1
      } else {
        state.items.push({ ...action.payload, quantity: 1 })
      }

      const totals = calculateTotals(state.items, state.discount)
      state.subtotal = totals.subtotal
      state.gstAmount = totals.gstAmount
      state.totalAmount = totals.totalAmount
    },

    removeFromCart: (state, action: PayloadAction<string>) => {
      state.items = state.items.filter(item => item.id !== action.payload)
      
      const totals = calculateTotals(state.items, state.discount)
      state.subtotal = totals.subtotal
      state.gstAmount = totals.gstAmount
      state.totalAmount = totals.totalAmount
    },

    updateQuantity: (state, action: PayloadAction<{ id: string; quantity: number }>) => {
      const item = state.items.find(item => item.id === action.payload.id)
      if (item) {
        item.quantity = Math.max(1, action.payload.quantity)
        
        const totals = calculateTotals(state.items, state.discount)
        state.subtotal = totals.subtotal
        state.gstAmount = totals.gstAmount
        state.totalAmount = totals.totalAmount
      }
    },

    updateItemDiscount: (state, action: PayloadAction<{ id: string; discount: number }>) => {
      const item = state.items.find(item => item.id === action.payload.id)
      if (item) {
        item.discount = action.payload.discount
        
        const totals = calculateTotals(state.items, state.discount)
        state.subtotal = totals.subtotal
        state.gstAmount = totals.gstAmount
        state.totalAmount = totals.totalAmount
      }
    },

    setDiscount: (state, action: PayloadAction<number>) => {
      state.discount = Math.max(0, action.payload)
      
      const totals = calculateTotals(state.items, state.discount)
      state.subtotal = totals.subtotal
      state.gstAmount = totals.gstAmount
      state.totalAmount = totals.totalAmount
    },

    clearCart: (state) => {
      state.items = []
      state.subtotal = 0
      state.discount = 0
      state.gstAmount = 0
      state.totalAmount = 0
      state.customerId = null
      state.customerName = null
      state.paymentMethod = 'CASH'
      state.notes = ''
    },

    setCustomer: (state, action: PayloadAction<{ id: string; name: string } | null>) => {
      if (action.payload) {
        state.customerId = action.payload.id
        state.customerName = action.payload.name
      } else {
        state.customerId = null
        state.customerName = null
      }
    },

    setPaymentMethod: (state, action: PayloadAction<CartState['paymentMethod']>) => {
      state.paymentMethod = action.payload
    },

    setNotes: (state, action: PayloadAction<string>) => {
      state.notes = action.payload
    },

    applyBulkDiscount: (state, action: PayloadAction<number>) => {
      const discountPercentage = action.payload
      state.items.forEach(item => {
        item.discount = (item.price * discountPercentage) / 100
      })
      
      const totals = calculateTotals(state.items, state.discount)
      state.subtotal = totals.subtotal
      state.gstAmount = totals.gstAmount
      state.totalAmount = totals.totalAmount
    },
  },
})

export const {
  addToCart,
  removeFromCart,
  updateQuantity,
  updateItemDiscount,
  setDiscount,
  clearCart,
  setCustomer,
  setPaymentMethod,
  setNotes,
  applyBulkDiscount,
} = cartSlice.actions

export default cartSlice.reducer
