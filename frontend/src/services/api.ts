import axios from 'axios'
import Router from 'next/router'
import { getBrowserApiBaseURL, normalizeApiOrigin } from '@/lib/apiOrigin'

/** Public API origin only (no path), or empty to use same-origin /api (dev + Next rewrite). */
const API_BASE_URL = normalizeApiOrigin(process.env.NEXT_PUBLIC_API_URL)

const serverSideBaseURL = API_BASE_URL ? `${API_BASE_URL}/api` : '/api'

// Create axios instance
const api = axios.create({
  // Client requests: baseURL updated per request (localStorage override). SSR: build-time env only.
  baseURL: typeof window !== 'undefined' ? getBrowserApiBaseURL(API_BASE_URL) : serverSideBaseURL,
  timeout: 20000,
  headers: {
    'Content-Type': 'application/json',
  },
})

const shouldRetryRequest = (error: any) => {
  const method = String(error?.config?.method || '').toLowerCase()
  const isSafeMethod = method === 'get' || method === 'head'
  if (!isSafeMethod) return false

  const status = Number(error?.response?.status || 0)
  const isRetriableStatus = status >= 500 || status === 429 || status === 408
  const isNetworkFailure = !error?.response || error?.code === 'ECONNABORTED'
  const alreadyRetried = !!error?.config?._retry

  return !alreadyRetried && (isRetriableStatus || isNetworkFailure)
}

// Request interceptor: API base (supports SHOPPOS_API_ORIGIN in browser) + auth token
api.interceptors.request.use(
  (config) => {
    if (typeof window !== 'undefined') {
      config.baseURL = getBrowserApiBaseURL(API_BASE_URL)
    }
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : ''
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// Response interceptor to handle errors
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (shouldRetryRequest(error)) {
      error.config._retry = true
      return api.request(error.config)
    }

    if (error.response?.status === 401) {
      const url = String(error.config?.url || '')
      // Do not redirect on failed login/register (same page, wrong password)
      if (
        !url.includes('/auth/login') &&
        !url.includes('/auth/register') &&
        !url.includes('/auth/forgot-password') &&
        !url.includes('/auth/reset-password')
      ) {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('token')
          localStorage.removeItem('local_auth_session_v1')
          Router.replace('/login').catch(() => {})
        }
      }
    }
    return Promise.reject(error)
  }
)

// Auth API
export const authAPI = {
  login: (credentials: { email: string; password: string }) =>
    api.post('/auth/login', credentials),
  
  register: (userData: {
    email: string
    password: string
    name: string
    role?: 'ADMIN' | 'STAFF'
    phone?: string
  }) => api.post('/auth/register', userData),
  
  getCurrentUser: () => api.get('/auth/me'),
  
  changePassword: (passwordData: {
    currentPassword: string
    newPassword: string
  }) => api.put('/auth/change-password', passwordData),
  forgotPassword: (payload: { email: string }) =>
    api.post('/auth/forgot-password', payload),
  resetPassword: (payload: { token: string; newPassword: string }) =>
    api.post('/auth/reset-password', payload),
}

// Items API
export const itemsAPI = {
  getItems: (params?: {
    page?: number
    limit?: number
    search?: string
    category?: string
    lowStock?: boolean
    expiring?: boolean
    sortBy?: string
    sortOrder?: string
  }) => api.get('/items', { params }),
  
  getItem: (id: string) => api.get(`/items/${id}`),
  
  createItem: (itemData: any) => api.post('/items', itemData),
  
  updateItem: (id: string, itemData: any) => api.put(`/items/${id}`, itemData),
  
  deleteItem: (id: string) => api.delete(`/items/${id}`),
  
  updateStock: (id: string, stockData: {
    quantity: number
    type: 'STOCK_IN' | 'STOCK_OUT'
    reason?: string
  }) => api.post(`/items/${id}/stock`, stockData),
}

// Product API (barcode-centric scan endpoints)
export const productAPI = {
  getByBarcode: (barcode: string) => api.get(`/product/${encodeURIComponent(barcode)}`),
  createProduct: (productData: {
    name: string
    barcode: string
    price: number
    quantity?: number
    expiryDate?: string
    categoryId?: string
    costPrice?: number
    unit?: string
  }) => api.post('/product', productData),
  updateProduct: (id: string, productData: any) => api.put(`/product/${id}`, productData),
}

// Categories API
export const categoriesAPI = {
  getCategories: () => api.get('/categories'),
  
  getCategory: (id: string) => api.get(`/categories/${id}`),
  
  createCategory: (categoryData: {
    name: string
    description?: string
  }) => api.post('/categories', categoryData),
  
  updateCategory: (id: string, categoryData: any) => api.put(`/categories/${id}`, categoryData),
  
  deleteCategory: (id: string) => api.delete(`/categories/${id}`),
}

// Customers API
export const customersAPI = {
  getCustomers: (params?: {
    page?: number
    limit?: number
    search?: string
    sortBy?: string
    sortOrder?: string
  }) => api.get('/customers', { params }),
  
  getCustomer: (id: string) => api.get(`/customers/${id}`),
  
  createCustomer: (customerData: {
    name: string
    phone: string
    email?: string
    address?: string
    creditLimit?: number
  }) => api.post('/customers', customerData),
  
  updateCustomer: (id: string, customerData: any) => api.put(`/customers/${id}`, customerData),
  
  deleteCustomer: (id: string) => api.delete(`/customers/${id}`),
  
  getCustomerBalance: (id: string) => api.get(`/customers/${id}/balance`),
}

// Orders API
export const ordersAPI = {
  getOrders: (params?: {
    page?: number
    limit?: number
    search?: string
    status?: string
    paymentStatus?: string
    startDate?: string
    endDate?: string
    sortBy?: string
    sortOrder?: string
  }) => api.get('/orders', { params }),
  
  getOrder: (id: string) => api.get(`/orders/${id}`),
  
  createOrder: (orderData: {
    orderItems: Array<{
      itemId: string
      quantity: number
      discount?: number
    }>
    customerId?: string
    paymentMethod: 'CASH' | 'UPI' | 'CARD' | 'CREDIT' | 'BANK_TRANSFER'
    discount?: number
    notes?: string
  }) => api.post('/orders', orderData),
  
  updateOrder: (id: string, orderData: any) => api.put(`/orders/${id}`, orderData),
  
  addPayment: (id: string, paymentData: {
    amount: number
    paymentMethod: 'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER'
    notes?: string
  }) => api.post(`/orders/${id}/payment`, paymentData),
  
  processReturn: (id: string, returnData: {
    orderItems: Array<{
      orderItemId: string
      quantity: number
    }>
    reason?: string
  }) => api.post(`/orders/${id}/return`, returnData),
}

// Dashboard API
export const dashboardAPI = {
  getStats: () => api.get('/dashboard/stats'),
  
  getRecentSales: (params?: { limit?: number }) => api.get('/dashboard/recent-sales', { params }),
  
  getTopItems: (params?: { limit?: number; period?: string }) => api.get('/dashboard/top-items', { params }),
  
  getSalesChart: (params?: { period?: string }) => api.get('/dashboard/sales-chart', { params }),
  
  getLowStock: () => api.get('/dashboard/low-stock'),
  
  getExpiring: () => api.get('/dashboard/expiring'),
}

// Alerts API
export const alertsAPI = {
  getAlerts: (params?: {
    page?: number
    limit?: number
    unreadOnly?: boolean
  }) => api.get('/alerts', { params }),
  
  markAsRead: (id: string) => api.put(`/alerts/${id}/read`),
  
  markAllAsRead: () => api.put('/alerts/read-all'),
}

// Settings API
export const settingsAPI = {
  getSettings: () => api.get('/settings'),
  
  updateSettings: (settings: Array<{ key: string; value: string }>) => api.put('/settings', { settings }),
}

// Users API
export const usersAPI = {
  getUsers: (params?: {
    page?: number
    limit?: number
    search?: string
    role?: string
    sortBy?: string
    sortOrder?: string
  }) => api.get('/users', { params }),
  
  updateUser: (id: string, userData: any) => api.put(`/users/${id}`, userData),
}

// Reports API
export const reportsAPI = {
  getSales: (params?: { period?: 'daily' | 'weekly' | 'monthly' }) => api.get('/reports/sales', { params }),
  getProfitLoss: (params?: { period?: 'daily' | 'weekly' | 'monthly' }) => api.get('/reports/profit-loss', { params }),
  getDeadStock: () => api.get('/reports/dead-stock'),
  getHighDemand: () => api.get('/reports/high-demand'),
}

export default api
