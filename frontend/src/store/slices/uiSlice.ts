import { createSlice, PayloadAction } from '@reduxjs/toolkit'

interface UIState {
  sidebarOpen: boolean
  theme: 'light' | 'dark'
  loading: boolean
  currentPage: string
  breadcrumbs: Array<{ label: string; href?: string }>
  notifications: Array<{
    id: string
    type: 'success' | 'error' | 'warning' | 'info'
    message: string
    timestamp: number
  }>
}

const initialState: UIState = {
  sidebarOpen: true,
  theme: 'light',
  loading: false,
  currentPage: '',
  breadcrumbs: [],
  notifications: [],
}

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    toggleSidebar: (state) => {
      state.sidebarOpen = !state.sidebarOpen
    },

    setSidebarOpen: (state, action: PayloadAction<boolean>) => {
      state.sidebarOpen = action.payload
    },

    setTheme: (state, action: PayloadAction<'light' | 'dark'>) => {
      state.theme = action.payload
      localStorage.setItem('theme', action.payload)
    },

    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload
    },

    setCurrentPage: (state, action: PayloadAction<string>) => {
      state.currentPage = action.payload
    },

    setBreadcrumbs: (state, action: PayloadAction<Array<{ label: string; href?: string }>>) => {
      state.breadcrumbs = action.payload
    },

    addNotification: (state, action: PayloadAction<{
      type: 'success' | 'error' | 'warning' | 'info'
      message: string
    }>) => {
      const notification = {
        id: Date.now().toString(),
        ...action.payload,
        timestamp: Date.now(),
      }
      state.notifications.push(notification)
    },

    removeNotification: (state, action: PayloadAction<string>) => {
      state.notifications = state.notifications.filter(
        notification => notification.id !== action.payload
      )
    },

    clearNotifications: (state) => {
      state.notifications = []
    },
  },
})

export const {
  toggleSidebar,
  setSidebarOpen,
  setTheme,
  setLoading,
  setCurrentPage,
  setBreadcrumbs,
  addNotification,
  removeNotification,
  clearNotifications,
} = uiSlice.actions

export default uiSlice.reducer
