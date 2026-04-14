import { useRouter } from 'next/router'
import { useEffect } from 'react'

export default function ResetPasswordPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/inventory').catch(() => {})
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="bg-white rounded-lg shadow p-6 w-full max-w-md">
        <h1 className="text-xl font-semibold mb-1 text-center">Inventory Mode</h1>
        <p className="text-sm text-gray-600 mb-4 text-center">Redirecting to inventory page...</p>
        <button type="button" className="btn btn-primary w-full" onClick={() => router.push('/inventory')}>
          Open Inventory
        </button>
      </div>
    </div>
  )
}
