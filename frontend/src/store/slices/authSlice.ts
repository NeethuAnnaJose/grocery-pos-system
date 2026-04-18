import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit'
import { authAPI } from '@/services/api'
import toast from 'react-hot-toast'

interface User {
  id: string
  email: string
  name: string
  role: 'ADMIN' | 'STAFF'
  phone?: string
  isActive: boolean
}

interface AuthState {
  user: User | null
  token: string | null
  isLoading: boolean
  isAuthenticated: boolean
}

const initialState: AuthState = {
  user: null,
  token: null,
  isLoading: false,
  isAuthenticated: false,
}

const readApiFailureMessage = (error: any, fallback: string) => {
  if (!error?.response) {
    if (error?.code === 'ECONNABORTED') return 'Request timed out. Check that the backend is running and reachable.'
    return 'Cannot reach the API. Set Backend API URL on the Billing page (store login), or set NEXT_PUBLIC_API_URL when building, then reload.'
  }
  const d = error.response.data
  if (typeof d?.message === 'string' && d.message.trim()) return d.message.trim()
  if (Array.isArray(d?.errors) && d.errors.length && typeof d.errors[0]?.msg === 'string') return d.errors[0].msg
  return fallback
}

// Async thunks
export const login = createAsyncThunk(
  'auth/login',
  async (credentials: { email: string; password: string }, { rejectWithValue }) => {
    try {
      const response = await authAPI.login(credentials)
      // Backend shape: { success, message, data: { user, token } }
      const body = response.data
      if (!body?.data?.user || !body?.data?.token) {
        return rejectWithValue(body?.message || 'Invalid login response from server')
      }
      return { user: body.data.user, token: body.data.token }
    } catch (error: any) {
      return rejectWithValue(readApiFailureMessage(error, 'Login failed'))
    }
  }
)

export const register = createAsyncThunk(
  'auth/register',
  async (userData: {
    email: string
    password: string
    name: string
    role?: 'ADMIN' | 'STAFF'
    phone?: string
  }, { rejectWithValue }) => {
    try {
      const response = await authAPI.register(userData)
      const body = response.data
      if (!body?.data?.user || !body?.data?.token) {
        return rejectWithValue(body?.message || 'Invalid registration response from server')
      }
      return { user: body.data.user, token: body.data.token }
    } catch (error: any) {
      return rejectWithValue(readApiFailureMessage(error, 'Registration failed'))
    }
  }
)

export const getCurrentUser = createAsyncThunk(
  'auth/getCurrentUser',
  async (_, { rejectWithValue }) => {
    try {
      const response = await authAPI.getCurrentUser()
      const body = response.data
      if (!body?.data?.user) {
        return rejectWithValue(body?.message || 'Invalid user response from server')
      }
      return { user: body.data.user }
    } catch (error: any) {
      return rejectWithValue(error.response?.data?.message || 'Failed to get user')
    }
  }
)

export const changePassword = createAsyncThunk(
  'auth/changePassword',
  async (passwordData: {
    currentPassword: string
    newPassword: string
  }, { rejectWithValue }) => {
    try {
      const response = await authAPI.changePassword(passwordData)
      return response.data
    } catch (error: any) {
      return rejectWithValue(error.response?.data?.message || 'Password change failed')
    }
  }
)

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    logout: (state) => {
      state.user = null
      state.token = null
      state.isAuthenticated = false
      localStorage.removeItem('token')
    },
    setToken: (state, action: PayloadAction<string>) => {
      state.token = action.payload
      state.isAuthenticated = true
      localStorage.setItem('token', action.payload)
    },
    clearError: (state) => {
      // This would be used to clear any error state
    },
  },
  extraReducers: (builder) => {
    builder
      // Login
      .addCase(login.pending, (state) => {
        state.isLoading = true
      })
      .addCase(login.fulfilled, (state, action) => {
        state.isLoading = false
        state.user = action.payload.user
        state.token = action.payload.token
        state.isAuthenticated = true
        localStorage.setItem('token', action.payload.token)
        toast.success('Login successful')
      })
      .addCase(login.rejected, (state, action) => {
        state.isLoading = false
        toast.error(action.payload as string)
      })
      // Register
      .addCase(register.pending, (state) => {
        state.isLoading = true
      })
      .addCase(register.fulfilled, (state, action) => {
        state.isLoading = false
        state.user = action.payload.user
        state.token = action.payload.token
        state.isAuthenticated = true
        localStorage.setItem('token', action.payload.token)
        toast.success('Registration successful')
      })
      .addCase(register.rejected, (state, action) => {
        state.isLoading = false
        toast.error(action.payload as string)
      })
      // Get current user
      .addCase(getCurrentUser.pending, (state) => {
        state.isLoading = true
      })
      .addCase(getCurrentUser.fulfilled, (state, action) => {
        state.isLoading = false
        state.user = action.payload.user
        state.isAuthenticated = true
      })
      .addCase(getCurrentUser.rejected, (state, action) => {
        state.isLoading = false
        // Don't clear auth state on getCurrentUser failure
        // This might be a temporary network issue
      })
      // Change password
      .addCase(changePassword.pending, (state) => {
        state.isLoading = true
      })
      .addCase(changePassword.fulfilled, (state) => {
        state.isLoading = false
        toast.success('Password changed successfully')
      })
      .addCase(changePassword.rejected, (state, action) => {
        state.isLoading = false
        toast.error(action.payload as string)
      })
  },
})

export const { logout, setToken, clearError } = authSlice.actions
export default authSlice.reducer
