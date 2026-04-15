import { useRouter } from 'next/router'
import { useEffect } from 'react'

export default function ResetPasswordPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/login').catch(() => {})
  }, [router])

  return <div className="min-h-screen grid place-items-center text-gray-600">Opening login...</div>
}
