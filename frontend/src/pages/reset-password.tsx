import { FormEvent, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import toast from 'react-hot-toast'
import { authAPI } from '@/services/api'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const token = useMemo(() => {
    const raw = router.query.token
    return typeof raw === 'string' ? raw : ''
  }, [router.query.token])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (!token) {
      toast.error('Missing or invalid reset token')
      return
    }
    if (newPassword.length < 6) {
      toast.error('New password must be at least 6 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }

    setIsSubmitting(true)
    try {
      const response = await authAPI.resetPassword({ token, newPassword })
      toast.success(response.data?.message || 'Password reset successful')
      router.replace('/login').catch(() => {})
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to reset password')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="bg-white rounded-lg shadow p-6 w-full max-w-md">
        <h1 className="text-xl font-semibold mb-1 text-center">Set New Password</h1>
        <p className="text-sm text-gray-600 mb-4 text-center">Enter and confirm your new password</p>
        <form className="space-y-3" onSubmit={handleSubmit}>
          <input
            type="password"
            placeholder="New password"
            className="input w-full"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          <input
            type="password"
            placeholder="Confirm new password"
            className="input w-full"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
          <button className="btn btn-primary w-full" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Resetting...' : 'Reset Password'}
          </button>
          <button
            type="button"
            className="btn btn-secondary w-full"
            onClick={() => router.push('/login')}
          >
            Back to Login
          </button>
        </form>
      </div>
    </div>
  )
}
