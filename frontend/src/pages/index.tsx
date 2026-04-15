import { useRouter } from 'next/router'
import { useEffect } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { getFirebaseAuth } from '@/lib/firebase'

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    try {
      const auth = getFirebaseAuth()
      return onAuthStateChanged(auth, (user) => {
        router.replace(user ? '/billing' : '/login').catch(() => {})
      })
    } catch {
      router.replace('/login').catch(() => {})
    }
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
      <div className="bg-white rounded-lg shadow p-6 w-full max-w-md text-center">
        <h1 className="text-xl font-semibold mb-2">Shop Billing App</h1>
        <p className="text-sm text-gray-600 mb-4">
          Redirecting...
        </p>
        <div className="flex flex-col gap-2" />
      </div>
    </div>
  )
}
