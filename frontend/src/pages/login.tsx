import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { useDispatch, useSelector } from 'react-redux'
import toast from 'react-hot-toast'
import { AppDispatch, RootState } from '@/store'
import { login, register } from '@/store/slices/authSlice'
import { authAPI } from '@/services/api'

type AuthView = 'LOGIN' | 'REGISTER' | 'FORGOT'

export default function Login() {
  const router = useRouter()
  const dispatch = useDispatch<AppDispatch>()
  const { isLoading, isAuthenticated } = useSelector((state: RootState) => state.auth)
  const [view, setView] = useState<AuthView>('LOGIN')

  const [loginForm, setLoginForm] = useState({ email: '', password: '' })
  const [registerForm, setRegisterForm] = useState({
    name: '',
    email: '',
    password: '',
    phone: '',
    role: 'STAFF' as 'ADMIN' | 'STAFF',
  })
  const [forgotForm, setForgotForm] = useState({
    email: '',
  })

  useEffect(() => {
    if (isAuthenticated) {
      router.replace('/dashboard').catch(() => {})
    }
  }, [isAuthenticated, router])

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault()
    if (!loginForm.email.trim() || !loginForm.password) {
      toast.error('Email and password are required')
      return
    }
    const resultAction = await dispatch(login({
      email: loginForm.email.trim(),
      password: loginForm.password,
    }))
    if (login.fulfilled.match(resultAction)) {
      router.push('/dashboard').catch(() => {})
    }
  }

  const handleRegister = async (event: FormEvent) => {
    event.preventDefault()
    if (!registerForm.name.trim() || !registerForm.email.trim() || !registerForm.password) {
      toast.error('Name, email and password are required')
      return
    }
    if (registerForm.password.length < 6) {
      toast.error('Password must be at least 6 characters')
      return
    }

    const resultAction = await dispatch(register({
      name: registerForm.name.trim(),
      email: registerForm.email.trim(),
      password: registerForm.password,
      role: registerForm.role,
      ...(registerForm.phone.trim() ? { phone: registerForm.phone.trim() } : {}),
    }))
    if (register.fulfilled.match(resultAction)) {
      router.push('/dashboard').catch(() => {})
    }
  }

  const handleForgotPassword = async (event: FormEvent) => {
    event.preventDefault()
    if (!forgotForm.email.trim()) {
      toast.error('Email is required')
      return
    }

    try {
      const response = await authAPI.forgotPassword({
        email: forgotForm.email.trim(),
      })
      const resetLink = response?.data?.data?.resetLink
      if (resetLink) {
        await navigator.clipboard?.writeText?.(resetLink).catch(() => {})
        toast.success('Reset link generated. Copied to clipboard (dev mode).')
      } else {
        toast.success(response.data?.message || 'Password reset link sent')
      }
      setForgotForm({ email: '' })
      setView('LOGIN')
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to request reset link')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="bg-white rounded-lg shadow p-6 w-full max-w-md">
        <h1 className="text-xl font-semibold mb-1 text-center">Welcome</h1>
        <p className="text-sm text-gray-600 mb-4 text-center">Sign in, register, or reset password</p>

        <div className="grid grid-cols-3 gap-2 mb-4">
          <button
            type="button"
            className={`py-2 rounded text-sm font-semibold ${view === 'LOGIN' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
            onClick={() => setView('LOGIN')}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`py-2 rounded text-sm font-semibold ${view === 'REGISTER' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
            onClick={() => setView('REGISTER')}
          >
            Register
          </button>
          <button
            type="button"
            className={`py-2 rounded text-sm font-semibold ${view === 'FORGOT' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
            onClick={() => setView('FORGOT')}
          >
            Forgot
          </button>
        </div>

        {view === 'LOGIN' && (
          <form className="space-y-3" onSubmit={handleLogin}>
            <input
              type="email"
              placeholder="Email"
              className="input w-full"
              value={loginForm.email}
              onChange={(e) => setLoginForm((prev) => ({ ...prev, email: e.target.value }))}
            />
            <input
              type="password"
              placeholder="Password"
              className="input w-full"
              value={loginForm.password}
              onChange={(e) => setLoginForm((prev) => ({ ...prev, password: e.target.value }))}
            />
            <button className="btn btn-primary w-full" type="submit" disabled={isLoading}>
              {isLoading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        )}

        {view === 'REGISTER' && (
          <form className="space-y-3" onSubmit={handleRegister}>
            <input
              type="text"
              placeholder="Full name"
              className="input w-full"
              value={registerForm.name}
              onChange={(e) => setRegisterForm((prev) => ({ ...prev, name: e.target.value }))}
            />
            <input
              type="email"
              placeholder="Email"
              className="input w-full"
              value={registerForm.email}
              onChange={(e) => setRegisterForm((prev) => ({ ...prev, email: e.target.value }))}
            />
            <input
              type="password"
              placeholder="Password (min 6)"
              className="input w-full"
              value={registerForm.password}
              onChange={(e) => setRegisterForm((prev) => ({ ...prev, password: e.target.value }))}
            />
            <input
              type="text"
              placeholder="Phone (optional)"
              className="input w-full"
              value={registerForm.phone}
              onChange={(e) => setRegisterForm((prev) => ({ ...prev, phone: e.target.value }))}
            />
            <select
              className="input w-full"
              value={registerForm.role}
              onChange={(e) => setRegisterForm((prev) => ({ ...prev, role: e.target.value as 'ADMIN' | 'STAFF' }))}
            >
              <option value="STAFF">Staff</option>
              <option value="ADMIN">Admin</option>
            </select>
            <button className="btn btn-primary w-full" type="submit" disabled={isLoading}>
              {isLoading ? 'Creating account...' : 'Register'}
            </button>
          </form>
        )}

        {view === 'FORGOT' && (
          <form className="space-y-3" onSubmit={handleForgotPassword}>
            <input
              type="email"
              placeholder="Registered email"
              className="input w-full"
              value={forgotForm.email}
              onChange={(e) => setForgotForm((prev) => ({ ...prev, email: e.target.value }))}
            />
            <p className="text-xs text-gray-600">
              We will send a reset link to your email. In local development, the link is returned in API response.
            </p>
            <button className="btn btn-primary w-full" type="submit">
              Send Reset Link
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
