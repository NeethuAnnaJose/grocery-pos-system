import { useRouter } from 'next/router'
import { useEffect } from 'react'

export default function Dashboard() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/billing').catch(() => {})
  }, [router])

  return <div className="min-h-screen grid place-items-center text-gray-600">Opening billing...</div>
}
