import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import toast from 'react-hot-toast'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  updateProfile,
} from 'firebase/auth'
import { getFirebaseAuth } from '@/lib/firebase'

type AuthView = 'SIGN_IN' | 'REGISTER' | 'FORGOT'

export default function Login() {
  const router = useRouter()
  const [view, setView] = useState<AuthView>('SIGN_IN')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [signInForm, setSignInForm] = useState({ email: '', password: '' })
  const [registerForm, setRegisterForm] = useState({ name: '', email: '', password: '' })
  const [forgotEmail, setForgotEmail] = useState('')

  useEffect(() => {
    try {
      const auth = getFirebaseAuth()
      return onAuthStateChanged(auth, (user) => {
        if (user) {
          router.replace('/billing').catch(() => {})
        }
      })
    } catch {
      // Firebase env missing; login screen will still show and user sees clear errors on submit.
    }
  }, [router])

  const handleSignIn = async (event: FormEvent) => {
    event.preventDefault()
    if (!signInForm.email.trim() || !signInForm.password) {
      toast.error('Email and password are required')
      return
    }
    setIsSubmitting(true)
    try {
      const auth = getFirebaseAuth()
      await signInWithEmailAndPassword(auth, signInForm.email.trim(), signInForm.password)
      toast.success('Signed in')
      router.push('/billing').catch(() => {})
    } catch (error: any) {
      toast.error(error?.message || 'Sign in failed')
    } finally {
      setIsSubmitting(false)
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

    setIsSubmitting(true)
    try {
      const auth = getFirebaseAuth()
      const credentials = await createUserWithEmailAndPassword(
        auth,
        registerForm.email.trim(),
        registerForm.password
      )
      await updateProfile(credentials.user, { displayName: registerForm.name.trim() })
      toast.success('Account created')
      router.push('/billing').catch(() => {})
    } catch (error: any) {
      toast.error(error?.message || 'Registration failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleForgot = async (event: FormEvent) => {
    event.preventDefault()
    if (!forgotEmail.trim()) {
      toast.error('Email is required')
      return
    }
    setIsSubmitting(true)
    try {
      const auth = getFirebaseAuth()
      await sendPasswordResetEmail(auth, forgotEmail.trim())
      toast.success('Password reset email sent')
      setView('SIGN_IN')
    } catch (error: any) {
      toast.error(error?.message || 'Failed to send reset email')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="bg-white rounded-lg shadow p-6 w-full max-w-md">
        <h1 className="text-xl font-semibold mb-1 text-center">Shop Counter Login</h1>
        <p className="text-sm text-gray-600 mb-4 text-center">Sign in to manage inventory and billing</p>

        <div className="grid grid-cols-3 gap-2 mb-4">
          <button
            type="button"
            className={`py-2 rounded text-sm font-semibold ${view === 'SIGN_IN' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}
            onClick={() => setView('SIGN_IN')}
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

        {view === 'SIGN_IN' && (
          <form onSubmit={handleSignIn} className="space-y-3">
            <input
              className="input"
              type="email"
              placeholder="Email"
              value={signInForm.email}
              onChange={(e) => setSignInForm((prev) => ({ ...prev, email: e.target.value }))}
            />
            <input
              className="input"
              type="password"
              placeholder="Password"
              value={signInForm.password}
              onChange={(e) => setSignInForm((prev) => ({ ...prev, password: e.target.value }))}
            />
            <button className="btn btn-primary w-full" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        )}

        {view === 'REGISTER' && (
          <form onSubmit={handleRegister} className="space-y-3">
            <input
              className="input"
              type="text"
              placeholder="Full name"
              value={registerForm.name}
              onChange={(e) => setRegisterForm((prev) => ({ ...prev, name: e.target.value }))}
            />
            <input
              className="input"
              type="email"
              placeholder="Email"
              value={registerForm.email}
              onChange={(e) => setRegisterForm((prev) => ({ ...prev, email: e.target.value }))}
            />
            <input
              className="input"
              type="password"
              placeholder="Password (min 6)"
              value={registerForm.password}
              onChange={(e) => setRegisterForm((prev) => ({ ...prev, password: e.target.value }))}
            />
            <button className="btn btn-primary w-full" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating account...' : 'Register'}
            </button>
          </form>
        )}

        {view === 'FORGOT' && (
          <form onSubmit={handleForgot} className="space-y-3">
            <input
              className="input"
              type="email"
              placeholder="Registered email"
              value={forgotEmail}
              onChange={(e) => setForgotEmail(e.target.value)}
            />
            <button className="btn btn-primary w-full" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Sending...' : 'Send Reset Email'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
