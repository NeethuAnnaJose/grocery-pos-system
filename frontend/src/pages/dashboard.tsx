import { useRouter } from 'next/router'
import { useEffect } from 'react'

export default function Dashboard() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/inventory').catch(() => {})
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
      <div className="bg-white rounded-lg shadow p-6 w-full max-w-md text-center">
        <h1 className="text-xl font-semibold mb-2">Inventory Mode</h1>
        <p className="text-sm text-gray-600 mb-4">Dashboard analytics are disabled for this free setup.</p>
        <button className="btn btn-primary" onClick={() => router.push('/inventory')}>
          Open Inventory
        </button>
      </div>
    </div>
  )
}
